// 3D board with Three.js: wooden board, fields, pawns, tunnels, move preview.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { boardFor } from "./boards.js";
import { TUN, YARD } from "./engine.js";
import { sound } from "./sound.js";

export const COLORS = ["#d9534f", "#2f7fd0", "#4f9a2a", "#d08a12", "#6a5ccf", "#159a7a"];
export const LIGHT = ["#fbe3e2", "#dceafb", "#e3f1d8", "#fbefd6", "#e9e6fb", "#d8f2ea"];
const HILITE = "#ffc400";
const FIELD_R = 0.43;
const GATE_SCALE = 1.12;
// rank colors and the pawn's progress line (from its foot almost to its head)
const SILVER = "#c3c9d1", GOLD = "#e0a810", GOLD_BRIGHT = "#ffd21a";
const BAR_W = 0.1, BAR_H = 0.8, BAR_Y = 0.1, BAR_Z = 0.22;
// per pawn color (COLORS): light turquoise on red, yellow on blue, light pink on green, navy on
// orange, yellow on purple, coral on teal
const BAR_COLORS = ["#9ff0f0", "#ffd84a", "#ffb3e0", "#1f3a93", "#ffe066", "#ff9f8a"];
const TOP = 0.0;              // board surface height
const FIELD_H = 0.07;
const TABLE_Y = -0.62;
// dice: the number on each face of the box, in three.js face order (+x, -x, +y, -y, +z, -z)
const DIE_FACES = [2, 5, 1, 6, 3, 4];
const DIE_NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const DIE_MIN_PX = 28;        // a die is never drawn smaller than this on the screen (its touch area is larger)

function canvasTex(w, h, draw, rotation = 0) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.center.set(0.5, 0.5);
  t.rotation = rotation;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// A classic "Mensch" pawn: round foot, slim body, ball head.
function pawnGeometry() {
  const pts = [
    [0, 0], [0.36, 0], [0.38, 0.05], [0.33, 0.12], [0.2, 0.2], [0.15, 0.35],
    [0.12, 0.52], [0.2, 0.58], [0.2, 0.61], [0.1, 0.64],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const body = new THREE.LatheGeometry(pts, 40);
  const head = new THREE.SphereGeometry(0.19, 32, 20);
  head.translate(0, 0.79, 0);
  return [body, head];
}

export class Board3D {
  constructor(container, opts = {}) {
    this.container = container;
    this.onPick = opts.onPick || (() => {});
    this.onContext = opts.onContext || (() => {});
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#efe9dc");
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.46;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 45;
    this.setViewMode(false);

    this.scene.add(new THREE.HemisphereLight("#fffaf0", "#8a7a60", 1.6));
    const sun = new THREE.DirectionalLight("#ffffff", 1.6);
    sun.position.set(-8, 18, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -14; sc.right = 14; sc.top = 14; sc.bottom = -14; sc.near = 1; sc.far = 50;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);

    // table
    const table = new THREE.Mesh(new THREE.CircleGeometry(60, 64),
      new THREE.MeshStandardMaterial({ color: "#d9cfbb", roughness: 1 }));
    table.rotation.x = -Math.PI / 2;
    table.position.y = TABLE_Y;
    table.receiveShadow = true;
    this.scene.add(table);

    this.boardGroup = new THREE.Group();
    this.tunnelGroup = new THREE.Group();
    this.previewGroup = new THREE.Group();
    this.pieceGroup = new THREE.Group();
    this.targetGroup = new THREE.Group();
    this.diceGroup = new THREE.Group();
    this.scene.add(this.targetGroup, this.boardGroup, this.tunnelGroup, this.previewGroup, this.pieceGroup, this.diceGroup);
    this.dice = [];

    this.pawnGeo = pawnGeometry();
    this.pieceMeshes = new Map();   // "col,i" -> group
    this.hunterMeshes = new Map();  // player -> group
    this.labelTex = new Map();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.clock = new THREE.Clock();
    this.game = null;

    const el = this.renderer.domElement;
    let down = null;
    el.addEventListener("pointerdown", e => { down = [e.clientX, e.clientY]; });
    el.addEventListener("pointerup", e => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5 || e.button !== 0) return;
      if (!this.viewMode) this.onPick(this.pick(e), e);
    });
    // Outside view mode a drag that starts on a free spot (not on a die, a piece or a target
    // field) turns the board, and the wheel always zooms. A plain click still picks, so a field
    // (the hunter's gate) stays clickable. The capture listeners run before OrbitControls.
    container.addEventListener("pointerdown", e => {
      if (e.target !== el || !e.isPrimary || this.viewMode) return;
      this.controls.enabled = !!this.game && this.freeSpot(e);
    }, true);
    container.addEventListener("wheel", e => {
      if (e.target === el && !this.viewMode && this.game) this.controls.enabled = true;
    }, { capture: true, passive: true });
    const reset = () => setTimeout(() => { if (!this.viewMode) this.controls.enabled = false; });
    el.addEventListener("wheel", e => { if (!e.buttons) reset(); }, { passive: true });
    window.addEventListener("pointerup", reset);
    window.addEventListener("pointercancel", reset);
    el.addEventListener("pointermove", e => {
      if (this.viewMode || e.buttons || e.pointerType !== "mouse" || !this.game) return;
      el.style.cursor = this.freeSpot(e) ? "grab" : "default";
    });
    el.addEventListener("contextmenu", e => {          // right-click on a die (debug dice: one less)
      e.preventDefault();
      if (!this.viewMode) this.onContext(this.pick(e), e);
    });
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  resize() {
    const w = Math.max(10, this.container.clientWidth), h = Math.max(10, this.container.clientHeight);
    if (w === this.size?.[0] && h === this.size?.[1]) return;
    this.size = [w, h];
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + "px";
    this.renderer.domElement.style.height = h + "px";
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.game && this.view) {
      const sph = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
      this.placeCamera(sph.theta, sph.phi, this.viewDistance(sph.phi, sph.theta));
    }
    this.renderer.render(this.scene, this.camera);   // a resized canvas is blank until drawn: draw now, before the page shows it
  }

  // In view mode the mouse or fingers turn, move and zoom the board from anywhere, and pieces
  // and dice cannot be clicked. Outside it only free spots turn the board (no moving), so a
  // click on a piece never turns it by accident. Preset views work in both modes.
  setViewMode(on) {
    this.viewMode = on;
    this.controls.enabled = on;
    this.controls.enablePan = on;
    this.renderer.domElement.style.cursor = on ? "grab" : "default";
    this.container.classList.toggle("viewmode", on);
  }

  // ------------------------------------------------------------ views
  // The camera sits on a sphere around the board centre: `polar` is the angle from straight
  // above (0 = top view), `az` turns around the board (0 = from the front edge).
  static TILT = { top: 0.0005, angled: 0.62, low: 1.0 };

  // (the square board seen over a corner needs a little more room)
  viewDistance(polar, az = 0) {
    const r = this.n === 4 ? 6.4 * (1 + 0.16 * Math.abs(Math.sin(2 * az))) : this.data.extent;
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const fit = Math.max(r / Math.tan(vfov / 2), r / (Math.tan(vfov / 2) * this.camera.aspect));
    return fit * (polar > 0.8 ? 0.9 : 1.05 + 0.08 * polar);
  }

  placeCamera(az, polar, dist) {
    const t = this.controls.target;
    this.camera.position.set(t.x + dist * Math.sin(polar) * Math.sin(az), t.y + dist * Math.cos(polar),
      t.z + dist * Math.sin(polar) * Math.cos(az));
    this.camera.lookAt(t);
    this.controls.update();
  }

  // Start position: angled, from the front, or from the side of the given colors' yards.
  fitView(colors = null) {
    this.controls.target.set(0, 0, 0.3);
    const az = colors ? this.sideAz(colors) : 0;
    this.view = { az, polar: Board3D.TILT.angled };
    this.anim = null;
    this.placeCamera(az, this.view.polar, this.viewDistance(this.view.polar, az));
  }

  // The camera angle that puts these colors' yards nearest the viewer (both of a player's
  // neighbouring colors; for opposite colors the first one's).
  sideAz(colors) {
    const mid = c => { const y = this.data.yard[c]; return [y.reduce((a, p) => a + p[0], 0) / y.length, y.reduce((a, p) => a + p[1], 0) / y.length]; };
    let [x, z] = colors.map(mid).reduce((a, b) => [a[0] + b[0], a[1] + b[1]]);
    if (Math.hypot(x, z) < 1) [x, z] = mid(colors[0]);
    return Math.atan2(x, z);
  }

  // Animate to a preset: {tilt: "top"|"angled"|"low"}, {turn: degrees}, {side: color}.
  setView(v) {
    const sph = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    let az = sph.theta, polar = sph.phi;
    if (v.tilt) polar = Board3D.TILT[v.tilt];
    if (v.turn) az += THREE.MathUtils.degToRad(v.turn);
    if (v.side !== undefined) az = this.sideAz([v.side]);
    let d = az - sph.theta;                          // shortest way round
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.anim = { t0: performance.now(), from: [sph.theta, sph.phi, sph.radius],
      to: [sph.theta + d, polar, this.viewDistance(polar, sph.theta + d)] };
    this.controls.target.set(0, 0, 0.3);
  }

  stepAnim() {
    const a = this.anim;
    if (!a) return;
    const u = Math.min(1, (performance.now() - a.t0) / 650);
    const e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
    const v = a.from.map((x, i) => x + (a.to[i] - x) * e);
    this.placeCamera(v[0], Math.max(0.0005, v[1]), v[2]);
    if (u >= 1) this.anim = null;
  }

  // A red "not allowed" sign where the player clicked; it fades out by itself.
  forbid(ev) {
    if (!ev) return;
    const el = document.createElement("div");
    el.className = "forbid";
    el.style.left = ev.clientX + "px";
    el.style.top = ev.clientY + "px";
    el.innerHTML = '<svg viewBox="0 0 40 40" width="44" height="44"><circle cx="20" cy="20" r="16" fill="rgba(255,255,255,.85)" stroke="#d62828" stroke-width="5"/><line x1="9" y1="31" x2="31" y2="9" stroke="#d62828" stroke-width="5" stroke-linecap="round"/></svg>';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 650);
  }

  // A move is stopped by an opponent's wall or castle: a red ring pulses under each piece of
  // that structure, and a wall or castle sign with a small "not allowed" badge pops up above it,
  // shakes and fades out. block = { color, cells, castle } from Game.blockerOf; st = the state shown.
  forbidStructure(st, block, ev) {
    const g = this.game, rect = this.renderer.domElement.getBoundingClientRect();
    const cells = new Set(block.cells);
    const toScreen = v => { v.project(this.camera); return [rect.left + (v.x + 1) / 2 * rect.width, rect.top + (1 - v.y) / 2 * rect.height]; };
    const feet = [], tops = [];
    st.pos[block.color].forEach((rel, i) => {
      if (rel < 0 || rel >= g.L || !cells.has(g.absOf(block.color, rel))) return;
      const grp = this.pieceMeshes.get(`${block.color},${i}`);
      if (!grp) return;
      const v = new THREE.Vector3();
      grp.getWorldPosition(v);
      feet.push(toScreen(v.clone()));
      tops.push(toScreen(v.clone().setY(v.y + 1.1)));
    });
    if (!feet.length) return this.forbid(ev);
    const add = (cls, x, y, html, ms) => {
      const el = document.createElement("div");
      el.className = cls;
      el.style.left = x + "px";
      el.style.top = y + "px";
      el.innerHTML = html;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), ms);
    };
    for (const [x, y] of feet) add("forbid-ring", x, y, "", 1300);
    const x = tops.reduce((s, p) => s + p[0], 0) / tops.length, y = Math.min(...tops.map(p => p[1]));
    const wall = '<g fill="#c0703f" stroke="#5a2e17" stroke-width="1.4"><rect x="4" y="14" width="14" height="8"/><rect x="18" y="14" width="14" height="8"/><rect x="4" y="22" width="7" height="8"/><rect x="11" y="22" width="14" height="8"/><rect x="25" y="22" width="7" height="8"/><rect x="4" y="30" width="14" height="8"/><rect x="18" y="30" width="14" height="8"/></g>';
    const castle = '<path d="M4 38V10h5v5h4v-5h5v5h4v-5h5v5h4v-5h5v28H24v-8a5 5 0 0 0-10 0v8z" fill="#a3a3a3" stroke="#444" stroke-width="1.5" stroke-linejoin="round"/>';
    const ban = '<circle cx="34" cy="34" r="9" fill="#fff" stroke="#d62828" stroke-width="3.2"/><line x1="28" y1="40" x2="40" y2="28" stroke="#d62828" stroke-width="3.2" stroke-linecap="round"/>';
    add("forbid-struct", x, y, `<svg viewBox="0 0 46 46" width="60" height="60">${block.castle ? castle : wall}${ban}</svg>`, 1300);
  }

  // ------------------------------------------------------------ board
  setGame(game, playerName) {
    this.game = game;
    this.playerName = playerName;    // (playerIndex) -> display text
    this.n = game.cfg.n_colors;
    this.data = boardFor(this.n, game.cfg.corridor_len);
    for (const g of [this.boardGroup, this.tunnelGroup, this.previewGroup, this.pieceGroup, this.targetGroup]) g.clear();
    this.pieceMeshes.clear();
    this.resetShine();
    this.hunterMeshes.clear();
    if (this.hunterGhosts) this.hunterGhosts.clear();
    this.diceGroup.clear();
    this.dice = [];
    this.buildBoard();
    this.buildPieces();
    this.fitView();
  }

  // Rebuild the board (player names change with the language); the camera stays.
  relabel() {
    this.boardGroup.clear();
    this.buildBoard();
  }

  // forget the shining nests (new game)
  resetShine() {
    this.shining = new Set();
    if (this.fx) for (const f of this.fx) this.scene.remove(f.sp);
    this.fx = [];
  }

  xz(p, y = 0) { return new THREE.Vector3(p[0], y, p[1]); }

  numberTexture(n, ring) {
    return canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, w, h);
      if (ring) {
        g.strokeStyle = ring; g.lineWidth = 9;
        g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.stroke();
      }
      g.fillStyle = "#c9c6bd";
      g.font = "500 44px Vazirmatn, sans-serif";
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(String(n), 64, 68);
    }, Math.PI / 2);
  }

  field(pos, color, { r = FIELD_R, top = null, side = "#e8e4da", h = FIELD_H } = {}) {
    const geo = new THREE.CylinderGeometry(r, r, h, 40);
    const sideM = new THREE.MeshStandardMaterial({ color: side, roughness: 0.7 });
    const topM = top ? new THREE.MeshStandardMaterial({ map: top, roughness: 0.6 })
      : new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
    const m = new THREE.Mesh(geo, [sideM, topM, sideM]);
    m.position.copy(this.xz(pos, TOP + h / 2));
    m.receiveShadow = true;
    this.boardGroup.add(m);
    return m;
  }

  ring(pos, color, r, w = 0.05, y = TOP + FIELD_H + 0.005) {
    const m = new THREE.Mesh(new THREE.RingGeometry(r - w, r, 48),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    m.position.copy(this.xz(pos, y));
    this.boardGroup.add(m);
    return m;
  }

  // Flat text on the board. upright: it turns with the camera, so it always reads the right way up.
  flatText(text, pos, color, size = 0.6, bold = true, upright = false) {
    const font = `${bold ? 700 : 400} 64px Vazirmatn, sans-serif`;
    const probe = document.createElement("canvas").getContext("2d");
    probe.font = font;
    const tw = Math.ceil(probe.measureText(text).width) + 24;
    const tex = canvasTex(tw, 96, (g, w, h) => {
      g.font = font;
      g.fillStyle = color;
      g.textAlign = "center"; g.textBaseline = "middle";
      g.direction = /[؀-ۿ]/.test(text) ? "rtl" : "ltr";
      g.fillText(text, w / 2, h / 2 + 4);
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size * tw / 96, size),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    if (!upright) {
      m.position.copy(this.xz(pos, TOP + 0.01));
      this.boardGroup.add(m);
      return m;
    }
    const grp = new THREE.Group();
    grp.position.copy(this.xz(pos, TOP + 0.01));
    grp.add(m);
    this.boardGroup.add(grp);
    this.uprightLabels.push(grp);
    return grp;
  }

  // the camera's turn around the board: 0 = from the front edge
  cameraAzimuth() {
    const c = this.camera.position, t = this.controls.target;
    return Math.atan2(c.x - t.x, c.z - t.z);
  }

  buildBoard() {
    const d = this.data, g = this.game, n = this.n, cl = g.cfg.corridor_len;
    this.uprightLabels = [];
    // wooden board
    let shape;
    if (n === 4) {
      shape = new THREE.Shape();
      const s = 5.7, rr = 0.35;
      shape.moveTo(-s + rr, -s);
      shape.lineTo(s - rr, -s); shape.quadraticCurveTo(s, -s, s, -s + rr);
      shape.lineTo(s, s - rr); shape.quadraticCurveTo(s, s, s - rr, s);
      shape.lineTo(-s + rr, s); shape.quadraticCurveTo(-s, s, -s, s - rr);
      shape.lineTo(-s, -s + rr); shape.quadraticCurveTo(-s, -s, -s + rr, -s);
    } else {
      shape = new THREE.Shape(d.outline.map(p => new THREE.Vector2(p[0], -p[1])));
    }
    const slab = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, { depth: 0.55, bevelEnabled: true, bevelThickness: 0.05,
        bevelSize: 0.06, bevelSegments: 3 }),
      [new THREE.MeshStandardMaterial({ color: n === 4 ? "#f7e8c4" : "#f0e6c8", roughness: 0.85 }),
       new THREE.MeshStandardMaterial({ color: n === 4 ? "#c83c32" : "#b59c6c", roughness: 0.7 })]);
    slab.rotation.x = -Math.PI / 2;
    slab.position.y = TOP - 0.6;
    slab.castShadow = true;
    slab.receiveShadow = true;
    this.boardGroup.add(slab);
    if (n === 4) {                    // red frame line like the classic board
      const s = 5.45, y = TOP + 0.011;
      const fr = new THREE.Line(new THREE.BufferGeometry().setFromPoints(
        [[-s, -s], [s, -s], [s, s], [-s, s], [-s, -s]].map(p => this.xz(p, y))),
        new THREE.LineBasicMaterial({ color: "#c83c32" }));
      this.boardGroup.add(fr);
    }

    // lines between track fields
    const pts = d.track.concat([d.track[0]]).map(p => this.xz(p, TOP + 0.012));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: "#a8a294" }));
    this.boardGroup.add(line);

    // track
    for (let a = 0; a < g.L; a++) {
      const p = d.track[a];
      let f;
      if (a % cl === 0) {
        const c = a / cl;
        f = this.field(p, COLORS[c], { r: FIELD_R * GATE_SCALE, h: FIELD_H * 1.6, side: COLORS[c] });
      } else {
        const thr = a % cl === cl - 1 ? ((a + 1) / cl) % n : null;
        f = this.field(p, null, { top: this.numberTexture(a + 1, thr !== null ? COLORS[thr] : null) });
      }
      f.userData.field = a;
    }
    // nests and yards
    for (let c = 0; c < n; c++) {
      this.nestFields = this.nestFields || {};
      this.nestFields[c] = [];
      for (const p of d.home[c]) {
        this.nestFields[c].push(this.field(p, LIGHT[c], { side: LIGHT[c] }));
        this.ring(p, COLORS[c], FIELD_R, 0.04);
      }
      for (const p of d.yard[c]) {
        this.field(p, LIGHT[c], { r: FIELD_R * 0.95, h: 0.03, side: LIGHT[c] });
      }
      if (g.owner[c] !== null) this.flatText(this.playerName(g.owner[c]), d.label[c], COLORS[c], 0.62, true, true);
    }
  }

  // ------------------------------------------------------------ pieces
  numberSprite(text, color) {
    const tex = canvasTex(96, 96, (g, w, h) => {
      g.fillStyle = color;
      g.beginPath(); g.arc(48, 48, 44, 0, Math.PI * 2); g.fill();
      g.strokeStyle = "#ffffff"; g.lineWidth = 7; g.stroke();
      g.fillStyle = "#ffffff";
      g.font = "700 56px Vazirmatn, sans-serif";
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(text, 48, 54);
    });
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    s.scale.set(0.36, 0.36, 1);
    s.renderOrder = 10;
    return s;
  }

  buildPieces() {
    const g = this.game;
    for (let col = 0; col < this.n; col++) {
      if (g.owner[col] === null) continue;
      for (let i = 0; i < g.cfg.pieces_per_color; i++) {
        const mat = new THREE.MeshStandardMaterial({ color: COLORS[col], roughness: 0.35, metalness: 0.05 });
        const grp = new THREE.Group();
        for (const geo of this.pawnGeo) {
          const m = new THREE.Mesh(geo, mat);
          m.castShadow = true;
          m.userData.piece = ["p", col, i];
          grp.add(m);
        }
        const lab = this.numberSprite(String(i + 1), COLORS[col]);
        lab.position.y = 1.18;
        grp.add(lab);
        const gold = new THREE.MeshStandardMaterial({ color: "#d4a017", metalness: 0.6, roughness: 0.3 });
        const ring1 = new THREE.MeshStandardMaterial({ color: SILVER, metalness: 0.6, roughness: 0.3 });
        const r1 = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.035, 10, 40), ring1);
        r1.rotation.x = Math.PI / 2; r1.position.y = 0.06; r1.visible = false;
        const r2 = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.03, 10, 40), gold);
        r2.rotation.x = Math.PI / 2; r2.position.y = 0.66; r2.visible = false;
        const star = this.starSprite(), halo = this.haloSprite();
        star.position.y = halo.position.y = 1.52;
        star.visible = halo.visible = false;
        const bar = this.progressBar(col);
        grp.add(r1, r2, star, halo, bar);
        grp.userData = { piece: ["p", col, i], r1, r2, star, halo, bar, hop: 0 };
        const p = this.piecePos(g.state, col, i);
        grp.position.copy(p);
        this.pieceGroup.add(grp);
        this.pieceMeshes.set(`${col},${i}`, grp);
      }
    }
  }

  // The star over a ranked pawn's number, drawn white and tinted: silver for a general, turning
  // gold on the way to marshal; a marshal's is bright gold with a glow (haloSprite).
  starSprite() {
    const tex = canvasTex(80, 80, g => {
      const cx = 40, cy = 42, R = 32, r = 13.5;
      g.beginPath();
      for (let j = 0; j < 10; j++) {
        const a = -Math.PI / 2 + j * Math.PI / 5, rr = j % 2 ? r : R;
        g.lineTo(cx + rr * Math.cos(a), cy + rr * Math.sin(a));
      }
      g.closePath();
      g.fillStyle = "#ffffff"; g.fill();
      g.lineWidth = 5; g.strokeStyle = "#5a5a5a"; g.stroke();
    });
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    s.scale.set(0.42, 0.42, 1);
    s.renderOrder = 11;
    return s;
  }

  haloSprite() {
    const tex = canvasTex(96, 96, (g, w, h) => {
      const grd = g.createRadialGradient(48, 48, 4, 48, 48, 48);
      grd.addColorStop(0, "rgba(255,230,120,0.7)");
      grd.addColorStop(1, "rgba(255,200,40,0)");
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
    });
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, blending: THREE.AdditiveBlending }));
    s.scale.set(0.6, 0.6, 1);
    s.renderOrder = 10;
    return s;
  }

  // A line up the pawn's body that gets longer with every point the pawn has won itself, from its
  // foot to its head at marshal (the star tells the rank). In a color that stands out on that
  // pawn (BAR_COLORS), with a thin dark edge. It turns with the camera (around the pawn's axis),
  // sits on the side facing it and draws over the body.
  progressBar(col) {
    const grp = new THREE.Group();
    const plane = (w, h) => { const geo = new THREE.PlaneGeometry(w, h); geo.translate(0, h / 2, 0); return geo; };
    const bar = new THREE.Group();
    const edge = new THREE.Mesh(plane(BAR_W + 0.024, BAR_H),
      new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.45, depthTest: false }));
    edge.renderOrder = 9;
    const fill = new THREE.Mesh(plane(BAR_W, BAR_H),
      new THREE.MeshBasicMaterial({ color: BAR_COLORS[col], transparent: true, depthTest: false, toneMapped: false }));
    fill.position.z = 0.001;
    fill.renderOrder = 9.5;
    bar.add(edge, fill);
    bar.position.set(0, BAR_Y, BAR_Z);
    grp.add(bar);
    grp.userData = { bar };
    grp.visible = false;
    return grp;
  }

  // The hunter: a pawn of its color holding a bow; the arrow points the way it runs.
  // Local +x is where the arrow points; the group is turned to face along the track.
  hunterFigure(color, piece, opacity = 1) {
    const grp = new THREE.Group();
    const see = opacity < 1 ? { transparent: true, opacity } : {};
    const body = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.05, ...see });
    for (const geo of this.pawnGeo) {
      const m = new THREE.Mesh(geo, body);
      m.castShadow = opacity === 1;
      m.userData.piece = piece;
      grp.add(m);
    }
    const bow = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: "#7a4a1d", roughness: 0.6, ...see });
    const R = 0.36;
    const arc = new THREE.Mesh(new THREE.TorusGeometry(R, 0.035, 8, 24, Math.PI), wood);
    arc.rotation.z = -Math.PI / 2;                  // limbs up and down, bulging towards +x
    const str = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 2 * R, 6),
      new THREE.MeshBasicMaterial({ color: "#f4efe2", ...see }));
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.78, 6), wood);
    shaft.rotation.z = Math.PI / 2;
    shaft.position.x = 0.2;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 10),
      new THREE.MeshStandardMaterial({ color: "#d4a017", metalness: 0.6, roughness: 0.3, ...see }));
    tip.rotation.z = -Math.PI / 2;
    tip.position.x = 0.66;
    bow.add(arc, str, shaft, tip);
    bow.position.set(0.05, 0.6, 0.32);             // held at the pawn's side, at chest height
    bow.scale.setScalar(1.35);
    for (const m of bow.children) m.userData.piece = piece;
    grp.add(bow);
    grp.userData = { piece, mat: body };
    return grp;
  }

  // turn a hunter figure so that its arrow points along the track in direction dir
  aimHunter(grp, a, dir) {
    const L = this.data.track.length, p0 = this.data.track[a], p1 = this.data.track[((a + dir) % L + L) % L];
    grp.userData.aim = Math.atan2(-(p1[1] - p0[1]), p1[0] - p0[0]);
  }

  hunterMesh(p, color, dir) {
    const grp = this.hunterFigure(color, ["h", p]);
    grp.userData.dir = dir;
    this.pieceGroup.add(grp);
    return grp;
  }

  surfaceY() { return TOP + FIELD_H; }

  tunnelCells(col, a, b) {
    const g = this.game;
    const [E, X, T] = g.tunnelGeom(a, b);
    const p0 = this.data.track[g.absOf(col, E)], p2 = this.data.track[g.absOf(col, X)];
    const p1 = [(p0[0] + p2[0]) / 2 * 0.25, (p0[1] + p2[1]) / 2 * 0.25];
    const out = [];
    for (let j = 0; j < T + 2; j++) {
      const u = j / (T + 1);
      out.push([(1 - u) ** 2 * p0[0] + 2 * u * (1 - u) * p1[0] + u * u * p2[0],
                (1 - u) ** 2 * p0[1] + 2 * u * (1 - u) * p1[1] + u * u * p2[1]]);
    }
    return out;
  }

  piecePos2d(st, col, i) {
    const r = st.pos[col][i], g = this.game;
    if (r === TUN) {
      const t = g.tunnelOf(st, col, i);
      return this.tunnelCells(col, t[3], t[4])[t[5]];
    }
    if (r === YARD) return this.data.yard[col][i];
    if (r >= g.L) return this.data.home[col][r - g.L];
    return this.data.track[g.absOf(col, r)];
  }

  piecePos(st, col, i) {
    const r = st.pos[col][i];
    const y = r === TUN ? this.surfaceY() + 0.18 : (r === YARD ? TOP + 0.03 : this.surfaceY());
    return this.xz(this.piecePos2d(st, col, i), y);
  }

  // Move every pawn towards where the state says it is.
  sync(st, highlight = null) {
    this.shownState = st;
    const g = this.game;
    for (const [k, grp] of this.pieceMeshes) {
      const [col, i] = k.split(",").map(Number);
      grp.userData.target = this.piecePos(st, col, i);
      const kills = st.kills[col][i];
      const marshal = g.rank(kills) === 2, general = g.rank(kills) >= 1;
      const u = grp.userData, gp = g.cfg.general_points, mp = g.cfg.marshal_points;
      const t = marshal ? 1 : general ? (kills - gp) / (mp - gp) : 0;     // silver -> gold
      u.r1.visible = general;
      u.r1.material.color.set(marshal ? GOLD : SILVER);
      u.r2.visible = marshal;
      u.star.visible = general;
      u.star.material.color.copy(new THREE.Color(SILVER).lerp(new THREE.Color(marshal ? GOLD_BRIGHT : GOLD), t));
      u.star.scale.setScalar(marshal ? 0.36 : 0.42);
      u.halo.visible = marshal;
      u.bar.visible = kills > 0;
      u.bar.userData.bar.scale.y = Math.min(1, kills / mp);
      const sel = highlight && highlight[0] === "p" && highlight[1] === col && highlight[2] === i;
      grp.children[0].material.emissive?.set(sel ? "#664400" : "#000000");
      grp.scale.setScalar(sel ? 1.12 : 1);
    }
    st.hunters.forEach((h, p) => {
      let grp = this.hunterMeshes.get(p);
      if (grp && (!h || grp.userData.dir !== h[2])) {
        this.pieceGroup.remove(grp);
        this.hunterMeshes.delete(p);
        grp = null;
      }
      if (!h) return;
      if (!grp) {
        grp = this.hunterMesh(p, COLORS[h[0]], h[2]);
        grp.position.copy(this.xz(this.data.yard[h[0]][0], this.surfaceY()));
        this.hunterMeshes.set(p, grp);
      }
      grp.userData.target = this.xz(this.data.track[h[1]], this.surfaceY());
      grp.userData.dir = h[2];
      const sel = highlight && highlight[0] === "h" && highlight[1] === p;
      grp.userData.mat.emissive.set(sel ? "#664400" : "#000000");
      this.aimHunter(grp, h[1], h[2]);
    });
    // §9 a hunter that may come in waits as a pale diamond in its completed color's yard
    this.hunterGhosts = this.hunterGhosts || new Map();
    g.players.forEach((_, p) => {
      const cc = g.hunterEligible(p, st);
      let ghost = this.hunterGhosts.get(p);
      if (cc === null) {
        if (ghost) { this.pieceGroup.remove(ghost); this.hunterGhosts.delete(p); }
        return;
      }
      if (!ghost || ghost.userData.color !== cc) {
        if (ghost) this.pieceGroup.remove(ghost);
        ghost = this.hunterGhost(p, cc);
        this.hunterGhosts.set(p, ghost);
      }
      const sel = highlight && highlight[0] === "hn" && highlight[1] === p;
      ghost.userData.mat.opacity = sel ? 0.95 : 0.55;
      ghost.scale.setScalar(sel ? 1.15 : 1);
    });
    this.drawTunnels(st);
  }

  hunterGhost(p, color) {
    const y = this.data.yard[color];
    const cx = y.reduce((a, q) => a + q[0], 0) / y.length, cz = y.reduce((a, q) => a + q[1], 0) / y.length;
    const grp = this.hunterFigure(COLORS[color], ["hn", p], 0.55);
    grp.position.copy(this.xz([cx, cz], TOP + 0.03));
    grp.userData.aim = Math.atan2(cz, -cx);          // waiting: the arrow points to the board centre
    const lab = this.numberSprite("?", COLORS[color]);
    lab.position.y = 1.18;
    lab.scale.set(0.4, 0.4, 1);
    lab.userData.piece = ["hn", p];
    grp.add(lab);
    grp.userData.color = color;
    this.pieceGroup.add(grp);
    return grp;
  }

  // §13: tunnels are see-through tubes; the current player's in full, the others' fainter.
  // tunnelCands (set by the app while the Tunnels list is open): the tunnels that can be declared,
  // faint in their piece's color; the one under the mouse (extra) in full, in its color, thicker.
  drawTunnels(st, extra = null) {
    this.tunnelGroup.clear();
    const g = this.game;
    for (const t of st.tunnels) this.tunnelMesh(t[1], t[3], t[4], t[0] === g.turn ? 0.75 : 0.3);
    const same = (a, b) => a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] === b[4];
    for (const c of this.tunnelCands || []) if (!(extra && same(c, extra))) this.tunnelMesh(c[1], c[3], c[4], 0.6, null, 1, c);
    if (extra) this.tunnelMesh(extra[1], extra[3], extra[4], 0.95, null, 1.7, extra);
  }

  // pick: the tunnel's payload; a tap on its tube or its exit ring then declares it
  tunnelMesh(col, a, b, opacity, color = null, thick = 1, pick = null) {
    const cells = this.tunnelCells(col, a, b);
    const y = this.surfaceY() + 0.12;
    const curve = new THREE.CatmullRomCurve3(cells.map(p => this.xz(p, y)));
    const c = color || COLORS[col];
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.07 * thick, 10, false),
      new THREE.MeshStandardMaterial({ color: c, transparent: true, opacity, roughness: 0.4 }));
    this.tunnelGroup.add(tube);
    if (pick) {        // wide invisible touch areas: along the tube, and a disc on the exit
      const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
      const t2 = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.25, 6, false), hitMat);
      const ex = new THREE.Mesh(new THREE.CylinderGeometry(FIELD_R * 1.1, FIELD_R * 1.1, 0.1, 24), hitMat);
      ex.position.copy(this.xz(cells[cells.length - 1], y));
      t2.userData.tunnel = ex.userData.tunnel = pick;
      this.tunnelGroup.add(t2, ex);
    }
    cells.slice(1, -1).forEach(p => {
      const d = new THREE.Mesh(new THREE.CylinderGeometry(FIELD_R * 0.62, FIELD_R * 0.62, 0.05, 32),
        new THREE.MeshStandardMaterial({ color: "#ffffff", transparent: true, opacity: Math.min(1, opacity + 0.1) }));
      d.position.copy(this.xz(p, y));
      this.tunnelGroup.add(d);
      const r = new THREE.Mesh(new THREE.TorusGeometry(FIELD_R * 0.62, 0.035, 8, 32),
        new THREE.MeshStandardMaterial({ color: c, transparent: true, opacity }));
      r.rotation.x = Math.PI / 2;
      r.position.copy(this.xz(p, y + 0.03));
      this.tunnelGroup.add(r);
    });
    for (const p of [cells[0], cells[cells.length - 1]]) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(FIELD_R * 1.1, 0.045, 8, 40),
        new THREE.MeshStandardMaterial({ color: c, transparent: true, opacity }));
      r.rotation.x = Math.PI / 2;
      r.position.copy(this.xz(p, this.surfaceY() + 0.02));
      this.tunnelGroup.add(r);
    }
  }

  // Yellow arcs from where each mover is to where the play puts it.
  preview(play, tunnelPayload = null) {
    this.previewGroup.clear();
    const g = this.game;
    this.drawTunnels(this.shownState || g.state, tunnelPayload);
    if (!play) return;
    const cur = g.state, nxt = play.state;
    const mat = new THREE.MeshBasicMaterial({ color: HILITE });
    for (const s of play.steps) {
      const m = s.mover;
      let a, b;
      if (m[0] === "p") {
        a = this.piecePos(cur, m[1], m[2]); b = this.piecePos(nxt, m[1], m[2]);
      } else {
        const h0 = cur.hunters[m[1]], h1 = nxt.hunters[m[1]];
        const cc = h1 ? h1[0] : g._completedColor(m[1], cur);
        a = h0 ? this.xz(this.data.track[h0[1]], this.surfaceY()) : this.xz(this.data.yard[cc][0], this.surfaceY());
        b = h1 ? this.xz(this.data.track[h1[1]], this.surfaceY()) : a;
      }
      const mid = a.clone().add(b).multiplyScalar(0.5);
      mid.y += 0.6 + a.distanceTo(b) * 0.12;
      const curve = new THREE.QuadraticBezierCurve3(a.clone().setY(a.y + 0.3), mid, b.clone().setY(b.y + 0.3));
      this.previewGroup.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.05, 8, false), mat));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(FIELD_R * 1.3, 0.05, 8, 40), mat);
      ring.rotation.x = Math.PI / 2;
      ring.position.copy(b).setY(this.surfaceY() + 0.03);
      this.previewGroup.add(ring);
      for (const c of s.captures) {
        const x = new THREE.Mesh(new THREE.TorusGeometry(FIELD_R * 1.5, 0.05, 8, 40),
          new THREE.MeshBasicMaterial({ color: "#e0352b" }));
        x.rotation.x = Math.PI / 2;
        x.position.copy(this.xz(this.data.track[c.abs], this.surfaceY() + 0.03));
        this.previewGroup.add(x);
      }
    }
  }

  hunterPos(st, p) {
    const h = st.hunters[p];
    return this.xz(this.data.track[h[1]], this.surfaceY());
  }

  // Fields the selected piece can reach: pulsing rings with the die value; a click moves there.
  showTargets(list) {
    this.targetGroup.clear();
    for (const t of list) {
      const grp = new THREE.Group();
      grp.position.set(t.pos.x, this.surfaceY() + 0.02, t.pos.z);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(FIELD_R * 1.05, 0.07, 10, 40),
        new THREE.MeshBasicMaterial({ color: HILITE }));
      ring.rotation.x = Math.PI / 2;
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(FIELD_R * 1.1, FIELD_R * 1.1, 0.04, 32),
        new THREE.MeshBasicMaterial({ color: HILITE, transparent: true, opacity: 0.35, depthWrite: false }));
      const lab = this.numberSprite(String(t.label), "#b8860b");
      lab.position.y = 0.55;
      lab.scale.set(0.3, 0.3, 1);
      // a tall invisible column, so a pawn on the field does not hide the target from clicks
      const col = new THREE.Mesh(new THREE.CylinderGeometry(FIELD_R, FIELD_R, 1.2, 12),
        new THREE.MeshBasicMaterial({ visible: false }));
      col.position.y = 0.6;
      for (const m of [ring, disc, lab, col]) { m.userData.targetId = t.id; grp.add(m); }
      grp.userData.pulse = ring;
      this.targetGroup.add(grp);
    }
  }

  // nothing under the pointer that a click acts on: no die, no piece, no target field
  freeSpot(e) {
    const p = this.pick(e);
    return p.die === undefined && !p.piece && p.target === undefined;
  }

  pick(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    // dice first; their touch areas overlap, so the die whose middle is nearest to the ray wins
    let die = null, best = Infinity;
    for (const h of this.raycaster.intersectObjects(this.diceGroup.children, true)) {
      const k = h.object.userData.die;
      if (k === undefined || !this.dice[k]) continue;
      const d = this.raycaster.ray.distanceSqToPoint(this.dice[k].grp.position);
      if (d < best) { best = d; die = k; }
    }
    if (die !== null) return { die };
    // a tunnel drawn for declaring; the exit disc wins where tunnels from one entrance overlap
    const th = this.raycaster.intersectObjects(this.tunnelGroup.children, false).filter(h => h.object.userData.tunnel);
    if (th.length) return { tunnel: (th.find(h => h.object.geometry.type === "CylinderGeometry") || th[0]).object.userData.tunnel };
    for (const h of this.raycaster.intersectObjects(this.targetGroup.children, true))
      if (h.object.userData.targetId !== undefined) return { target: h.object.userData.targetId };
    for (const h of this.raycaster.intersectObjects(this.pieceGroup.children, true))
      if (h.object.userData.piece) return { piece: h.object.userData.piece };
    for (const h of this.raycaster.intersectObjects(this.boardGroup.children, false))
      if (h.object.userData.field !== undefined) return { field: h.object.userData.field };
    return {};
  }

  // ------------------------------------------------------------ move animation
  // A move is shown field by field: the piece hops along its path; a captured piece
  // flies back to its yard after the capturing piece has landed.
  isAnimating() { return performance.now() < (this.animEnd || 0); }

  // waypoints of mover m from state a to state b
  moverPath(a, b, m) {
    const g = this.game, L = g.L;
    if (m[0] === "p") {
      const [, col, i] = m, r0 = a.pos[col][i], r1 = b.pos[col][i];
      const at = st => this.piecePos(st, col, i);
      if (r0 === YARD || r0 === TUN || r1 === TUN || r1 === YARD || r0 === r1 || (r0 >= L && r1 < L)) return [at(a), at(b)];   // (nest swap: a hop)
      const end = r1 < r0 ? r1 + L : r1;               // r1 < r0: a lap again (tunnel debt)
      const pts = [];
      const tmp = a.copy();
      for (let x = r0; x <= end; x++) {
        tmp.pos[col][i] = end === r1 ? x : x % L;
        pts.push(this.piecePos(tmp, col, i));
      }
      return pts;
    }
    const p = m[1], h0 = a.hunters[p], h1 = b.hunters[p];
    if (!h1) return null;
    if (!h0) {                                          // the hunter comes in from the yard
      const ghost = this.hunterGhosts && this.hunterGhosts.get(p);
      const from = ghost ? ghost.position.clone() : this.xz(this.data.track[h1[1]], this.surfaceY());
      return [from, this.xz(this.data.track[h1[1]], this.surfaceY())];
    }
    const n = ((h1[1] - h0[1]) * h0[2] % L + L) % L, pts = [];
    for (let k = 0; k <= n; k++) pts.push(this.xz(this.data.track[((h0[1] + h0[2] * k) % L + L) % L], this.surfaceY()));
    return pts;
  }

  // a piece (or a hunter) comes out of the yard onto the track: the gate sound
  entersGate(a, b, m) {
    if (m[0] === "p") return a.pos[m[1]][m[2]] === YARD && b.pos[m[1]][m[2]] >= 0 && b.pos[m[1]][m[2]] < this.game.L;
    return !a.hunters[m[1]] && !!b.hunters[m[1]];
  }

  meshOf(m) {
    return m[0] === "p" ? this.pieceMeshes.get(`${m[1]},${m[2]}`) : this.hunterMeshes.get(m[1]);
  }

  // entries: [{before, after, step}] in order; hop = ms per field
  animateSteps(entries, hop = 140) {
    const now = performance.now();
    let t = Math.max(now, this.animEnd || 0);
    for (const { before, after, step } of entries) {
      const m = step.mover[0] === "hn" ? ["h", step.mover[1]] : step.mover;
      const grp = this.meshOf(m), pts = this.moverPath(before, after, step.mover);
      if (grp && pts && pts.length > 1) {
        const dur = hop * (pts.length - 1) * (pts.length === 2 ? 2.2 : 1);
        grp.userData.moves = (grp.userData.moves || []).concat([{ pts, t0: t, dur }]);
        if (this.entersGate(before, after, step.mover)) sound.at(t - performance.now(), () => sound.gate());
        t += dur;
        if (!step.captures.length) sound.at(t - performance.now(), () => sound.move());   // set down on the field
      }
      for (const c of step.captures) {
        const big = !!(c.demoted || c.yardRank);
        if (c === step.captures[0] || big) sound.at(t - performance.now(), () => sound.blast(big));
        if (big) {                             // a general or marshal is hit: a blast and a shake
          const at = this.xz(this.data.track[c.abs], this.surfaceY());
          setTimeout(() => this.boom(at), Math.max(0, t - performance.now()));
        }
        if (c.victim[0] !== "p") continue;
        const [, vc, vi] = c.victim, vg = this.meshOf(c.victim);
        if (!vg) continue;
        vg.userData.moves = (vg.userData.moves || []).concat([{ pts: [this.piecePos(before, vc, vi), this.piecePos(after, vc, vi)],
          t0: t, dur: 420, high: true }]);
        t += 220;
      }
    }
    this.animEnd = t + 60;
    return this.animEnd;
  }

  // position a piece from its animation queue; false when it has nothing to play
  playMove(grp, now) {
    const q = grp.userData.moves;
    if (!q || !q.length) return false;
    const mv = q[0];
    if (now < mv.t0) { grp.position.copy(mv.pts[0]); return true; }
    const u = Math.min(1, (now - mv.t0) / mv.dur), n = mv.pts.length - 1;
    const f = u * n, j = Math.min(n - 1, Math.floor(f)), w = f - j;
    const a = mv.pts[j], b = mv.pts[j + 1];
    grp.position.lerpVectors(a, b, w);
    grp.position.y += Math.sin(Math.PI * w) * (mv.high ? 1.6 : 0.45);
    if (u >= 1) { grp.position.copy(mv.pts[n]); q.shift(); }
    return true;
  }

  // ------------------------------------------------------------ scores view
  // Over every pawn: the points it has won (big) and how many pieces it has captured (×n).
  showScores(st, fmt) {
    if (this.scoreSprites) for (const sp of this.scoreSprites) sp.parent && sp.parent.remove(sp);
    this.scoreSprites = [];
    if (!st) return;
    for (const [k, grp] of this.pieceMeshes) {
      const [col, i] = k.split(",").map(Number);
      if (st.pos[col][i] === YARD && !st.earned[col][i] && !st.hits[col][i]) continue;   // keep the yards calm
      const pts = fmt(st.earned[col][i]), hits = fmt(st.hits[col][i]);
      const tex = canvasTex(168, 104, (g, w, h) => {
        g.fillStyle = "rgba(255,255,255,0.95)";
        g.strokeStyle = COLORS[col]; g.lineWidth = 6;
        g.beginPath(); g.roundRect(4, 4, w - 8, h - 8, 18); g.fill(); g.stroke();
        g.fillStyle = "#2b2b2b"; g.textAlign = "center"; g.textBaseline = "middle";
        g.font = "700 50px Vazirmatn, sans-serif";
        g.fillText(pts, w / 2, 40);
        g.font = "700 32px Vazirmatn, sans-serif";
        g.fillStyle = "#b83b37";
        g.fillText("× " + hits, w / 2, 80);
      });
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
      sp.scale.set(1.25, 0.77, 1);
      sp.position.y = 2.05;
      sp.renderOrder = 12;
      grp.add(sp);
      this.scoreSprites.push(sp);
    }
  }

  // ------------------------------------------------------------ dice on the board
  // The dice are thrown in the middle of the board, tumble, then hop to the yard of the player
  // whose turn it is (of that player's yards, the one nearest the camera) and are clicked there.
  // The engine always decides the numbers; the animation only lands on them.
  dieFaceTex(v) {
    this.dieTex = this.dieTex || {};
    return this.dieTex[v] || (this.dieTex[v] = canvasTex(128, 128, (g, w) => {
      g.fillStyle = "#fffdf6"; g.fillRect(0, 0, w, w);
      g.fillStyle = v === 1 ? "#c0302a" : "#2b2b2b";
      for (const i of PIPS[v]) {
        const x = 28 + 36 * (i % 3), y = 28 + 36 * Math.floor(i / 3);
        g.beginPath(); g.arc(x, y, v === 1 ? 17 : 12.5, 0, Math.PI * 2); g.fill();
      }
    }));
  }

  // the turn that shows number v on top, turned by yaw around the vertical
  dieQuat(v, yaw) {
    const n = new THREE.Vector3(...DIE_NORMALS[DIE_FACES.indexOf(v)]);
    const up = new THREE.Quaternion().setFromUnitVectors(n, new THREE.Vector3(0, 1, 0));
    return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiply(up);
  }

  makeDie(v) {
    const size = this.data.dice[0].size;
    const grp = new THREE.Group();
    const mats = DIE_FACES.map(f => new THREE.MeshStandardMaterial({ map: this.dieFaceTex(f), roughness: 0.45, transparent: true }));
    const cube = new THREE.Mesh(this.dieGeo || (this.dieGeo = new RoundedBoxGeometry(1, 1, 1, 4, 0.14)), mats);
    cube.scale.setScalar(size);
    cube.castShadow = true;
    // a larger invisible box: easy to hit with a finger
    const hit = new THREE.Mesh(new THREE.BoxGeometry(size * 1.7, size * 1.7, size * 1.7), new THREE.MeshBasicMaterial({ visible: false }));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(size * 0.85, 0.05, 10, 40),
      new THREE.MeshBasicMaterial({ color: HILITE, transparent: true }));
    ring.rotation.x = Math.PI / 2;
    ring.visible = false;
    const burnt = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.burntTex || (this.burntTex = canvasTex(96, 96, g => {
      g.strokeStyle = "#d62828"; g.lineWidth = 14; g.lineCap = "round";
      g.beginPath(); g.moveTo(20, 20); g.lineTo(76, 76); g.moveTo(76, 20); g.lineTo(20, 76); g.stroke();
    })), depthTest: false, transparent: true }));
    burnt.scale.setScalar(size * 0.9);
    burnt.renderOrder = 13;
    burnt.visible = false;
    grp.add(cube, hit, ring, burnt);
    this.diceGroup.add(grp);
    return grp.userData.die = { grp, cube, hit, ring, burnt, mats, value: v, state: "idle", opacity: 1, lift: 0, scale: 1,
      yaw: (Math.random() - 0.5) * 0.7 };
  }

  setDieIndex(d, k) { d.cube.userData.die = d.hit.userData.die = k; }

  // Where the dice of these colors sit now, and the row they lie along (pointing to the screen's right).
  diceSpot(colors) {
    const cam = this.camera.position;
    let best = null;
    for (const c of colors) {
      const s = this.data.dice[c];
      const d = Math.hypot(cam.x - s.at[0], cam.z - s.at[1]);
      if (!best || d < best.d) best = { d, s };
    }
    const s = best.s, az = this.cameraAzimuth();
    const right = [Math.cos(az), -Math.sin(az)];
    const sign = s.dir[0] * right[0] + s.dir[1] * right[1] < 0 ? -1 : 1;
    return { at: s.at, dir: [s.dir[0] * sign, s.dir[1] * sign], max: s.max };
  }

  // how many pixels one unit is at point p
  pxPerUnit(p) {
    const h = this.renderer.domElement.clientHeight || 1;
    const dist = this.camera.position.distanceTo(p);
    return h / (2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
  }

  // resting places of the current dice, in order
  diceRest() {
    const n = this.dice.length;
    if (!n) return [];
    const { at, dir, max } = this.diceSpot(this.diceColors);
    const size = this.data.dice[0].size, y = this.surfaceY() + size / 2;
    const ppu = this.pxPerUnit(this.xz(at, y));
    const scale = Math.min(max, Math.max(1, DIE_MIN_PX / (size * ppu)));
    const gap = size * 1.15 * scale;
    return this.dice.map((_, k) => ({ pos: new THREE.Vector3(at[0] + dir[0] * gap * (k - (n - 1) / 2), y + size * (scale - 1) / 2,
      at[1] + dir[1] * gap * (k - (n - 1) / 2)), scale }));
  }

  // Throw new dice for a player (colors = the player's colors); speed > 1 is slower.
  // The throw starts with the next frame drawn (not while the page is busy building).
  throwDice(values, colors, speed = 1) {
    this.clearDice();
    this.diceColors = colors;
    const n = values.length;
    const size = this.data.dice[0].size, az = this.cameraAzimuth();
    const right = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
    const t1 = 560 * speed, hold = 160 * speed, t2 = 380 * speed;
    values.forEach((v, k) => {
      const d = this.makeDie(v);
      this.setDieIndex(d, k);
      const land = right.clone().multiplyScalar(size * 1.5 * (k - (n - 1) / 2)).setY(this.surfaceY() + size / 2);
      land.x += (Math.random() - 0.5) * 0.25; land.z += (Math.random() - 0.5) * 0.25;
      const from = land.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 2.6, (Math.random() - 0.5) * 1.2));
      d.q1 = this.dieQuat(v, d.yaw - az);
      d.spinAxis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      d.spin = (5 + Math.random() * 3) * Math.PI;
      d.throw = { t0: null, delay: k * 40, t1, hold, t2, from, land };
      // the die hits the board where its bounce touches down (u = 0.2, 0.6, 1 in stepDice), then lands at the yard
      [[0.2, 1], [0.6, 0.45], [1, 0.15]].forEach(([u, v]) => sound.at(k * 40 + u * t1, () => sound.die(v)));
      sound.at(k * 40 + t1 + hold + t2, () => sound.die(0.3));
      d.grp.position.copy(from);
      this.dice.push(d);
    });
  }

  // still tumbling or on the way to the yard
  diceRolling() { return this.dice.some(d => d.throw); }

  // Show dice at the player's yard without a throw (debug: numbers being set by hand).
  placeDice(values, colors) {
    if (this.dice.length !== values.length || this.dice.some(d => d.throw)) {
      this.clearDice();
      this.diceColors = colors;
      values.forEach((v, k) => { const d = this.makeDie(v); this.setDieIndex(d, k); this.dice.push(d); });
      this.diceRest().forEach((r, k) => this.dice[k].grp.position.copy(r.pos));
    }
    this.diceColors = colors;
    values.forEach((v, k) => {
      const d = this.dice[k];
      if (d.value !== v || !d.q1) { d.value = v; d.q1 = this.dieQuat(v, d.yaw - this.cameraAzimuth()); d.cube.quaternion.copy(d.q1); }
    });
  }

  // Two of three dice are kept (indices into the current dice): the third fades, the two close up.
  keepDice(idx) {
    const keep = idx.map(k => this.dice[k]);
    for (const d of this.dice) if (!keep.includes(d)) this.fadeDie(d);
    this.dice = keep;
    keep.forEach((d, k) => this.setDieIndex(d, k));
  }

  fadeDie(d) {
    d.gone = performance.now();
    d.cube.userData.die = d.hit.userData.die = undefined;
  }

  clearDice() {
    for (const d of this.dice) this.fadeDie(d);
    this.dice = [];
  }

  // per die: idle, pick (can be clicked), sel (chosen), off (not for this piece), used, burnt, edit (debug)
  diceStates(states) { this.dice.forEach((d, k) => { d.state = states[k] || "idle"; }); }

  glowDice(ms) { this.diceGlowUntil = performance.now() + ms; }

  stepDice(now, k) {
    const rest = this.diceRest();
    const glow = now < (this.diceGlowUntil || 0);
    this.dice.forEach((d, i) => {
      const r = rest[i], st = d.state;
      const lift = st === "sel" ? 0.3 : 0;
      d.scale += (r.scale - d.scale) * k;
      const th = d.throw;
      if (th && th.t0 === null) th.t0 = now + th.delay;
      if (th) {
        const u1 = Math.max(0, (now - th.t0) / th.t1);
        if (u1 < 1) {                                       // tumbling in the middle of the board
          const e = 1 - (1 - u1) ** 2;
          d.grp.position.lerpVectors(th.from, th.land, e);
          d.grp.position.y = th.land.y + 2.6 * (1 - u1) ** 2 * Math.abs(Math.cos(u1 * Math.PI * 2.5));
          d.cube.quaternion.setFromAxisAngle(d.spinAxis, d.spin * (1 - e)).multiply(d.q1);
        } else {
          d.cube.quaternion.copy(d.q1);
          const u2 = (now - th.t0 - th.t1 - th.hold) / th.t2;
          if (u2 < 0) d.grp.position.copy(th.land);
          else if (u2 < 1) {                                // a hop to the player's yard
            const e = u2 < 0.5 ? 2 * u2 * u2 : 1 - (-2 * u2 + 2) ** 2 / 2;
            d.grp.position.lerpVectors(th.land, r.pos, e);
            d.grp.position.y += Math.sin(Math.PI * u2) * 0.9;
          } else {
            d.throw = null;
            d.grp.position.copy(r.pos);
          }
        }
      } else {
        const tg = r.pos.clone().setY(r.pos.y + lift);
        d.grp.position.lerp(tg, Math.min(1, k * 1.4));
      }
      d.cube.scale.setScalar(this.data.dice[0].size * d.scale);
      d.hit.scale.setScalar(d.scale);
      const op = { off: 0.45, used: 0.28, burnt: 0.4 }[st] ?? 1;
      d.opacity += (op - d.opacity) * Math.min(1, k * 1.4);
      d.ring.visible = !th && (st === "sel" || st === "pick" || st === "edit");
      d.ring.material.color.set(st === "edit" ? "#e0352b" : HILITE);
      d.ring.material.opacity = st === "pick" ? 0.55 : 1;
      d.ring.scale.setScalar(d.scale * (st === "sel" ? 1 + 0.08 * Math.sin(now / 160) : 1));
      d.ring.position.y = -d.grp.position.y + this.surfaceY() + 0.03;
      d.burnt.visible = st === "burnt" && !th;
      d.burnt.position.y = this.data.dice[0].size * d.scale * 0.9;
      const em = st === "sel" ? "#7a5c00" : (glow ? "#a07000" : "#000000");
      for (const m of d.mats) {
        m.opacity = d.opacity;
        m.emissive.set(em);
        m.emissiveIntensity = glow && st !== "sel" ? 0.6 + 0.4 * Math.sin(now / 120) : 1;
      }
    });
    // dice that are no longer in play fade away
    for (const grp of this.diceGroup.children.slice()) {
      const d = grp.userData.die;
      if (!d || !d.gone) continue;
      const u = (now - d.gone) / 320;
      if (u >= 1) { this.diceGroup.remove(grp); for (const m of d.mats) m.dispose(); continue; }
      for (const m of d.mats) m.opacity = d.opacity * (1 - u);
      d.ring.visible = false;
      d.burnt.material.opacity = 1 - u;
    }
  }

  // ------------------------------------------------------------ blast
  // A ranked piece is hit: a flash, a shock ring on the board, sparks and a short camera shake.
  boom(at) {
    const now = performance.now();
    this.shakeUntil = now + 550;
    this.fx = this.fx || [];
    const flash = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16),
      new THREE.MeshBasicMaterial({ color: "#ffb347", transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    flash.position.copy(at).setY(at.y + 0.5);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.42, 48),
      new THREE.MeshBasicMaterial({ color: "#ff7a1a", transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(at).setY(at.y + 0.03);
    this.scene.add(flash, ring);
    this.blasts = (this.blasts || []).concat([{ flash, ring, t0: now }]);
    const tex = this.boomTex || (this.boomTex = canvasTex(64, 64, (g) => {
      const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, "rgba(255,255,220,1)");
      grd.addColorStop(0.3, "rgba(255,150,40,0.9)");
      grd.addColorStop(1, "rgba(200,40,0,0)");
      g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    }));
    for (let k = 0; k < 26; k++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      sp.position.copy(at);
      this.scene.add(sp);
      const a = Math.random() * Math.PI * 2, v = 1.5 + Math.random() * 2.5;
      this.fx.push({ sp, base: at.clone().setY(at.y + 0.3), t0: now, life: 500 + Math.random() * 400,
        vx: Math.cos(a) * v, vz: Math.sin(a) * v, vy: 1 + Math.random() * 2.5 });
    }
  }

  stepBoom(now) {
    if (!this.blasts || !this.blasts.length) return;
    this.blasts = this.blasts.filter(b => {
      const u = (now - b.t0) / 800;
      if (u >= 1) { this.scene.remove(b.flash, b.ring); return false; }
      b.flash.scale.setScalar(0.4 + 2.2 * u);
      b.flash.material.opacity = 0.9 * (1 - u);
      b.ring.scale.setScalar(1 + 6 * u);
      b.ring.material.opacity = 0.85 * (1 - u);
      return true;
    });
  }

  // ------------------------------------------------------------ a full nest shines
  // A burst of golden sparkles over the nest, then its fields keep a soft golden glow.
  celebrate(color, burst = true) {
    this.shining = this.shining || new Set();
    this.shining.add(color);
    if (!burst) return;
    const tex = this.sparkTexture();
    this.fx = this.fx || [];
    const t0 = performance.now();
    for (const p of this.data.home[color]) {
      for (let k = 0; k < 14; k++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false,
          blending: THREE.AdditiveBlending }));
        const base = this.xz(p, this.surfaceY() + 0.1);
        sp.position.copy(base);
        sp.scale.setScalar(0.3);
        this.scene.add(sp);
        const a = Math.random() * Math.PI * 2, v = 0.4 + Math.random() * 0.9;
        this.fx.push({ sp, base, t0: t0 + Math.random() * 500, life: 1600 + Math.random() * 1000,
          vx: Math.cos(a) * v * 0.5, vz: Math.sin(a) * v * 0.5, vy: 1.4 + Math.random() * 1.6 });
      }
    }
  }

  sparkTexture() {
    return this.sparkTex || (this.sparkTex = canvasTex(64, 64, (g) => {
      const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, "rgba(255,255,255,1)");
      grd.addColorStop(0.2, "rgba(255,247,200,0.95)");
      grd.addColorStop(0.5, "rgba(255,225,120,0.35)");
      grd.addColorStop(1, "rgba(255,215,90,0)");
      g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    }));
  }

  // ------------------------------------------------------------ fireworks
  // The game is over: rockets rise from around the board and burst into colored sparks.
  fireworks() {
    const tex = this.sparkTexture();
    this.fx = this.fx || [];
    const t0 = performance.now(), R = this.n === 4 ? 4 : 6;
    const colors = ["#ff4d4d", "#ffd84a", "#4dd2ff", "#7dff6a", "#ff7ae6", "#ffffff", "#ffa13d"];
    const add = (base, delay, life, vx, vy, vz, color, gr, size, glow) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false,
        blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending, color }));   // colors show on the light table
      sp.position.copy(base); sp.visible = false;
      this.scene.add(sp);
      this.fx.push({ sp, base, t0: t0 + delay, life, vx, vy, vz, g: gr, size });
    };
    for (let b = 0; b < 12; b++) {                // all done within about 4 s
      const delay = b * 130 + Math.random() * 100, T = 0.7 + Math.random() * 0.2;
      const a = Math.random() * Math.PI * 2, rr = R * (0.3 + 0.7 * Math.random());
      const ground = new THREE.Vector3(Math.cos(a) * rr * 1.3, this.surfaceY(), Math.sin(a) * rr * 1.3);
      const top = new THREE.Vector3(Math.cos(a) * rr, 2.5 + Math.random() * 2, Math.sin(a) * rr);
      const gr = 0.9, vy = (top.y - ground.y + gr * T * T) / T;
      add(ground, delay, T * 1000, (top.x - ground.x) / T, vy, (top.z - ground.z) / T, "#fff2c0", gr, 0.6, true);
      sound.at(delay, () => sound.rocket(T * 1000));
      const color = colors[b % colors.length];
      for (let k = 0; k < 46; k++) {
        const u = Math.random() * 2 - 1, ph = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u), v = 2.2 + Math.random() * 0.8;
        add(top.clone(), delay + T * 1000, 1100 + Math.random() * 500, s * Math.cos(ph) * v, u * v + 0.4, s * Math.sin(ph) * v,
          k % 5 ? color : "#ffffff", 0.7, 1.4, !(k % 5));
      }
    }
  }

  stepShine(now) {
    if (this.fx && this.fx.length) {
      this.fx = this.fx.filter(f => {
        const t = (now - f.t0) / 1000;
        if (t < 0) { f.sp.visible = false; return true; }
        f.sp.visible = true;
        const u = t * 1000 / f.life;
        if (u >= 1) { this.scene.remove(f.sp); f.sp.material.dispose(); return false; }
        f.sp.position.set(f.base.x + f.vx * t, f.base.y + f.vy * t - (f.g ?? 0.9) * t * t, f.base.z + f.vz * t);
        f.sp.material.opacity = 1 - u;
        f.sp.scale.setScalar((0.12 + 0.18 * Math.sin(Math.PI * u) * (0.75 + 0.25 * Math.sin(t * 25))) * (f.size || 1));
        return true;
      });
    }
    if (this.shining && this.nestFields) {
      const glow = 0.35 + 0.25 * Math.sin(now / 350);
      for (const c of this.shining) {
        for (const m of this.nestFields[c] || []) {
          const top = Array.isArray(m.material) ? m.material[1] : m.material;
          top.emissive.set("#ffc400");
          top.emissiveIntensity = glow;
        }
      }
    }
  }

  turnToAim(grp, k) {
    const aim = grp.userData.aim;
    if (aim === undefined) return;
    let d = aim - grp.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    grp.rotation.y += d * Math.min(1, k * 1.5);
  }

  frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    const k = 1 - Math.exp(-dt * 9);
    const tnow = performance.now() / 1000;
    const now = performance.now();
    for (const grp of this.pieceGroup.children) {
      if (this.playMove(grp, now)) {
        this.turnToAim(grp, k);
        continue;
      }
      const tg = grp.userData.target;
      if (!tg) continue;
      const flat = new THREE.Vector3(tg.x - grp.position.x, 0, tg.z - grp.position.z);
      const dist = flat.length();
      grp.position.x += flat.x * k;
      grp.position.z += flat.z * k;
      const lift = Math.min(1.2, dist * 0.35);            // hop while moving
      grp.position.y += (tg.y + lift - grp.position.y) * Math.min(1, k * 1.5);
      this.turnToAim(grp, k);
    }
    this.stepAnim();
    if (this.uprightLabels) {
      const az = this.cameraAzimuth();
      for (const l of this.uprightLabels) l.rotation.y = az;
      for (const grp of this.pieceMeshes.values()) grp.userData.bar.rotation.y = az - grp.rotation.y;
    }
    this.stepDice(now, k);
    this.stepShine(now);
    this.stepBoom(now);
    const pulse = 1 + 0.12 * Math.sin(tnow * 6);
    for (const grp of this.targetGroup.children) grp.userData.pulse.scale.setScalar(pulse);
    this.controls.update();
    let shake = null;
    if (now < (this.shakeUntil || 0)) {        // the board trembles after a blast
      const amp = 0.18 * (this.shakeUntil - now) / 550;
      shake = new THREE.Vector3((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp);
      this.camera.position.add(shake);
    }
    this.renderer.render(this.scene, this.camera);
    if (shake) this.camera.position.sub(shake);
  }
}
