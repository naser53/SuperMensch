// Voice chat in online games (v3.0.0). Two modes (the admin picks one, server/voice.js):
// "relay": the page sends its microphone once to an SFU (the Linux server's own, or Cloudflare
// Realtime) and pulls the other devices' microphones from it (the server checks every request):
//   mic     one sendonly RTCPeerConnection with this device's microphone (only if it may talk)
//   listen  one RTCPeerConnection that receives every other open microphone of the room
// "p2p" (v3.3.0): no SFU. A listening device opens one receive-only connection to each open
// microphone and sends its offer over the game's WebSocket ({ t: "rtc" }); the talking device
// answers with its microphone on it (mic.peers). The offers and answers carry all their ICE
// candidates (no trickle), so one message each way is enough.
// The microphone starts closed; a tap on the mic button opens it, the next mutes it, and so on.
// It stops when the player leaves the game or closes the page. Every tick the loudness of each
// voice is measured to light the speaker's player chip.
//
// Phones (v3.0.1, owner, 2026-11-04): once the microphone is open, a phone may move the other
// voices to its small call earpiece, and iOS may pause them. "Speaker" mode (on by default) asks
// for the loudspeaker where the browser allows it (navigator.audioSession on iOS, setSinkId
// elsewhere); a paused voice is played again, and a broken connection is made again.
// The last voice events are kept in log (Info > Copy adds them to the game report).
import { Look } from "./look.js";

const V = Look.VOICE;
const key = (sid, track) => `${sid}/${track}`;
const rnd = () => Math.random().toString(36).slice(2, 10);
const SPEAKER_KEY = "supermensch-speaker";
const loadSpeaker = () => { try { return localStorage.getItem(SPEAKER_KEY) !== "0"; } catch { return true; } };

export class Voice {
  // post(op, body) asks the server (POST /api/games/<ID>/voice); onChange() redraws the panel;
  // onError(code) shows a short message ("denied", "failed")
  // send(msg) sends a message over the game's WebSocket (peer to peer)
  constructor({ post, onChange, onError, onMute, send }) {
    Object.assign(this, { post, onChange, onError, onMute, send });
    this.mode = "relay";      // "relay" or "p2p" (the server says)
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
  setAllowed(on, can, mode) {
    const m = mode === "p2p" ? "p2p" : "relay";
    if (m !== this.mode) {                 // the admin changed the mode: start again in the new one
      this.note("mode " + m);
      if (this.mic) this.resume = this.resume || (this.mic.muted ? "muted" : "live");
      this.stopMic(false);
      this.stopListening();
      this.ice = null;
      this.mode = m;
    }
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
    if (this.mic && this.mic.sid && !this.mic.pending && !this.voices.some(v => v.sid === this.mic.sid)) { this.note("server closed my mic"); this.stopMic(false); }  // the server dropped it
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
      if (this.mode === "p2p") {              // only listed: each listener asks for it (onRtc)
        const { sessionId } = await this.post("session");
        const name = "mic-" + rnd();
        this.ownTrack = name;
        this.mic = { pc: null, peers: new Map(), stream, sid: sessionId, track: name, muted: false, an: this.analyser(stream), pending: true };
        await this.post("push", { sid: sessionId, mid: "0", track: name });
        this.mic.pending = false;
        try { if (this.ctx) await this.ctx.suspend().then(() => this.ctx.resume()); } catch { /* iOS */ }
        this.output();
        this.replay();
        this.tick();
        return;
      }
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
      if (this.mic && this.mic.stream === stream) this.stopMic(false);
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
    try { if (m.pc) m.pc.close(); } catch { /* closed */ }
    for (const p of (m.peers || new Map()).values()) { try { p.close(); } catch { /* closed */ } }
    if (tell) this.onMute(true);
    this.output();
  }

  stopListening() {
    for (const h of this.heard.values()) this.drop(h);
    this.heard.clear();
    this.mids.clear();
    if (this.listen) {
      try { if (this.listen.pc) this.listen.pc.close(); } catch { /* closed */ }
      for (const p of (this.listen.peers || new Map()).values()) { try { p.pc.close(); } catch { /* closed */ } }
    }
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
    if (this.mode === "p2p") { await this.syncPeers(want); return; }
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

  gotTrack(e, given) {
    const k = given || this.mids.get(String(e.transceiver && e.transceiver.mid));
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
    if (!given) this.mids.delete(String(e.transceiver.mid));
    this.tick();
  }

  // ---------------------------------------------------------------- peer to peer
  // wait until the connection knows its ICE candidates (they go inside the offer or answer)
  gathered(pc) {
    return new Promise(done => {
      if (pc.iceGatheringState === "complete") return done();
      const t = setTimeout(done, V.GATHER_MS);
      pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") { clearTimeout(t); done(); } });
    });
  }

  // listening: one receive-only connection to each open microphone, closed ones dropped
  async syncPeers(want) {
    if (!this.on) return;
    if (!this.listen) {
      const { sessionId } = await this.post("session");
      this.listen = { pc: null, sid: sessionId, peers: new Map() };
    }
    const L = this.listen;
    for (const [sid, p] of L.peers)
      if (!want.some(v => v.sid === sid && v.track === p.track)) { try { p.pc.close(); } catch { /* closed */ } L.peers.delete(sid); }
    for (const v of want) {
      if (L.peers.has(v.sid)) continue;
      const pc = await this.newPc(), k = key(v.sid, v.track);
      const p = { pc, track: v.track, bad: 0 };
      L.peers.set(v.sid, p);
      pc.addTransceiver("audio", { direction: "recvonly" });
      pc.ontrack = e => { if (this.listen === L && L.peers.get(v.sid) === p) this.gotTrack(e, k); };
      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        this.note("peer " + v.sid.slice(0, 6) + " " + st);
        if (this.listen !== L || L.peers.get(v.sid) !== p) return;
        const again = why => {            // ask that microphone again
          try { pc.close(); } catch { /* closed */ }
          L.peers.delete(v.sid);
          const h = this.heard.get(k);
          if (h) { this.drop(h); this.heard.delete(k); }
          this.relistenPeers(why);
        };
        if (st === "failed") again("failed");
        else if (st === "disconnected") {
          clearTimeout(p.bad);
          p.bad = setTimeout(() => { if (L.peers.get(v.sid) === p && pc.connectionState === "disconnected") again("disconnected"); }, V.RETRY_MS);
        }
      };
      await pc.setLocalDescription(await pc.createOffer());
      await this.gathered(pc);
      if (L.peers.get(v.sid) !== p) continue;
      this.note("ask " + v.sid.slice(0, 6));
      this.send({ t: "rtc", from: L.sid, to: v.sid, desc: { type: "offer", sdp: pc.localDescription.sdp } });
    }
  }

  relistenPeers(why) {
    this.note("listen again: " + why);
    if (this.on) this.queue = this.queue.then(() => this.syncHeard()).catch(e => { this.note("listen failed " + (e && e.message)); this.onError("failed"); });
  }

  // another device's offer (to my microphone) or answer (to my listening)
  async onRtc(msg) {
    if (this.mode !== "p2p" || !msg || !msg.desc) return;
    try {
      const m = this.mic;
      if (msg.desc.type === "offer" && m && m.peers && msg.to === m.sid) {
        const old = m.peers.get(msg.from);
        if (old) { try { old.close(); } catch { /* closed */ } }
        const pc = await this.newPc();
        m.peers.set(msg.from, pc);
        pc.onconnectionstatechange = () => {
          this.note("to " + msg.from.slice(0, 6) + " " + pc.connectionState);
          if (pc.connectionState === "failed" && m.peers.get(msg.from) === pc) { try { pc.close(); } catch { /* closed */ } m.peers.delete(msg.from); }
        };
        await pc.setRemoteDescription(msg.desc);
        const track = m.stream.getAudioTracks()[0];
        const tr = pc.getTransceivers()[0];
        if (tr) { await tr.sender.replaceTrack(track); tr.direction = "sendonly"; } else pc.addTrack(track, m.stream);
        await pc.setLocalDescription(await pc.createAnswer());
        try {                                 // a light voice: Opus at about 32 kbit/s
          const snd = pc.getSenders()[0], p = snd.getParameters();
          p.encodings = p.encodings && p.encodings.length ? p.encodings : [{}];
          p.encodings[0].maxBitrate = V.BITRATE;
          await snd.setParameters(p);
        } catch { /* the browser keeps its own rate */ }
        await this.gathered(pc);
        if (this.mic !== m || m.peers.get(msg.from) !== pc) return;
        this.send({ t: "rtc", from: m.sid, to: msg.from, desc: { type: "answer", sdp: pc.localDescription.sdp } });
        return;
      }
      const L = this.listen;
      if (msg.desc.type === "answer" && L && L.peers && msg.to === L.sid) {
        const p = L.peers.get(msg.from);
        if (p && p.pc.signalingState === "have-local-offer") await p.pc.setRemoteDescription(msg.desc);
      }
    } catch (e) { this.note("rtc failed " + (e && e.message)); }
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
        const pcs = this.listen.pc ? [this.listen.pc] : [...this.listen.peers.values()].map(p => p.pc);
        for (const pc of pcs) (await pc.getStats()).forEach(r => {
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
        const pcs = this.mic.pc ? [this.mic.pc] : [...this.mic.peers.values()];
        for (const pc of pcs) (await pc.getStats()).forEach(r => { if (r.type === "outbound-rtp") tx += r.bytesSent || 0; });
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
