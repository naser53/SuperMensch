// 3D board with Three.js: wooden board, fields, pawns, tunnels, move preview.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { BOARDS } from "./boards.js";
import { TUN, YARD } from "./engine.js";

export const COLORS = ["#d9534f", "#2f7fd0", "#4f9a2a", "#d08a12", "#6a5ccf", "#159a7a"];
export const LIGHT = ["#fbe3e2", "#dceafb", "#e3f1d8", "#fbefd6", "#e9e6fb", "#d8f2ea"];
const HILITE = "#ffc400";
const FIELD_R = 0.43;
const GATE_SCALE = 1.12;
const TOP = 0.0;              // board surface height
const FIELD_H = 0.07;

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
    table.position.y = -0.62;
    table.receiveShadow = true;
    this.scene.add(table);

    this.boardGroup = new THREE.Group();
    this.tunnelGroup = new THREE.Group();
    this.previewGroup = new THREE.Group();
    this.pieceGroup = new THREE.Group();
    this.scene.add(this.boardGroup, this.tunnelGroup, this.previewGroup, this.pieceGroup);

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
      this.onPick(this.pick(e), e);
    });
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  resize() {
    const w = Math.max(10, this.container.clientWidth), h = Math.max(10, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + "px";
    this.renderer.domElement.style.height = h + "px";
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.game && this.view) {
      const sph = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
      this.placeCamera(sph.theta, sph.phi, this.viewDistance(sph.phi));
    }
  }

  // ------------------------------------------------------------ views
  // The camera sits on a sphere around the board centre: `polar` is the angle from straight
  // above (0 = top view), `az` turns around the board (0 = from the front edge).
  static TILT = { top: 0.0005, angled: 0.62, low: 1.0 };

  viewDistance(polar) {
    const r = this.n === 4 ? 6.4 : 9.2;
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

  // Start position: angled, from the front.
  fitView() {
    this.controls.target.set(0, 0, 0.3);
    this.view = { az: 0, polar: Board3D.TILT.angled };
    this.anim = null;
    this.placeCamera(0, this.view.polar, this.viewDistance(this.view.polar));
  }

  // Animate to a preset: {tilt: "top"|"angled"|"low"}, {turn: degrees}, {side: color}.
  setView(v) {
    const sph = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    let az = sph.theta, polar = sph.phi;
    if (v.tilt) polar = Board3D.TILT[v.tilt];
    if (v.turn) az += THREE.MathUtils.degToRad(v.turn);
    if (v.side !== undefined) {
      const y = this.data.yard[v.side];
      const cx = y.reduce((a, p) => a + p[0], 0) / y.length, cz = y.reduce((a, p) => a + p[1], 0) / y.length;
      az = Math.atan2(cx, cz);
    }
    let d = az - sph.theta;                          // shortest way round
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.anim = { t0: performance.now(), from: [sph.theta, sph.phi, sph.radius],
      to: [sph.theta + d, polar, this.viewDistance(polar)] };
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
    const r = this.container.getBoundingClientRect();
    const el = document.createElement("div");
    el.className = "forbid";
    el.style.left = ev.clientX - r.left + "px";
    el.style.top = ev.clientY - r.top + "px";
    el.innerHTML = '<svg viewBox="0 0 40 40" width="44" height="44"><circle cx="20" cy="20" r="16" fill="rgba(255,255,255,.85)" stroke="#d62828" stroke-width="5"/><line x1="9" y1="31" x2="31" y2="9" stroke="#d62828" stroke-width="5" stroke-linecap="round"/></svg>';
    this.container.appendChild(el);
    setTimeout(() => el.remove(), 650);
  }

  // ------------------------------------------------------------ board
  setGame(game, playerName) {
    this.game = game;
    this.playerName = playerName;    // (playerIndex) -> display text
    this.n = game.cfg.n_colors;
    this.data = BOARDS[String(this.n)];
    for (const g of [this.boardGroup, this.tunnelGroup, this.previewGroup, this.pieceGroup]) g.clear();
    this.pieceMeshes.clear();
    this.hunterMeshes.clear();
    this.buildBoard();
    this.buildPieces();
    this.fitView();
  }

  // Rebuild the board (player names change with the language); the camera stays.
  relabel() {
    this.boardGroup.clear();
    this.buildBoard();
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

  flatText(text, pos, color, size = 0.6, bold = true) {
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
    m.position.copy(this.xz(pos, TOP + 0.01));
    this.boardGroup.add(m);
    return m;
  }

  buildBoard() {
    const d = this.data, g = this.game, n = this.n, cl = g.cfg.corridor_len;
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
      for (const p of d.home[c]) {
        this.field(p, LIGHT[c], { side: LIGHT[c] });
        this.ring(p, COLORS[c], FIELD_R, 0.04);
      }
      for (const p of d.yard[c]) {
        this.field(p, LIGHT[c], { r: FIELD_R * 0.95, h: 0.03, side: LIGHT[c] });
      }
      if (g.owner[c] !== null) this.flatText(this.playerName(g.owner[c]), d.label[c], COLORS[c], 0.62);
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
        const r1 = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.035, 10, 40), gold);
        r1.rotation.x = Math.PI / 2; r1.position.y = 0.06; r1.visible = false;
        const r2 = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.03, 10, 40), gold);
        r2.rotation.x = Math.PI / 2; r2.position.y = 0.66; r2.visible = false;
        grp.add(r1, r2);
        grp.userData = { piece: ["p", col, i], r1, r2, hop: 0 };
        const p = this.piecePos(g.state, col, i);
        grp.position.copy(p);
        this.pieceGroup.add(grp);
        this.pieceMeshes.set(`${col},${i}`, grp);
      }
    }
  }

  hunterMesh(p, color) {
    const grp = new THREE.Group();
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.42),
      new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.2 }));
    m.position.y = 0.45; m.castShadow = true;
    m.userData.piece = ["h", p];
    grp.add(m);
    grp.userData = { piece: ["h", p], body: m };
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
      grp.userData.r1.visible = kills >= g.cfg.general_at;
      grp.userData.r2.visible = kills >= g.cfg.marshal_at;
      const sel = highlight && highlight[0] === "p" && highlight[1] === col && highlight[2] === i;
      grp.children[0].material.emissive?.set(sel ? "#664400" : "#000000");
      grp.scale.setScalar(sel ? 1.12 : 1);
    }
    st.hunters.forEach((h, p) => {
      let grp = this.hunterMeshes.get(p);
      if (!h) {
        if (grp) { this.pieceGroup.remove(grp); this.hunterMeshes.delete(p); }
        return;
      }
      if (!grp) {
        grp = this.hunterMesh(p, COLORS[h[0]]);
        grp.position.copy(this.xz(this.data.yard[h[0]][0], this.surfaceY()));
        this.hunterMeshes.set(p, grp);
      }
      grp.userData.target = this.xz(this.data.track[h[1]], this.surfaceY());
      grp.userData.dir = h[2];
    });
    this.drawTunnels(st);
  }

  // §13: tunnels are see-through tubes; the current player's in full, the others' fainter.
  drawTunnels(st, extra = null) {
    this.tunnelGroup.clear();
    const g = this.game;
    for (const t of st.tunnels) this.tunnelMesh(t[1], t[3], t[4], t[0] === g.turn ? 0.75 : 0.3);
    if (extra) this.tunnelMesh(extra[1], extra[3], extra[4], 0.95, HILITE);
  }

  tunnelMesh(col, a, b, opacity, color = null) {
    const cells = this.tunnelCells(col, a, b);
    const y = this.surfaceY() + 0.12;
    const curve = new THREE.CatmullRomCurve3(cells.map(p => this.xz(p, y)));
    const c = color || COLORS[col];
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.07, 10, false),
      new THREE.MeshStandardMaterial({ color: c, transparent: true, opacity, roughness: 0.4 }));
    this.tunnelGroup.add(tube);
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

  pick(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    for (const h of this.raycaster.intersectObjects(this.pieceGroup.children, true))
      if (h.object.userData.piece) return { piece: h.object.userData.piece };
    for (const h of this.raycaster.intersectObjects(this.boardGroup.children, false))
      if (h.object.userData.field !== undefined) return { field: h.object.userData.field };
    return {};
  }

  frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    const k = 1 - Math.exp(-dt * 9);
    const tnow = performance.now() / 1000;
    for (const grp of this.pieceGroup.children) {
      const tg = grp.userData.target;
      if (!tg) continue;
      const flat = new THREE.Vector3(tg.x - grp.position.x, 0, tg.z - grp.position.z);
      const dist = flat.length();
      grp.position.x += flat.x * k;
      grp.position.z += flat.z * k;
      const lift = Math.min(1.2, dist * 0.35);            // hop while moving
      grp.position.y += (tg.y + lift - grp.position.y) * Math.min(1, k * 1.5);
      if (grp.userData.body) grp.userData.body.rotation.y = tnow * 1.2 * (grp.userData.dir || 1);
    }
    this.stepAnim();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
