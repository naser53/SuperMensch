// Voice chat in online games (v3.0.0). The page sends its microphone once to Cloudflare Realtime
// SFU and pulls the other devices' microphones from it (server/voice.js has the server side; the
// server holds the SFU's token and checks every request). Only the page's own WebRTC lives here:
//   mic     one sendonly RTCPeerConnection with this device's microphone (only if it may talk)
//   listen  one RTCPeerConnection that receives every other open microphone of the room
// The microphone starts closed; a tap on the mic button opens it, the next mutes it, and so on.
// It stops when the player leaves the game or closes the page. Every tick the loudness of each
// voice is measured to light the speaker's player chip.
import { Config } from "./config.js";

const V = Config.VOICE;
const key = (sid, track) => `${sid}/${track}`;
const rnd = () => Math.random().toString(36).slice(2, 10);

export class Voice {
  // post(op, body) asks the server (POST /api/games/<ID>/voice); onChange() redraws the panel;
  // onError(code) shows a short message ("denied", "failed")
  constructor({ post, onChange, onError, onMute }) {
    Object.assign(this, { post, onChange, onError, onMute });
    this.on = false;          // the room has voice chat (admin switch, server set up)
    this.can = false;         // this device may talk
    this.voices = [];         // the open microphones of the room: { sid, track, seats, muted }
    this.mic = null;          // { pc, stream, sid, track, muted, an }
    this.ownTrack = null;     // the name of this device's microphone (also while it starts)
    this.starting = false;
    this.listen = null;       // { pc, sid, ready: Promise }
    this.heard = new Map();   // key -> { audio, an, seats, mid }
    this.mids = new Map();    // mid on the listen connection -> key
    this.quiet = new Set();   // sids muted on this device only
    this.speaking = new Set();
    this.loud = new Map();    // seat -> last time it was loud
    this.queue = Promise.resolve();
    this.ice = null;
    this.ctx = null;
    this.timer = null;
    this.mySeats = [];
  }

  // ---------------------------------------------------------------- state from the server
  setAllowed(on, can) {
    this.on = !!on;
    this.can = !!can && this.on;
    if (!this.can && this.mic) this.stopMic(false);
    if (!this.on) this.stopListening();
    this.onChange();
  }

  setVoices(list, mySeats) {
    this.voices = Array.isArray(list) ? list : [];
    if (mySeats) this.mySeats = mySeats;
    if (this.mic && this.mic.sid && !this.voices.some(v => v.sid === this.mic.sid)) this.stopMic(false);  // the server dropped it
    if (this.on) this.queue = this.queue.then(() => this.syncHeard()).catch(() => this.onError("failed"));
    this.onChange();
  }

  // a new WebSocket: the server has forgotten this device's sessions; start clean
  reset() {
    this.stopMic(false);
    this.stopListening();
  }

  // the microphone button: closed -> open -> muted -> open ...
  async toggleMic() {
    if (!this.can || this.starting) return;
    this.wake();
    if (!this.mic) { await this.startMic(); return; }
    this.mic.muted = !this.mic.muted;
    for (const t of this.mic.stream.getAudioTracks()) t.enabled = !this.mic.muted;
    this.onMute(this.mic.muted);
    this.onChange();
  }

  get micState() { return !this.mic ? (this.starting ? "wait" : "off") : this.mic.muted ? "muted" : "live"; }

  // is a seat's voice muted for this device only / did its owner mute it / is it open at all
  voiceOf(seat) {
    const v = this.voices.find(x => x.seats.includes(seat));
    if (!v || v.track === this.ownTrack) return null;
    return { quiet: this.quiet.has(v.sid), muted: v.muted };
  }

  toggleQuiet(seat) {
    const v = this.voices.find(x => x.seats.includes(seat));
    if (!v) return;
    if (this.quiet.has(v.sid)) this.quiet.delete(v.sid); else this.quiet.add(v.sid);
    for (const h of this.heard.values()) if (h.sid === v.sid) h.audio.muted = this.quiet.has(v.sid);
    this.onChange();
  }

  // the browser lets sound play and the analyser run only after a tap: called on every tap
  wake() {
    try {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === "suspended") this.ctx.resume();
    } catch { /* no Web Audio: no speaking ring */ }
    for (const h of this.heard.values()) if (h.audio.paused) h.audio.play().catch(() => {});
  }

  stop() {
    this.stopMic(false);
    this.stopListening();
    clearInterval(this.timer);
    this.timer = null;
  }

  // ---------------------------------------------------------------- WebRTC
  async iceServers() {
    if (!this.ice) this.ice = (await this.post("ice")).iceServers;
    return this.ice;
  }

  async newPc() {
    return new RTCPeerConnection({ iceServers: await this.iceServers(), bundlePolicy: "max-bundle" });
  }

  async startMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { this.onError("denied"); return; }
    this.starting = true;
    this.onChange();
    let stream = null, pc = null, err = null;
    try {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      } catch { err = "denied"; return; }
      if (!this.can) { stream.getTracks().forEach(t => t.stop()); return; }
      pc = await this.newPc();
      const track = stream.getAudioTracks()[0];
      const tr = pc.addTransceiver(track, { direction: "sendonly", streams: [stream] });
      await pc.setLocalDescription(await pc.createOffer());
      const { sessionId } = await this.post("session");
      const name = "mic-" + rnd();
      this.ownTrack = name;                   // the room lists it before the push answers: not to be pulled
      const r = await this.post("push", { sid: sessionId, sdp: pc.localDescription.sdp, mid: tr.mid, track: name });
      await pc.setRemoteDescription(r.sessionDescription);
      try {                                   // a light voice: Opus at about 32 kbit/s
        const p = tr.sender.getParameters();
        p.encodings = p.encodings && p.encodings.length ? p.encodings : [{}];
        p.encodings[0].maxBitrate = V.BITRATE;
        await tr.sender.setParameters(p);
      } catch { /* the browser keeps its own rate */ }
      this.mic = { pc, stream, sid: sessionId, track: name, muted: false, an: this.analyser(stream) };
      this.tick();
    } catch {
      if (stream) stream.getTracks().forEach(t => t.stop());
      if (pc) pc.close();
      err = "failed";
    } finally {
      this.starting = false;
      this.onChange();
      if (err) this.onError(err);
    }
  }

  // tell: false when the server already knows (it dropped the microphone itself)
  stopMic(tell = true) {
    const m = this.mic;
    if (!m) return;
    this.mic = null;
    m.stream.getTracks().forEach(t => t.stop());
    try { m.pc.close(); } catch { /* closed */ }
    if (tell) this.onMute(true);
  }

  stopListening() {
    for (const h of this.heard.values()) { h.audio.pause(); h.audio.srcObject = null; }
    this.heard.clear();
    this.mids.clear();
    if (this.listen) { try { this.listen.pc.close(); } catch { /* closed */ } }
    this.listen = null;
  }

  // pull the microphones not heard yet, drop the ones that closed
  async syncHeard() {
    const want = this.voices.filter(v => v.track !== this.ownTrack);
    const keys = new Set(want.map(v => key(v.sid, v.track)));
    for (const [k, h] of this.heard) if (!keys.has(k)) { h.audio.pause(); h.audio.srcObject = null; this.heard.delete(k); }
    for (const h of this.heard.values()) {                       // the seats of a device may change
      const v = want.find(x => x.sid === h.sid);
      if (v) h.seats = v.seats;
    }
    const pending = new Set([...this.mids.values()]);
    const fresh = want.filter(v => !this.heard.has(key(v.sid, v.track)) && !pending.has(key(v.sid, v.track)));
    if (!fresh.length || !this.on) return;
    if (!this.listen) {
      const pc = await this.newPc();
      const { sessionId } = await this.post("session");
      pc.ontrack = e => this.gotTrack(e);
      this.listen = { pc, sid: sessionId };
    }
    const L = this.listen;
    const r = await this.post("pull", { sid: L.sid, tracks: fresh.map(v => ({ sessionId: v.sid, trackName: v.track })) });
    for (const t of r.tracks || []) if (t.mid && !t.errorCode) this.mids.set(String(t.mid), key(t.sessionId, t.trackName));
    if (r.requiresImmediateRenegotiation && this.listen === L) {
      await L.pc.setRemoteDescription(r.sessionDescription);
      await L.pc.setLocalDescription(await L.pc.createAnswer());
      await this.post("renegotiate", { sid: L.sid, sdp: L.pc.localDescription.sdp });
    }
  }

  gotTrack(e) {
    const k = this.mids.get(String(e.transceiver && e.transceiver.mid));
    if (!k) return;
    const sid = k.split("/")[0], v = this.voices.find(x => x.sid === sid);
    const stream = new MediaStream([e.track]);
    const audio = new Audio();
    audio.autoplay = true;
    audio.srcObject = stream;
    audio.muted = this.quiet.has(sid);
    audio.play().catch(() => {});                 // may wait for the next tap (wake)
    this.heard.set(k, { audio, sid, seats: v ? v.seats : [], receiver: e.receiver });
    this.mids.delete(String(e.transceiver.mid));
    this.tick();
  }

  // ---------------------------------------------------------------- who is speaking
  analyser(stream) {
    try {
      this.wake();
      if (!this.ctx) return null;
      const an = this.ctx.createAnalyser();
      an.fftSize = 512;
      this.ctx.createMediaStreamSource(stream).connect(an);
      return { an, buf: new Float32Array(an.fftSize) };
    } catch { return null; }
  }

  level(a) {
    if (!a) return 0;
    a.an.getFloatTimeDomainData(a.buf);
    let s = 0;
    for (const x of a.buf) s += x * x;
    return Math.sqrt(s / a.buf.length);
  }

  // another device's loudness, from the audio level of the packets it sends (Web Audio may get
  // silence from a WebRTC stream in some browsers); a level older than a second counts as quiet
  heardLevel(h) {
    try {
      const s = h.receiver.getSynchronizationSources()[0];
      if (!s || typeof s.audioLevel !== "number") return 0;
      const age = Math.min(Math.abs(performance.now() - s.timestamp), Math.abs(Date.now() - s.timestamp));
      return age < 1000 ? s.audioLevel : 0;
    } catch { return 0; }
  }

  tick() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const now = performance.now();
      if (this.mic && !this.mic.muted && this.level(this.mic.an) > V.SPEAK_LEVEL)
        for (const s of this.mySeats) this.loud.set(s, now);
      for (const h of this.heard.values())
        if (!h.audio.muted && !this.voices.some(x => x.sid === h.sid && x.muted) && this.heardLevel(h) > V.SPEAK_LEVEL) for (const s of h.seats) this.loud.set(s, now);
      const next = new Set([...this.loud].filter(([, t]) => now - t < V.SPEAK_HOLD_MS).map(([s]) => s));
      if (next.size !== this.speaking.size || [...next].some(s => !this.speaking.has(s))) {
        this.speaking = next;
        this.onSpeaking && this.onSpeaking(next);
      }
    }, V.TICK_MS);
  }
}
