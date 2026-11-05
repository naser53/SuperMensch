// The roll button's die ("Dice3D", owner's design, 2026-11-05): a real 3D die with rounded
// edges inside a small glass orb, turning slowly so no face reads as a value.
// One WebGL canvas lives for the whole session; the ribbon is redrawn with innerHTML, so after
// every redraw `RollDie.mount()` moves the canvas into the new button's slot. It turns only while
// the button can be pressed (faster on hover) and stands still, greyed out, otherwise.
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
const SPIN = { x: 0.007986, y: 0.014641 };   // radians per frame at 60 fps, from the design
const HOVER_SPIN = 3.5;                       // hover makes it turn this much faster
const ORB_R = 0.32;
const DIM = 0.5;                              // opacity of the die while the button is disabled
const EASE = 0.06;                            // share of the way to the new speed/dimming per frame (about half a second)

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
    this.run = false;      // the animation loop is running
    this.active = false;   // the button can be pressed
    this.hover = false;
    this.speed = 0;        // 0 = still, 1 = normal turning
    this.fade = DIM;       // canvas opacity
    this.last = 0;
    this.raf = 0;
    this.reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  init() {
    if (this.ok || this.failed) return this.ok;
    try {
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setClearColor(0x000000, 0);
      const canvas = renderer.domElement;
      canvas.className = "dice3d-cv";

      const scene = new THREE.Scene();
      // the orb (radius 0.32) fills the canvas
      const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10);
      camera.position.set(0, 0, ORB_R / Math.sin(THREE.MathUtils.degToRad(20)) * 1.02);

      // the design's light levels, converted to physical lights (×π)
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
            vec3 col = mix(vec3(0.07, 0.085, 0.15), vec3(0.20, 0.25, 0.40), pow(c, 1.5));
            gl_FragColor = vec4(col, 1.0);
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
            vec3 col = mix(vec3(0.55, 0.7, 1.0), vec3(1.0), f) + spec;
            float a = clamp(0.04 + 0.75 * f + spec, 0.0, 1.0);
            gl_FragColor = vec4(col, a);
          }`,
      }));
      glass.renderOrder = 2;
      scene.add(glass);

      Object.assign(this, { renderer, canvas, scene, camera, die, size: 0 });
      this.ok = true;
    } catch (e) {
      this.failed = true;   // no WebGL: the slot stays empty, the button still works
    }
    return this.ok;
  }

  // Put the canvas into the slot of the freshly drawn roll button (if there is one).
  // The ribbon is rebuilt on every change, so nothing here may jump: the canvas keeps its pixels
  // (preserveDrawingBuffer), and the speed and the dimming ease toward the new state instead of
  // switching, so going from active to inactive (or back) is a smooth slow-down (or start).
  mount(root) {
    const slot = root && root.querySelector(".rb-roll .dice3d");
    if (!slot) { this.run = false; return; }
    if (!this.init()) return;
    if (this.canvas.parentNode !== slot) slot.appendChild(this.canvas);
    const btn = slot.closest("button");
    this.hover = btn.matches(":hover");
    btn.addEventListener("pointerenter", () => { this.hover = true; });
    btn.addEventListener("pointerleave", () => { this.hover = false; });
    const px = Math.round(slot.getBoundingClientRect().width) || 40;
    if (px !== this.size) { this.size = px; this.renderer.setSize(px, px, false); this.draw(); }
    this.active = !btn.disabled;
    this.canvas.style.opacity = this.fade.toFixed(3);
    this.wake();
  }

  draw() { this.renderer.render(this.scene, this.camera); }

  // targets for the current state: speed 1 and full color when active, 0 and dimmed otherwise
  target() {
    return { speed: this.active && !this.reduced ? (this.hover ? HOVER_SPIN : 1) : 0, fade: this.active ? 1 : DIM };
  }

  wake() {
    if (this.run) return;
    this.run = true;
    this.last = performance.now();
    const tick = now => {
      if (!this.run || !this.canvas.isConnected) { this.run = false; return; }
      const f = Math.max(0, Math.min(4, (now - this.last) / (1000 / 60)));   // frames passed (60 fps = 1)
      this.last = now;
      const t = this.target();
      const ease = 1 - Math.pow(1 - EASE, f);
      this.speed += (t.speed - this.speed) * ease;
      this.fade += (t.fade - this.fade) * ease;
      if (Math.abs(t.speed - this.speed) < 0.003) this.speed = t.speed;
      if (Math.abs(t.fade - this.fade) < 0.003) this.fade = t.fade;
      this.die.rotation.x += SPIN.x * this.speed * f;
      this.die.rotation.y += SPIN.y * this.speed * f;
      this.canvas.style.opacity = this.fade.toFixed(3);
      this.draw();
      if (this.speed === 0 && this.fade === t.fade) { this.run = false; return; }   // settled and still
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
}

export const RollDie = new RollDieView();
