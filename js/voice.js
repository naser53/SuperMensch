// Voice chat in online games (v3.0.0). The page sends its microphone once to Cloudflare Realtime
// SFU and pulls the other devices' microphones from it (server/voice.js has the server side; the
// server holds the SFU's token and checks every request). Only the page's own WebRTC lives here:
//   mic     one sendonly RTCPeerConnection with this device's microphone (only if it may talk)
//   listen  one RTCPeerConnection that receives every other open microphone of the room
// The microphone starts closed; a tap on the mic button opens it, the next mutes it, and so on.
// It stops when the player leaves the game or closes the page. Every tick the loudness of each
// voice is measured to light the speaker's player chip.
//
// Phones (v3.0.1, owner, 2026-11-04): once the microphone is open, a phone may move the other
// voices to its small call earpiece, and iOS may pause them. "Speaker" mode (on by default) asks
// for the loudspeaker where the browser allows it (navigator.audioSession on iOS, setSinkId
// elsewhere); a paused voice is played again, and a broken connection is made again.
// The last voice events are kept in log (Info > Copy adds them to the game report).
import { Config } from "./config.js";

const V = Config.VOICE;
const key = (sid, track) => `${sid}/${track}`;
const rnd = () => Math.random().toString(36).slice(2, 10);
const SPEAKER_KEY = "supermensch-speaker";
const loadSpeaker = () => { try { return localStorage.getItem(SPEAKER_KEY) !== "0"; } catch { return true; } };

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
    this.speaker = loadSpeaker();   // play the others on the loudspeaker (phones)
    this.log = [];                  // the last voice events, for the game report
    this.box = null;                // a hidden element holding the audio elements
    this.lastCheck = 0;
  }

  note(text) {
    this.log.push(`${new Date().toISOString().slice(11, 19)} ${text}`);
    if (this.log.length > 80) this.log.shift();
  }

  // is there anybody to hear (the speaker button shows then)
  get hearing() { return this.on && this.voices.some(v => v.track !== this.ownTrack); }

  toggleSpeaker() {
    this.speaker = !this.speaker;
    try { localStorage.setItem(SPEAKER_KEY, this.speaker ? "1" : "0"); } catch { /* private mode */ }
    this.note("speaker " + (this.speaker ? "on" : "off"));
    this.output();
    this.wake();
    this.onChange();
  }

  // where the voices play: the loudspeaker in speaker mode, else the device's own choice
  async output() {
    try {
      const s = navigator.audioSession;
      if (s) s.type = this.speaker ? (this.mic ? "play-and-record" : "playback") : "auto";
    } catch { /* no Audio Session API */ }
    let sink = "";
    try {
      if (this.speaker && navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        const outs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audiooutput");
        const loud = outs.find(d => /speaker/i.test(d.label) && !/earpiece|headset|head/i.test(d.label));
        if (loud) sink = loud.deviceId;
        const list = outs.map(d => d.label || "?").join(", ") + " -> " + (loud ? loud.label : "default");
        if (list !== this.outsSeen) { this.outsSeen = list; this.note("outputs " + list); }
      }
    } catch { /* no device list */ }
    for (const h of this.heard.values()) {
      h.audio.volume = 1;
      if (h.audio.setSinkId) h.audio.setSinkId(sink).catch(() => {});
    }
  }

  // ---------------------------------------------------------------- state from the server
  setAllowed(on, can) {
    this.on = !!on;
    this.can = !!can && this.on;
    if (!this.can && this.mic) { this.note("mic not allowed now"); this.stopMic(false); }
    if (!this.can) this.resume = null;
    if (!this.on) this.stopListening();
    if (this.resume && !this.mic && !this.starting) {
      const was = this.resume;
      this.resume = null;
      this.note("mic opens again");
      this.startMic().then(() => {
        if (was === "muted" && this.mic && !this.mic.muted) {
          this.mic.muted = true;
          for (const t of this.mic.stream.getAudioTracks()) t.enabled = false;
          this.onMute(true);
          this.onChange();
        }
      });
    }
    this.onChange();
  }

  setVoices(list, mySeats) {
    this.voices = Array.isArray(list) ? list : [];
    if (mySeats) this.mySeats = mySeats;
    if (this.mic && this.mic.sid && !this.voices.some(v => v.sid === this.mic.sid)) { this.note("server closed my mic"); this.stopMic(false); }  // the server dropped it
    this.note("voices " + (this.voices.map(v => v.sid.slice(0, 6) + (v.muted ? "(muted)" : "")).join(" ") || "-"));
    if (this.on) this.queue = this.queue.then(() => this.syncHeard()).catch(e => { this.note("listen failed " + (e && e.message)); this.onError("failed"); });
    this.onChange();
  }

  // a new WebSocket: the server has forgotten this device's sessions; start clean
  // (a phone's connection often drops for a moment): a microphone that was open opens again by itself
  reset() {
    if (this.mic) this.resume = this.mic.muted ? "muted" : "live";
    this.note("new connection" + (this.resume ? ", mic was " + this.resume : ""));
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
    this.replay();
  }

  // play again every voice that stopped (iOS pauses them when the microphone opens)
  replay() {
    for (const h of this.heard.values())
      if (h.audio.paused) { this.note("play again " + h.sid.slice(0, 6)); h.audio.play().catch(() => {}); }
  }

  // a connection broke: start listening again from the room's list
  relisten(why) {
    this.note("listen again: " + why);
    this.stopListening();
    if (this.on) this.queue = this.queue.then(() => this.syncHeard()).catch(e => { this.note("listen failed " + e.message); this.onError("failed"); });
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
        try { if (navigator.audioSession && this.speaker) navigator.audioSession.type = "play-and-record"; } catch { /* none */ }
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      } catch (e) { this.note("mic denied " + (e && e.name)); err = "denied"; return; }
      this.note("mic granted");
      if (!this.can) { stream.getTracks().forEach(t => t.stop()); return; }
      pc = await this.newPc();
      const mpc = pc;
      pc.onconnectionstatechange = () => {
        this.note("mic " + mpc.connectionState);
        if (mpc.connectionState === "failed" && this.mic && this.mic.pc === mpc) { this.stopMic(true); this.onError("failed"); this.onChange(); }
      };
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
      try { if (this.ctx) await this.ctx.suspend().then(() => this.ctx.resume()); } catch { /* iOS: may bring the volume back */ }
      this.output();
      this.replay();
      this.tick();
    } catch (e) {
      this.note("mic failed " + (e && e.message));
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
    this.output();
  }

  stopListening() {
    for (const h of this.heard.values()) this.drop(h);
    this.heard.clear();
    this.mids.clear();
    if (this.listen) { try { this.listen.pc.close(); } catch { /* closed */ } }
    this.listen = null;
  }

  // pull the microphones not heard yet, drop the ones that closed
  async syncHeard() {
    const want = this.voices.filter(v => v.track !== this.ownTrack);
    const keys = new Set(want.map(v => key(v.sid, v.track)));
    for (const [k, h] of this.heard) if (!keys.has(k)) { this.drop(h); this.heard.delete(k); }
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
      const L = { pc, sid: sessionId, bad: 0 };
      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        this.note("listen " + st);
        if (this.listen !== L) return;
        if (st === "failed") this.relisten("failed");
        else if (st === "disconnected") {           // often comes back by itself; if not, start again
          clearTimeout(L.bad);
          L.bad = setTimeout(() => { if (this.listen === L && pc.connectionState === "disconnected") this.relisten("disconnected"); }, V.RETRY_MS);
        }
      };
      this.listen = L;
    }
    const L = this.listen;
    this.note("pull " + fresh.map(v => v.sid.slice(0, 6)).join(" "));
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
    if (!k) { this.note("track with unknown mid " + (e.transceiver && e.transceiver.mid)); return; }
    const sid = k.split("/")[0], v = this.voices.find(x => x.sid === sid);
    const stream = new MediaStream([e.track]);
    const audio = document.createElement("audio");
    audio.autoplay = true;
    audio.setAttribute("playsinline", "");
    audio.srcObject = stream;
    audio.muted = this.quiet.has(sid);
    if (!this.box || !this.box.isConnected) {          // in the page: some browsers stop detached players
      this.box = document.createElement("div");
      this.box.hidden = true;
      this.box.id = "voice-audio";
      document.body.appendChild(this.box);
    }
    this.box.appendChild(audio);
    const h = { audio, sid, seats: v ? v.seats : [], receiver: e.receiver };
    audio.onpause = () => { if (this.heard.get(k) === h) { this.note("paused " + sid.slice(0, 6)); setTimeout(() => this.replay(), 300); } };
    e.track.onmute = () => this.note("no sound from " + sid.slice(0, 6));
    e.track.onunmute = () => this.note("sound from " + sid.slice(0, 6));
    e.track.onended = () => { if (this.heard.get(k) === h) this.relisten("track ended"); };
    audio.play().catch(() => {});                 // may wait for the next tap (wake)
    this.heard.set(k, h);
    this.note("hearing " + sid.slice(0, 6));
    this.output();
    this.mids.delete(String(e.transceiver.mid));
    this.tick();
  }

  drop(h) {
    h.audio.onpause = null;
    h.audio.pause();
    h.audio.srcObject = null;
    h.audio.remove();
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

  // every few seconds a line for the report: what arrives, what plays, what is sent
  async stats() {
    try {
      const parts = [];
      if (this.listen) {
        let rx = 0, lv = null;
        (await this.listen.pc.getStats()).forEach(r => {
          if (r.type === "inbound-rtp" && r.kind === "audio") { rx += r.bytesReceived || 0; if (typeof r.audioLevel === "number") lv = Math.max(lv || 0, r.audioLevel); }
        });
        parts.push(`in ${Math.round(rx / 1024)}KB lvl ${lv === null ? "-" : lv.toFixed(2)}`);
      }
      for (const h of this.heard.values()) {
        const a = h.audio;
        parts.push(`play ${h.sid.slice(0, 6)} ${a.paused ? "paused" : "on"} rs${a.readyState} vol${a.volume}${a.muted ? " muted" : ""}${a.sinkId ? " sink" : ""}`);
      }
      if (this.mic) {
        let tx = 0;
        (await this.mic.pc.getStats()).forEach(r => { if (r.type === "outbound-rtp") tx += r.bytesSent || 0; });
        parts.push(`out ${Math.round(tx / 1024)}KB${this.mic.muted ? " muted" : ""}`);
      }
      if (this.ctx) parts.push("ctx " + this.ctx.state);
      if (navigator.audioSession) parts.push("session " + navigator.audioSession.type);
      if (parts.length) this.note(parts.join(" · "));
    } catch (e) { this.note("stats failed " + (e && e.message)); }
  }

  tick() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const now = performance.now();
      if (now - this.lastCheck > V.RETRY_MS) { this.lastCheck = now; this.replay(); }   // a voice that stopped plays again
      if (now - (this.lastStats || 0) > V.STATS_MS) { this.lastStats = now; this.stats(); }
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
