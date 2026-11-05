// The roll button's die ("Dice3D", owner's design, 2026-11-05): a 3D die with rounded edges in a
// small glass orb, turning slowly so no face reads as a value.
//
// Why it lives outside the ribbon: the ribbon is rebuilt with innerHTML on every change, so the
// roll button is a new element each time. Anything inside it would restart, and the owner saw the
// die jump whenever the button turned on or off. So the round face of the button (its red or grey
// colour, the "your turn" pulse and the die) is one persistent layer laid exactly over the button
// (`.dice3d-face`, after #ribbon in the page). The button itself is see-through and still takes
// the clicks. One animation loop runs for the whole session; on/off and hover only change targets,
// and a critically damped spring moves the speed and the dimming there, so nothing snaps.
// Tested on its own first in the owner's "Dice lab" page (2026-11-05).
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const PIPS = {
  1: [[.5, .5]],
  2: [[.27, .27], [.73, .73]],
  3: [[.27, .27], [.5, .5], [.73, .73]],
  4: [[.27, .27], [.73, .27], [.27, .73], [.73, .73]],
  5: [[.27, .27], [.73, .27], [.5, .5], [.27, .73], [.73, .73]],
  6: [[.27, .25], [.73, .25], [.27, .5], [.73, .5], [.27, .75], [.73, .75]],
};
const SPIN = { x: 0.007986, y: 0.014641 };   // radians per 60-fps frame, from the design
const HOVER = 3.5;                            // hover makes it turn this much faster
const DIM = 0.5;                              // brightness of the die while the button is off
const OMEGA = 9;                              // spring stiffness: settles in about 0.6 s, no overshoot
const OFF_COLOR = "#e4e1da";                  // the disabled roll button (css: .dice3d-face.off)
const ORB_R = 0.32;

function faceTexture(n, aniso) {
  const s = 256, c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(s / 2, s / 2, s * 0.25, s / 2, s / 2, s * 0.75);
  grad.addColorStop(0, "#fbfaf6");
  grad.addColorStop(1, "#d9d4c8");
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const r = (n === 1 ? 62 : 44) * s / 512;
  for (const [x, y] of PIPS[n]) {
    const px = x * s, py = y * s;
    const pg = g.createRadialGradient(px - r * .3, py - r * .3, r * .1, px, py, r);
    if (n === 1) { pg.addColorStop(0, "#e2464a"); pg.addColorStop(1, "#8e1418"); }
    else { pg.addColorStop(0, "#3a3f52"); pg.addColorStop(1, "#0e1018"); }
    g.fillStyle = pg;
    g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = aniso;
  return tex;
}

const ORB_VERT = `
  varying vec3 vN; varying vec3 vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;

class RollDieView {
  constructor() {
    this.ok = false;
    this.btn = null;       // the roll button of the latest ribbon
    this.active = false;   // that button can be pressed
    this.hover = false;
    this.speed = 0; this.speedV = 0;   // 0 = still, 1 = normal turning (and its rate of change)
    this.fade = DIM; this.fadeV = 0;   // die brightness, DIM..1
    this.rect = "";
    this.last = 0;
    this.raf = 0;
    this.reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  init() {
    if (this.ok || this.failed) return this.ok;
    try {
      const face = document.createElement("div");
      face.className = "dice3d-face off";
      face.hidden = true;
      face.setAttribute("aria-hidden", "true");
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setClearColor(0x000000, 0);
      const canvas = renderer.domElement;
      canvas.className = "dice3d-cv";
      face.appendChild(canvas);
      const ribbon = document.getElementById("ribbon");
      if (ribbon) ribbon.after(face); else document.body.appendChild(face);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10);   // the orb fills the canvas
      camera.position.set(0, 0, ORB_R / Math.sin(THREE.MathUtils.degToRad(20)) * 1.02);
      // the design's light levels, converted to physical lights (x pi)
      scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x30283a, 0.65 * Math.PI));
      const key = new THREE.DirectionalLight(0xffffff, 0.9 * Math.PI);
      key.position.set(3, 6, 4);
      scene.add(key);
      const rim = new THREE.PointLight(0xffcf5a, 0.6 * Math.PI, 20, 0);
      rim.position.set(-4, 2, -3);
      scene.add(rim);

      const aniso = renderer.capabilities.getMaxAnisotropy();
      // box face order: +x, -x, +y, -y, +z, -z (opposite faces add up to 7)
      const mats = [3, 4, 2, 5, 1, 6].map(n => new THREE.MeshStandardMaterial({ map: faceTexture(n, aniso), roughness: 0.35 }));
      const die = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.3, 0.3, 4, 0.0425), mats);
      die.rotation.set(-0.45, 0.6, 0.12);   // a corner toward the viewer, so three faces show
      scene.add(die);

      // inside of the orb: a round gradient behind the die
      const back = new THREE.Mesh(new THREE.SphereGeometry(ORB_R, 48, 48), new THREE.ShaderMaterial({
        side: THREE.BackSide, vertexShader: ORB_VERT,
        fragmentShader: `
          varying vec3 vN; varying vec3 vV;
          void main() {
            float c = abs(dot(normalize(vN), normalize(vV)));
            gl_FragColor = vec4(mix(vec3(0.07, 0.085, 0.15), vec3(0.20, 0.25, 0.40), pow(c, 1.5)), 1.0);
          }`,
      }));
      back.renderOrder = 0;
      scene.add(back);
      // glass shell: rim glow and a highlight
      const glass = new THREE.Mesh(new THREE.SphereGeometry(ORB_R, 48, 48), new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, vertexShader: ORB_VERT,
        fragmentShader: `
          varying vec3 vN; varying vec3 vV;
          void main() {
            vec3 n = normalize(vN); vec3 v = normalize(vV);
            float f = pow(1.0 - max(dot(n, v), 0.0), 2.5);
            vec3 L = normalize(vec3(-0.5, 0.6, 0.7));
            float spec = pow(max(dot(reflect(-L, n), v), 0.0), 80.0);
            gl_FragColor = vec4(mix(vec3(0.55, 0.7, 1.0), vec3(1.0), f) + spec, clamp(0.04 + 0.75 * f + spec, 0.0, 1.0));
          }`,
      }));
      glass.renderOrder = 2;
      scene.add(glass);
      // the dimming is drawn inside the picture: a grey disc that covers exactly the orb. The
      // canvas itself never turns see-through, so the browser never swaps layers.
      const camD = camera.position.z, veilZ = ORB_R + 0.01;
      const veilMat = new THREE.MeshBasicMaterial({ color: OFF_COLOR, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
      const veil = new THREE.Mesh(new THREE.CircleGeometry((camD - veilZ) * Math.tan(Math.asin(ORB_R / camD)) * 1.01, 64), veilMat);
      veil.position.z = veilZ;
      veil.renderOrder = 3;
      scene.add(veil);

      Object.assign(this, { face, renderer, canvas, scene, camera, die, veilMat, size: 0 });
      this.ok = true;
      this.raf = requestAnimationFrame(t => { this.last = t; this.tick(t); });
    } catch (e) {
      this.failed = true;   // no WebGL: the button keeps its plain look (css) and still works
    }
    return this.ok;
  }

  // Called after every ribbon redraw: follow the new roll button (if there is one).
  mount(root) {
    const btn = root && root.querySelector(".rb-roll");
    if (!btn) { this.btn = null; if (this.face) this.face.hidden = true; return; }
    if (!this.init()) return;
    btn.classList.add("has-face");
    this.btn = btn;
    this.hover = btn.matches(":hover");
    btn.addEventListener("pointerenter", e => { if (e.pointerType === "mouse") this.hover = true; });
    btn.addEventListener("pointerleave", () => { this.hover = false; });
    this.active = !btn.disabled;
    this.face.classList.toggle("off", !this.active);
    this.place();
    this.face.hidden = false;
  }

  // lay the face over the button's inside (within its border); only touches styles that changed
  place() {
    const b = this.btn;
    if (!b || !b.isConnected) return;
    const r = b.getBoundingClientRect(), bw = b.clientLeft;
    const key = `${r.left},${r.top},${r.width},${r.height},${bw}`;
    if (key === this.rect) return;
    this.rect = key;
    const s = this.face.style;
    s.left = `${r.left + bw}px`; s.top = `${r.top + bw}px`;
    s.width = `${r.width - 2 * bw}px`; s.height = `${r.height - 2 * bw}px`;
    const slot = b.querySelector(".dice3d");
    const px = Math.round(slot ? slot.getBoundingClientRect().width : (r.width - 2 * bw) * 0.88) || 40;
    if (px !== this.size) { this.size = px; this.renderer.setSize(px, px, false); this.resized = true; this.canvas.style.width = this.canvas.style.height = `${px}px`; }
  }

  tick(now) {
    this.raf = requestAnimationFrame(t => this.tick(t));
    if (this.face.hidden) { this.last = now; return; }
    // seconds since the last frame; never negative, at most a tenth of a second
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.place();
    const tSpeed = this.active && !this.reduced ? (this.hover ? HOVER : 1) : 0;
    const tFade = this.active ? 1 : DIM;
    // a critically damped spring: value and rate stay continuous, so on/off never starts or ends with a snap
    for (let left = dt; left > 1e-6; left -= 1 / 240) {
      const h = Math.min(left, 1 / 240);
      this.speedV += (OMEGA * OMEGA * (tSpeed - this.speed) - 2 * OMEGA * this.speedV) * h;
      this.speed += this.speedV * h;
      this.fadeV += (OMEGA * OMEGA * (tFade - this.fade) - 2 * OMEGA * this.fadeV) * h;
      this.fade += this.fadeV * h;
    }
    this.speed = Math.max(0, this.speed);
    this.fade = Math.min(1, Math.max(DIM, this.fade));
    const step = this.speed * dt * 60;
    this.die.rotation.x += SPIN.x * step;
    this.die.rotation.y += SPIN.y * step;
    const veil = (1 - this.fade) / (1 - DIM) * 0.5;   // 0 when on, 0.5 when off
    // standing still and settled: the picture does not change, so skip drawing it again
    if (step < 1e-5 && Math.abs(veil - this.veilMat.opacity) < 1e-4 && !this.resized) return;
    this.resized = false;
    this.veilMat.opacity = veil;
    this.renderer.render(this.scene, this.camera);
  }
}

export const RollDie = new RollDieView();
