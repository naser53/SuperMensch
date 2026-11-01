// Sound effects, made with the Web Audio API (no sound files, so the single-file build stays small
// and works offline). Every sound is synthesized when it plays:
//   move      a wooden clack, like a chess piece set down on the board
//   capture   a small blast; a hit general or marshal: a stronger blast with a rumble
//   knock     three knocks on a door: a triple-dice card is played
//   gate      a short rising chime: a piece comes out of the yard onto its gate
//   fireworks a whistle per rocket and a crackling burst, timed with the rockets on the board
// The browser starts audio only after a click or a key, so the context is made on the first one.
import { Config } from "./config.js";

class Sound {
  constructor() {
    this.ctx = null;
    this.on = true;
    if (typeof window === "undefined") return;
    const unlock = () => this.init();
    window.addEventListener("pointerdown", unlock, { capture: true });
    window.addEventListener("keydown", unlock, { capture: true });
  }

  init() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { this.ctx = new AC(); } catch { return null; }
      const c = this.ctx;
      this.master = c.createGain();
      this.master.gain.value = Config.SOUND_VOLUME;
      const comp = c.createDynamicsCompressor();          // keeps a big blast from clipping
      comp.threshold.value = -12; comp.ratio.value = 6;
      this.master.connect(comp).connect(c.destination);
      const n = c.sampleRate * 2, buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    }
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  setOn(on) { this.on = !!on; }

  // the context, if sound is on and allowed; null otherwise
  live() {
    if (!this.on || !this.ctx || this.ctx.state !== "running") return null;
    return this.ctx;
  }

  // play fn after ms milliseconds (in step with the animations, which use performance.now())
  at(ms, fn) {
    if (!this.on) return;
    if (ms <= 5) fn();
    else setTimeout(fn, ms);
  }

  // --- building blocks
  env(t, peak, attack, decay) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(this.master);
    return g;
  }

  noise(t, dur, out) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    s.connect(out);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur);
    return s;
  }

  tone(t, type, f0, f1, dur, out) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    o.connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
    return o;
  }

  filter(type, freq, q, out) {
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    f.connect(out);
    return f;
  }

  // --- the sounds
  // a chess piece set down on a wooden board: a sharp click and a short hollow knock
  move() {
    const c = this.live(); if (!c) return;
    const t = c.currentTime + 0.005, v = 0.85 + Math.random() * 0.3;
    this.noise(t, 0.05, this.filter("bandpass", 2600 + Math.random() * 600, 2.5, this.env(t, 0.55 * v, 0.001, 0.035)));
    this.tone(t, "sine", 720 * v, 520, 0.07, this.env(t, 0.35 * v, 0.002, 0.06));
    this.tone(t, "triangle", 210, 150, 0.12, this.env(t, 0.5 * v, 0.003, 0.1));
  }

  // a blast; big: a general or marshal is hit (louder, deeper, longer, with a rumble)
  blast(big = false) {
    const c = this.live(); if (!c) return;
    const t = c.currentTime + 0.005, len = big ? 1.4 : 0.45;
    // the crack
    this.noise(t, 0.08, this.filter("highpass", 1200, 0.7, this.env(t, big ? 0.9 : 0.5, 0.001, 0.06)));
    // the body: noise through a closing low-pass
    const lp = this.filter("lowpass", big ? 2400 : 1800, 0.8, this.env(t, big ? 1.0 : 0.6, 0.004, len));
    lp.frequency.setValueAtTime(big ? 2400 : 1800, t);
    lp.frequency.exponentialRampToValueAtTime(big ? 90 : 180, t + len);
    this.noise(t, len + 0.05, lp);
    // the thump
    this.tone(t, "sine", big ? 110 : 160, big ? 32 : 60, big ? 0.6 : 0.22, this.env(t, big ? 1.0 : 0.6, 0.003, big ? 0.55 : 0.2));
    if (big) {                                             // a rolling rumble after the blast
      const t2 = t + 0.12;
      this.noise(t2, 1.3, this.filter("lowpass", 160, 1, this.env(t2, 0.6, 0.15, 1.1)));
    }
  }

  // knock, knock, knock on a wooden door
  knock() {
    const c = this.live(); if (!c) return;
    const t0 = c.currentTime + 0.01;
    [0, 0.2, 0.4].forEach((dt, k) => {
      const t = t0 + dt, v = k === 2 ? 1 : 0.85;
      this.tone(t, "sine", 190, 120, 0.12, this.env(t, 0.8 * v, 0.002, 0.1));
      this.noise(t, 0.05, this.filter("bandpass", 650, 1.8, this.env(t, 0.6 * v, 0.001, 0.045)));
      this.tone(t, "triangle", 420, 300, 0.05, this.env(t, 0.2 * v, 0.001, 0.04));
    });
  }

  // a piece comes in through its gate: a quick rising chime
  gate() {
    const c = this.live(); if (!c) return;
    const t0 = c.currentTime + 0.005;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, k) => {
      const t = t0 + k * 0.07;
      this.tone(t, "triangle", f, f, 0.35, this.env(t, 0.32, 0.01, 0.32));
      this.tone(t, "sine", f * 2, f * 2, 0.25, this.env(t, 0.08, 0.01, 0.22));
    });
  }

  // one rocket: a whistle while it rises (rise ms), then the burst with crackles
  rocket(rise) {
    const c = this.live(); if (!c) return;
    const t = c.currentTime + 0.005, T = rise / 1000;
    const pan = c.createStereoPanner ? c.createStereoPanner() : null;
    const out = this.ctx.createGain();
    out.gain.value = 1;
    if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; out.connect(pan).connect(this.master); }
    else out.connect(this.master);
    const wg = c.createGain();
    wg.gain.setValueAtTime(0.0001, t);
    wg.gain.exponentialRampToValueAtTime(0.06, t + 0.08);
    wg.gain.exponentialRampToValueAtTime(0.0001, t + T);
    wg.connect(out);
    this.tone(t, "sine", 900 + Math.random() * 300, 2200 + Math.random() * 600, T, wg);
    // the burst
    const b = t + T;
    const bg = c.createGain();
    bg.gain.setValueAtTime(0.0001, b);
    bg.gain.exponentialRampToValueAtTime(0.7, b + 0.004);
    bg.gain.exponentialRampToValueAtTime(0.0001, b + 0.6);
    bg.connect(out);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.setValueAtTime(3000, b); lp.frequency.exponentialRampToValueAtTime(200, b + 0.6);
    lp.connect(bg);
    this.noise(b, 0.65, lp);
    const th = c.createGain();
    th.gain.setValueAtTime(0.0001, b);
    th.gain.exponentialRampToValueAtTime(0.5, b + 0.004);
    th.gain.exponentialRampToValueAtTime(0.0001, b + 0.3);
    th.connect(out);
    this.tone(b, "sine", 130, 45, 0.3, th);
    // crackles: tiny clicks scattered over the next second
    for (let k = 0; k < 18; k++) {
      const tc = b + 0.15 + Math.random() * 0.9, g = c.createGain();
      g.gain.setValueAtTime(0.0001, tc);
      g.gain.exponentialRampToValueAtTime(0.12 + Math.random() * 0.12, tc + 0.001);
      g.gain.exponentialRampToValueAtTime(0.0001, tc + 0.02);
      g.connect(out);
      const hp = c.createBiquadFilter();
      hp.type = "highpass"; hp.frequency.value = 3000; hp.connect(g);
      this.noise(tc, 0.025, hp);
    }
  }
}

export const sound = new Sound();
