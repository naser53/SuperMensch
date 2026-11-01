// SuperMensch browser version: setup screen, side panel and game loop.
import { Option, Player } from "./engine.js";
import { SimpleAI } from "./ai.js";
import { Table, fingerprint } from "./table.js";
import { COLOR_NAMES, LANGS, LANG_NAMES, M, RTL, num, shape, t, tr } from "./i18n.js";
import { Board3D, COLORS } from "./render3d.js";
import { runCommand } from "./debugcmd.js";
import { VERSION } from "./version.js";
import { Config } from "./config.js";

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function load() {
  try { return JSON.parse(localStorage.getItem("supermensch") || "{}"); } catch { return {}; }
}
function save(d) {
  try { localStorage.setItem("supermensch", JSON.stringify(d)); } catch { /* private mode: no settings */ }
}

const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
// how long a hint stays on the board: a base time plus a little per character, capped
const TOAST_MS = 2600, TOAST_MS_PER_CHAR = 45, TOAST_MAX_MS = 8000;
const dieHtml = (v, cls, attrs) =>
  `<div class="die ${cls}" ${attrs}>` +
  Array.from({ length: 9 }, (_, i) => `<i class="${PIPS[v].includes(i) ? "on" : ""}"></i>`).join("") + "</div>";

// ribbon icons (inline SVG, drawn in the button's text color)
const svg = (body, size = 20) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const ICON = {
  // a small 3D die that turns slowly, so no face reads as a value
  die: '<span class="cube3d" aria-hidden="true"><span class="cube3d-in">' +
    [1, 2, 3, 4, 5, 6].map(v => `<span class="cf cf${v}">${Array.from({ length: 9 }, (_, i) => `<i class="${PIPS[v].includes(i) ? "on" : ""}"></i>`).join("")}</span>`).join("") +
    "</span></span>",
  card: svg('<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="9.5" cy="8" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="14.5" cy="16" r="1" fill="currentColor"/>'),
  cardSmall: svg('<rect x="6" y="3" width="12" height="18" rx="2"/>', 14),
  castle: svg('<path d="M4 21V9h3V5h3v4h4V5h3v4h3v12z"/><path d="M10 21v-5h4v5"/>'),
  tunnel: svg('<path d="M3 20v-6a9 9 0 0 1 18 0v6"/><path d="M7 20v-6a5 5 0 0 1 10 0v6"/>'),
  undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
  list: svg('<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>'),
  star: svg('<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.5" r="0.6" fill="currentColor"/>'),
  bug: svg('<rect x="8" y="7" width="8" height="12" rx="4"/><path d="M12 7V4M8 11H4M16 11h4M8 16H4M16 16h4M9 5l-2-2M15 5l2-2"/>'),
  speed: svg('<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-6"/>'),
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  stuck: svg('<path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9"/>', 14),
};

class App {
  constructor() {
    const st = load();
    this.lang = LANGS.includes(st.lang) ? st.lang : "en";
    this.setup = Object.assign({ colors: 6, mode: "two", n: 3, pairing: "opposite",
      seats: ["human", "ai", "ai", "ai", "ai", "ai"] }, st.setup || {});
    this.speed = Config.ANIM_SPEEDS[st.speed] ? st.speed : "fast";
    this.delay = Config.ANIM_PAUSE * Config.ANIM_SPEEDS[this.speed];
    this.follow = !!st.follow;
    this.offline = !!st.offline;       // the first page: rooms of the online server, or the offline game setup
    this.rooms = null;                 // null: loading · "error": no server · [rooms]
    this.pick = { id: null, seats: [] };
    this.debug = false;
    this.game = null;
    this.ais = {};
    this.aiPlan = null;
    this.sel = null;
    this.nextAi = 0;
    this.board = new Board3D($("#stage"), { onPick: (hit, ev) => this.boardClick(hit, ev),
      onContext: (hit, ev) => this.dieClick(hit, ev, -1) });
    const hint = document.createElement("div");
    hint.className = "hint3d";
    $("#stage").appendChild(hint);
    this.hint = hint;
    const toast = document.createElement("div");      // hints and warnings: shown on the board, then fade
    toast.className = "toast";
    $("#stage").appendChild(toast);
    this.toast = toast;
    this.toastHtml = "";
    const cmd = document.createElement("form");         // debug console: score / move / dice
    cmd.className = "cmdbox";
    cmd.hidden = true;
    cmd.innerHTML = '<input type="text" spellcheck="false" autocomplete="off" dir="ltr"><div class="cmd-out"></div>';
    cmd.addEventListener("submit", e => { e.preventDefault(); this.command(cmd.querySelector("input")); });
    $("#stage").appendChild(cmd);
    this.cmdBox = cmd;
    setInterval(() => this.tick(), 40);
    window.addEventListener("keydown", e => {
      if (e.key === "Escape" && !$("#info").hidden) { this.showInfo(false); return; }
      if (e.key === "Escape" && this.confirming) { this.askLeave(false); return; }
      if (e.key === "Escape" && this.game) this.askLeave(true);
    });
    this.showSetup();
  }

  T(key, params) { return esc(t(this.lang, key, params)); }
  S(x) { return esc(shape(tr(this.lang, x))); }
  get rtl() { return RTL.has(this.lang); }
  persist() { save({ lang: this.lang, setup: this.setup, speed: this.speed, follow: this.follow, offline: this.offline }); }

  // the open rooms of the server, with their players and the seats in play right now
  async loadRooms() {
    try {
      const r = await fetch(`${apiBase()}/api/games`, { cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      this.rooms = await r.json();
    } catch { this.rooms = "error"; }
    if (!this.game) this.render();
  }

  setLang(l) {
    this.lang = l;
    if (!$("#info").hidden) setTimeout(() => this.showInfo(true));
    this.persist();
    document.documentElement.lang = l;
    document.documentElement.dir = this.rtl ? "rtl" : "ltr";
    if (this.game) this.board.relabel();
    this.render();
  }

  langSelect() {
    return `<select data-act="lang" aria-label="${this.T("lang_label")}">` +
      LANGS.map(l => `<option value="${l}" ${l === this.lang ? "selected" : ""}>${LANG_NAMES[l]}</option>`).join("") +
      "</select>";
  }

  // ------------------------------------------------------------ setup screen
  seatColors(i) {
    const s = this.setup;
    if (s.mode === "two") {
      const half = s.colors / 2;
      return s.pairing === "opposite" ? [i, i + half] : [2 * i, 2 * i + 1];
    }
    return [this.fixPicks()[i]];
  }

  // One color per player: each seat picks its own color. Keeps the picks of the seats in play
  // valid and different; a seat without a valid pick gets the lowest free color.
  fixPicks() {
    const s = this.setup;
    const p = Array.isArray(s.picks) ? s.picks.slice() : [];
    const used = new Set();
    for (let i = 0; i < s.n; i++) {
      const c = p[i];
      if (Number.isInteger(c) && c >= 0 && c < s.colors && !used.has(c)) used.add(c);
      else p[i] = undefined;
    }
    for (let i = 0; i < s.n; i++)
      if (p[i] === undefined) { let c = 0; while (used.has(c)) c++; p[i] = c; used.add(c); }
    s.picks = p;
    return p;
  }

  // a tap on a color: take it; if another seat has it, the two seats swap colors
  pickColor(i, c) {
    const p = this.fixPicks();
    const j = p.findIndex((x, k) => k < this.setup.n && x === c);
    if (j >= 0 && j !== i) p[j] = p[i];
    p[i] = c;
  }

  // Leaving a running game for the menu asks first; a finished game just goes.
  askLeave(open) {
    let el = $("#confirm");
    if (open && (!this.game || this.game.over)) { this.showSetup(); return; }
    this.confirming = open;
    if (!open) { if (el) el.hidden = true; return; }
    if (!el) { el = document.createElement("div"); el.id = "confirm"; document.body.appendChild(el); }
    el.dir = this.rtl ? "rtl" : "ltr";
    el.innerHTML = `<div class="confirm-card"><p>${this.T(this.online ? "leave_q_online" : "leave_q")}</p><div class="acts">
      <button class="btn" data-act="leave_no">${this.T("leave_no")}</button>
      <button class="btn primary" data-act="leave_yes">${this.T("leave_yes")}</button></div></div>`;
    el.hidden = false;
  }

  showSetup() {
    if (this.online) {                                          // Exit: free this device's seats, back to the lobby
      const ws = this.online.ws;
      this.online.ws = null;
      try { ws.send(JSON.stringify({ t: "leave" })); } catch { /* not connected */ }
      setTimeout(() => { location.href = location.pathname; }, 150);
      return;
    }
    this.game = null;
    $("#setup").hidden = false;
    this.render();
  }

  renderSetup() {
    const s = this.setup, el = $("#setup");
    el.dir = this.rtl ? "rtl" : "ltr";
    const choice = (label, act, val, sel) =>
      `<button class="choice${sel ? " sel" : ""}" data-act="${act}" data-val="${val}">${label}</button>`;
    const nRange = s.mode === "two" ? s.colors / 2 : s.colors;
    let h = `<div class="card"><div class="top"><div><h1>${this.T("title")}</h1>
      <div class="muted">${this.T("subtitle")} · v${VERSION}</div></div>${this.langSelect()}</div>`;
    h += `<div class="choices">${choice((this.offline ? "☑ " : "☐ ") + this.T("offline_play"), "offline", "", this.offline)}</div>`;
    if (!this.offline) { el.innerHTML = h + this.roomsHtml() + "</div>"; return; }
    h += `<h2>${this.T("board")}</h2><div class="choices">` +
      choice(this.T("board6"), "colors", 6, s.colors === 6) + choice(this.T("board4"), "colors", 4, s.colors === 4) + "</div>";
    if (s.colors === 6) h += `<h2>${this.T("corridor")}</h2><div class="choices">` +
      Config.CORRIDORS.map(k => choice(this.T("corridor_n", { n: num(this.lang, k) }), "corridor", k, (s.corridor || 10) === k)).join("") + "</div>";
    h += `<h2>${this.T("dice_level")}</h2><div class="choices">` +
      choice(this.T("level_beginner"), "level", "beginner", (s.level || "beginner") === "beginner") +
      choice(this.T("level_intermediate"), "level", "intermediate", s.level === "intermediate") + "</div>";
    h += `<h2>${this.T("game_type")}</h2><div class="choices">` +
      choice(this.T("mode_two"), "mode", "two", s.mode === "two") + choice(this.T("mode_one"), "mode", "one", s.mode === "one") + "</div>";
    h += `<h2>${this.T("players")}</h2><div class="choices">`;
    for (let n = 2; n <= nRange; n++) h += choice(num(this.lang, n), "n", n, s.n === n);
    h += "</div>";
    if (s.mode === "two") {
      h += `<h2>${this.T("pairing")}</h2><div class="choices">` +
        choice(this.T("opposite"), "pairing", "opposite", s.pairing === "opposite") +
        choice(this.T("adjacent"), "pairing", "adjacent", s.pairing === "adjacent") + "</div>";
    }
    h += `<h2>${this.T("seats")}</h2>`;
    if (s.mode === "one") h += `<div class="muted small pick-hint">${this.T("pick_color")}</div>`;
    const picks = s.mode === "one" ? this.fixPicks() : null;
    for (let i = 0; i < s.n; i++) {
      const cols = this.seatColors(i);
      const who = t(this.lang, s.seats[i] === "human" ? "human" : "computer");
      const names = cols.map(c => COLOR_NAMES[this.lang][c]).join(tr(this.lang, M("and")));
      const nm = (s.names && s.names[i]) || "";
      const ph = t(this.lang, s.seats[i] === "ai" ? "player_ai" : "player_human", { n: i + 1 });
      h += `<div class="seat">${choice(esc(shape(tr(this.lang, M("seat", { n: i + 1, who, colors: names })))), "seat", i, false)}` +
        (picks
          ? `<span class="picks">` + Array.from({ length: s.colors }, (_, c) => {
              const mine = picks[i] === c, other = !mine && picks.slice(0, s.n).includes(c);
              const nm = esc(COLOR_NAMES[this.lang][c]);
              return `<button class="dot pick${mine ? " sel" : ""}${other ? " taken" : ""}" data-act="pick" data-val="${i}:${c}"` +
                ` style="background:${COLORS[c]}" title="${nm}" aria-label="${nm}" aria-pressed="${mine}"></button>`;
            }).join("") + "</span>"
          : cols.map(c => `<span class="dot" style="background:${COLORS[c]}"></span>`).join("")) +
        `<input class="name" type="text" maxlength="16" data-name="${i}" value="${esc(nm)}" placeholder="${esc(ph)}" aria-label="${this.T("name")}" autocomplete="off"></div>`;
    }
    h += `<button class="btn primary start" data-act="start">${this.T("start")}</button></div>`;
    el.innerHTML = h;
  }

  // the first page online: every open room with its players; tap a room's names, then Play
  roomsHtml() {
    let h = `<h2>${this.T("rooms")}</h2>`;
    if (this.rooms === null) return h + `<div class="muted">…</div>`;
    if (this.rooms === "error") return h + `<div class="muted">${this.T("rooms_error")}</div>` +
      `<button class="btn" data-act="rooms_reload">${this.T("rooms_reload")}</button>`;
    if (!this.rooms.length) return h + `<div class="muted">${this.T("rooms_none")}</div>` +
      `<button class="btn" data-act="rooms_reload">${this.T("rooms_reload")}</button>`;
    h += `<div class="muted small pick-hint">${this.T("rooms_pick")}</div>`;
    for (const r of this.rooms) {
      h += `<div class="room"><h3>${esc(r.name)}</h3><div class="choices">`;
      r.players.forEach((p, i) => {
        if (p.isAi) { h += `<span class="choice ai">${this.T("computer")}</span>`; return; }
        const sel = this.pick.id === r.id && this.pick.seats.includes(i), held = (r.held || []).includes(i);
        h += `<button class="choice${sel ? " sel" : ""}" data-act="who" data-val="${r.id}:${i}" ${held && !sel ? "disabled" : ""}>` +
          `${esc(p.name)}${held ? ` <span class="muted small">(${this.T("in_play")})</span>` : ""}</button>`;
      });
      h += "</div></div>";
    }
    return h + `<button class="btn primary start" data-act="join" ${this.pick.seats.length ? "" : "disabled"}>${this.T("start")}</button> ` +
      `<button class="btn" data-act="rooms_reload">${this.T("rooms_reload")}</button>`;
  }

  setupAction(act, val) {
    const s = this.setup;
    if (act === "offline") { this.offline = !this.offline; this.persist(); if (!this.offline) this.loadRooms(); this.render(); return; }
    if (act === "rooms_reload") { this.rooms = null; this.render(); this.loadRooms(); return; }
    if (act === "who") {
      const [id, i] = [val.split(":")[0], +val.split(":")[1]];
      if (this.pick.id !== id) this.pick = { id, seats: [] };
      const k = this.pick.seats.indexOf(i);
      if (k >= 0) this.pick.seats.splice(k, 1); else this.pick.seats.push(i);
      this.render();
      return;
    }
    if (act === "join") { if (this.pick.seats.length) this.startOnline(this.pick.id, [...this.pick.seats].sort()); return; }
    if (act === "colors") {
      s.colors = +val;
      s.n = Math.min(s.n, s.mode === "two" ? s.colors / 2 : s.colors);
    } else if (act === "mode") {
      s.mode = val;
      s.n = s.mode === "two" ? s.colors / 2 : 4;
    } else if (act === "n") s.n = +val;
    else if (act === "pairing") s.pairing = val;
    else if (act === "level") s.level = val;
    else if (act === "corridor") s.corridor = +val;
    else if (act === "seat") s.seats[+val] = s.seats[+val] === "human" ? "ai" : "human";
    else if (act === "pick") { const [i, c] = String(val).split(":").map(Number); this.pickColor(i, c); }
    else if (act === "start") { this.startGame(); return; }
    this.persist();
    this.render();
  }

  startGame() {
    const s = this.setup;
    const players = [];
    for (let i = 0; i < s.n; i++) {
      const ai = s.seats[i] === "ai";
      const nm = ((s.names && s.names[i]) || "").trim();
      players.push(Player(nm || M(ai ? "player_ai" : "player_human", { n: i + 1 }), this.seatColors(i), ai));
    }
    this.table = new Table({ players, mode: s.mode, colors: s.colors, level: s.level || "beginner", corridor: s.colors === 6 ? s.corridor || 10 : 10 }, { autoDice: !this.debug });
    this.game = this.table.game;
    this.ais = {};
    players.forEach((p, i) => { if (p.isAi) this.ais[i] = new SimpleAI(); });
    this.aiPlan = null;
    this.sel = null;
    this.doneNests = new Set();
    this.fireworksDone = false;
    this.diceRef = null;
    this.seenLast = null;
    this.prevTurn = undefined;
    $("#setup").hidden = true;
    this.board.setGame(this.game, p => shape(tr(this.lang, this.game.players[p].name)));
    const me = players.find(p => !p.isAi);              // start with my pieces in front, not far away
    if (me) this.board.fitView(me.colors);
    this.nextAi = performance.now() + this.delay;
    this.render();
  }

  // ------------------------------------------------------------ ribbon
  // The ribbon at the top holds everything that is not on the board: the players, whose turn it
  // is, the hint, the actions (a big die to roll, card, castle break, tunnels, undo...) and the
  // tools (view, scores, info, debug, language, speed, menu). Longer lists (all moves, which
  // move, the computer's plan, the final places) open in a card under the ribbon.
  render() {
    if (!this.game) { this.renderSetup(); return; }
    const g = this.game, el = $("#ribbon"), drop = $("#drop");
    el.dir = drop.dir = this.rtl ? "rtl" : "ltr";
    this.hint.textContent = t(this.lang, this.board.viewMode ? "view_hint" : "view_hint_off");
    const dec = g.pending, p = g.players[g.turn];
    const human = dec && !p.isAi && !g.over;
    if (dec !== (this.sel && this.sel.dec)) { this.resetSelection(dec); this.tunnelOpen = null; }
    let status, hint = "", acts = "", list = "", opts = [], shown = g.state;
    const pre = {};                     // the roll-time buttons: roll, card, castle break, tunnels
    const btn = (attrs, label, cls = "", icon = "") =>
      `<button class="btn rb-btn ${cls}" ${attrs}>${icon}<span>${label}</span></button>`;
    const optHtml = (o, k) => {
      const lines = Array.isArray(o.label) ? o.label : [o.label];
      return `<button class="opt" data-opt="${k}">${lines.map(x => `<div>${this.S(x)}</div>`).join("")}</button>`;
    };
    if (g.over) {
      status = `<b>${this.T("game_over")}</b>`;
      list = `<ol class="ranking">` + g.places.map((i, k) => `<li><span class="muted">${num(this.lang, k + 1)}.</span> <b>${this.S(g.players[i].name)}</b> <span class="muted">${this.T("final_score", { n: g.state.scores[i] })}</span></li>`).join("") + "</ol>";
      acts = btn('data-act="menu"', this.T("new_game"), "primary");
    } else {
      const who = t(this.lang, this.online && this.online.remote.has(g.turn) ? "online_other" : p.isAi ? "thinking" : "your_turn");
      status = `<b class="rb-turn">${this.T("turn", { p: tr(this.lang, p.name), who })}</b> <span class="muted small">${this.T("round", { n: g.turnNo })}</span>`;
      if (dec && dec.note && !(human && dec.kind === "keep")) hint = this.S(dec.note);
      if (dec && dec.kind === "dice" && this.online) {
        // online: the table waits for the server's throw; nothing to set or press here
      } else if (dec && dec.kind === "dice") {                  // debug: set the dice by hand
        hint = `${hint} · ${this.T("dice_hint")}`;
        acts = btn('data-act="dice_go"', this.T("continue"), "primary") + btn('data-act="dice_rand"', this.T("random"));
      } else if (dec && p.isAi && this.debug) {
        if (!this.aiPlan || this.aiPlan[0] !== dec) this.aiPlan = [dec, this.ais[g.turn].choose(g)];
        const o = this.aiPlan[1], lines = Array.isArray(o.label) ? o.label : [o.label];
        list = `<div class="muted small">${this.T("ai_will")}</div>` + lines.map(x => `<div>${this.S(x)}</div>`).join("");
        acts = btn('data-act="ai_go"', this.T("continue"), "primary");
      } else if (human && dec.kind === "play" && !this.sel.list) {
        const sel = this.sel;
        shown = sel.picks.length ? sel.picks[sel.picks.length - 1].state : g.state;
        hint = this.T(sel.ambig ? "pick_which" : sel.piece ? "pick_die_for_piece" : (sel.die === null ? "pick_die" : "pick_piece"));
        if (!sel.ambig && sel.seqs.some(q => q.steps.some(x => x.mover[0] === "hn"))) hint += ` <span class="muted">${this.T("hunter_ready")}</span>`;
        if (sel.picks.length) hint += `<div class="muted small">${sel.picks.map(x => this.S(g.describe({ steps: [x.step] })[0])).join(" · ")}</div>`;
        if (sel.ambig) { opts = sel.ambig; list = opts.map((c, k) => `<button class="opt" data-opt="${k}">${this.S(c.label)}</button>`).join(""); }
        acts = btn(`data-act="undo" ${sel.picks.length ? "" : "disabled"} title="${this.T("undo_hint")}"`, this.T("undo"), "undo", ICON.undo);   // the all-moves list button is hidden for now (the owner will decide later)
      } else if (human && dec.kind === "keep") {
        if (dec.options.some(o => Array.isArray(o.payload))) hint = this.T("pick_keep");
        acts = dec.options.filter(o => !Array.isArray(o.payload)).map(o =>
          btn(`data-pay="${esc(o.payload)}"`, this.S(o.label), o.payload === "gift" ? "primary" : "")).join("");
      } else if (human && dec.kind === "pre_roll") {
        opts = dec.options;
        const tunnels = [];
        let undo = null;
        dec.options.forEach((o, k) => {
          if (o.payload === "roll") pre.roll = `data-opt="${k}" title="${this.S(o.label)}"`;
          else if (o.payload === "triple") pre.card = `data-opt="${k}" title="${this.S(o.label)}"`;
          else if (o.payload === "break") pre.brk = `data-opt="${k}" title="${this.S(o.label)}"`;
          else if (o.payload[0] === "untunnel") undo = k;     // the last declared tunnel
          else tunnels.push(k);
        });
        // a tunnel declared this turn can be taken back until the dice are rolled
        if (g.cfg.tunnels_on) acts = btn(undo === null ? `disabled title="${this.T("undo")}"` : `data-opt="${undo}" title="${this.S(dec.options[undo].label)}"`,
          this.T("undo"), "undo", ICON.undo);
        // one Tunnels button per color (its icon in that color); it opens even with nothing to
        // declare, to say why. The open color's tunnels are listed and drawn on the board, where a
        // tap on a tunnel declares it (phones have no hover).
        if (g.cfg.tunnels_on) {
          pre.tun = {};
          for (const k of tunnels) { const c = dec.options[k].payload[1]; pre.tun[c] = (pre.tun[c] || 0) + 1; }
          const c = this.tunnelOpen;
          if (c !== null && c !== undefined) {
            const why = g.tunnelBlockers(g.turn);
            const dot = `<span class="dot" style="background:${COLORS[c]}"></span>`;
            const off = key => `<div class="opt off">${dot}<div><b>${esc(COLOR_NAMES[this.lang][c])}:</b> ${this.T(key, { n: g.cfg.tunnel_declare_range, m: g.cfg.max_active_tunnels })}</div></div>`;
            const why1 = why.all || why.colors[c];
            list = why1 ? off(why1) : `<div class="muted small">${this.T("tun_tap")}</div>` +
              tunnels.filter(k => dec.options[k].payload[1] === c).map(k =>
                `<button class="opt tun" data-opt="${k}">${dot}<div>${this.S(dec.options[k].label)}</div></button>`).join("");
          }
        }
      } else if (human) {
        opts = dec.options;
        list = opts.map(optHtml).join("");
        if (dec.kind === "play") acts = btn('data-act="clicks"', this.T("by_clicks"));
      }
      // the roll-time buttons stay in their places, greyed out until they can be used
      const two = g.mode === "two";
      acts = `<button class="btn rb-roll" ${pre.roll || "disabled"}>${ICON.die}<span>${this.T("roll_short")}</span></button>` +
        (two ? btn(`${pre.card || "disabled"} data-n="${g.cards[g.turn]}"`, this.T("card_short", { n: g.cards[g.turn] }), "pre", ICON.card) : "") +
        (two && g.cfg.break_decl_on ? btn(pre.brk || "disabled", this.T("break_short"), "pre", ICON.castle) : "") +
        (g.cfg.tunnels_on ? p.colors.map(c => {
          const n = pre.tun ? pre.tun[c] || 0 : 0;
          return btn(`${pre.tun ? `data-act="tunnels" data-val="${c}"` : "disabled"} data-n="${n}" style="--tc:${COLORS[c]}" title="${esc(COLOR_NAMES[this.lang][c])}"`,
            this.T("tunnel_menu", { n }), `pre tunc${pre.tun && this.tunnelOpen === c ? " on" : ""}`, ICON.tunnel);
        }).join("") : "") + acts;
    }
    if (this.scoresMode) { hint = `<b>${this.T("scores_on")}</b> ${this.T("scores_legend")}`; list = ""; }
    this.shownOpts = opts;
    el.innerHTML = `<div class="rb-players">${this.playersHtml()}</div>
      <div class="rb-center"><div class="rb-status"><div class="rb-line">${status}</div>${hint ? `<div class="rb-hint">${hint}</div>` : ""}</div>
      <div class="rb-actions">${acts}</div></div>
      <div class="rb-tools">${this.toolsHtml()}</div>`;
    drop.innerHTML = list;
    drop.hidden = !list;
    this.showToast(hint, this.scoresMode);
    this.cmdBox.hidden = !this.debug;
    this.cmdBox.querySelector("input").placeholder = "score 1 50 · move 1 s2R 33 · dice 6 3 4";
    $("#stage").classList.toggle("has-drop", !!list);
    // with the Tunnels list open, every tunnel that can be declared is drawn in its piece's color
    this.board.tunnelCands = human && dec.kind === "pre_roll" && this.tunnelOpen !== null && this.tunnelOpen !== undefined
      ? dec.options.map(o => o.payload).filter(pl => Array.isArray(pl) && pl[0] === "tunnel" && pl[1] === this.tunnelOpen) : [];
    if (g.over) {
      this.board.sync(g.state);
      this.board.preview(null);
      this.board.clearDice();
      return;
    }
    this.syncDice(dec, human);
    this.board.sync(shown, this.sel && this.sel.piece);
    this.board.showTargets(this.sel && this.sel.piece && human && dec.kind === "play" ? this.pieceTargets() : []);
    if (dec !== this.followedDec) {          // turn the board towards the player whose move it is
      this.followedDec = dec;
      if (this.follow && dec && !p.isAi && this.lastFollow !== g.turn) this.board.setView({ side: p.colors[0] });
      this.lastFollow = dec && !p.isAi ? g.turn : this.lastFollow;
    }
    if (dec && p.isAi && this.debug && this.aiPlan) {
      const pl = this.aiPlan[1].payload;
      this.board.preview(pl && pl.steps ? pl : null, Array.isArray(pl) && pl[0] === "tunnel" ? pl : null);
    } else {
      this.board.preview(null);
    }
  }

  // one chip per player: colors, name, score, cards left, stuck / place
  playersHtml() {
    const g = this.game;
    return g.players.map((pl, i) => {
      const place = g.places.indexOf(i);
      const tags = [];
      if (this.online && this.online.seats.includes(i)) tags.push(`<span class="tag you">${this.T("you")}</span>`);
      if (place >= 0) tags.push(`<span class="tag">${this.T("place", { n: place + 1 })}</span>`);
      if (g.mode === "two") tags.push(`<span class="cards" title="${this.T("cards", { n: g.cards[i] })}">${ICON.cardSmall}${num(this.lang, g.cards[i])}</span>`);
      if (g.stuck(i) && place < 0) tags.push(`<span class="stuck" title="${this.T("stuck")}">${ICON.stuck}</span>`);
      return `<div class="chip${i === g.turn && !g.over ? " turn" : ""}${place >= 0 ? " done" : ""}">` +
        pl.colors.map(c => `<span class="dot" style="background:${COLORS[c]}"></span>`).join("") +
        `<span class="nm">${this.S(pl.name)}</span><b class="pts" title="${this.T("score", { n: g.state.scores[i] })}">${esc(num(this.lang, g.state.scores[i]))}</b>${tags.join("")}</div>`;
    }).join("");
  }

  // view, scores, info, debug, language, computer speed, menu
  toolsHtml() {
    return this.viewMenuHtml() +
      `<button class="btn rb-btn icon${this.scoresMode ? " on" : ""}" data-act="scores" title="${this.T("scores")}">${ICON.star}<span>${this.T("scores")}</span></button>` +
      `<button class="btn rb-btn icon" data-act="info" title="${this.T("info")}">${ICON.info}<span>${this.T("info")}</span></button>` +
      (this.online ? "" : `<label class="btn rb-btn icon check${this.debug ? " on" : ""}" title="${this.T("debug")}"><input type="checkbox" data-act="debug" ${this.debug ? "checked" : ""}>${ICON.bug}<span>${this.T("debug_short")}</span></label>`) +
      this.langSelect() +
      `<label class="rb-speed" title="${this.T("speed")}">${ICON.speed}<select data-act="speed" aria-label="${this.T("speed")}">` +
        Object.keys(Config.ANIM_SPEEDS).map(k => `<option value="${k}" ${k === this.speed ? "selected" : ""}>${this.T("speed_" + k)}</option>`).join("") + "</select></label>" +
      `<button class="btn rb-btn icon" data-act="menu" title="${this.T("menu")}">${ICON.menu}<span>${this.T("menu")}</span></button>`;
  }

  // ------------------------------------------------------------ click-by-click moves
  // A play is made die by die: always click a die first, then the piece that moves with it.
  // With three dice (stuck, card, bonus) the two dice clicked are the ones kept.
  resetSelection(dec) {
    this.sel = { dec, picks: [], die: null, keep: [], ambig: null, list: false, piece: null,
      seqs: dec && dec.kind === "play" && !this.game.players[this.game.turn].isAi ? this.game.sequences(dec) : [] };
    this.autoDie();
  }

  // sequences that agree with what has been clicked so far
  matching() {
    const { picks, seqs } = this.sel;
    return seqs.filter(q => picks.every((x, k) => q.dieIdx[k] === x.di && q.steps[k].mover.join() === x.step.mover.join()));
  }

  usableDice() {
    const n = this.sel.picks.length;
    return new Set(this.matching().map(q => q.dieIdx[n]));
  }

  // Select the die by itself when there is no real choice (one die left, or equal values).
  autoDie() {
    const sel = this.sel;
    if (!sel.dec || sel.dec.kind !== "play" || sel.die !== null) return;
    const use = [...this.usableDice()];
    if (use.length && use.every(di => sel.dec.dice[di] === sel.dec.dice[use[0]])) sel.die = Math.min(...use);
  }

  // candidate next steps for the selected die, one per mover
  candidates() {
    const sel = this.sel, n = sel.picks.length, out = new Map();
    if (sel.die === null) return [];
    for (const q of this.matching()) {
      if (q.dieIdx[n] !== sel.die) continue;
      const key = q.steps[n].mover.join();
      if (!out.has(key)) out.set(key, { step: q.steps[n], state: q.states[n], di: sel.die });
    }
    return [...out.values()];
  }

  pickCandidate(c) {
    const sel = this.sel;
    const before = sel.picks.length ? sel.picks[sel.picks.length - 1].state : this.game.state;
    const entry = [{ before, after: c.state, step: c.step }];
    sel.picks.push(c);
    sel.die = null;
    sel.ambig = null;
    sel.piece = null;
    const done = this.matching().filter(q => q.steps.length === sel.picks.length);
    if (done.length) { this.choose(done[0].option, entry); return; }
    this.autoDie();
    this.render();
    this.board.animateSteps(entry, this.hop());
  }

  hop() { return this.delay * Config.HOP_SHARE; }

  // a nest that has just been filled shines (after the piece has landed)
  checkNests(when = performance.now()) {
    const g = this.game;
    this.doneNests = this.doneNests || new Set();
    for (let c = 0; c < g.cfg.n_colors; c++) {
      if (g.owner[c] === null || this.doneNests.has(c) || !g.colorComplete(g.state, c)) continue;
      this.doneNests.add(c);
      setTimeout(() => this.board.celebrate(c), Math.max(0, when - performance.now()));
    }
  }

  // the play step by step, for the animation: [{before, after, step}]
  replay(play) {
    const g = this.game, structs = g.structures(g.state), out = [];
    let cur = g.state;
    for (const s of play.steps) {
      const r = g.step(cur, g.turn, s.mover, s.die, structs, play.target);
      if (!r) break;
      out.push({ before: cur, after: r[0], step: r[1] });
      cur = r[0];
    }
    return out;
  }

  // waiting for an animation (move, dice or card), or locked by the scores view
  busy() {
    const now = performance.now();
    return this.scoresMode || this.confirming || (this.hold && now < this.hold.until) || this.board.isAnimating() || this.board.diceRolling() || now < (this.cardUntil || 0);
  }

  // A triple-dice card is played: the card flies in over the board, the three dice glow for 2 s.
  cardEffect() {
    this.cardUntil = performance.now() + 2000;
    this.board.glowDice(2000);
    const fx = document.createElement("div");
    fx.className = "card-fx";
    const g = this.game, dice = g.pending && g.pending.kind === "dice" ? [] : g.lastDice;   // debug: dice not set yet
    fx.innerHTML = `<div class="card-fx-card"><div class="card-fx-dice">${dice.map(v => dieHtml(v, "", "")).join("")}</div>
      <div class="card-fx-text" dir="${this.rtl ? "rtl" : "ltr"}">${this.T("card_fx")}</div></div>`;
    $("#stage").appendChild(fx);
    setTimeout(() => fx.remove(), 2000);
    setTimeout(() => this.render(), 2050);              // end of the dice glow
  }

  // The dice live on the board. A new throw lands in the middle and settles at the player's
  // yard; played dice dim, a burnt die gets a red cross, and the dice fade once the turn has
  // passed. Two of three dice kept: the third fades.
  syncDice(dec, human) {
    const g = this.game, b = this.board, now = performance.now();
    const hold = this.hold && now < this.hold.until ? this.hold : null;
    if (hold) {                                   // burnt dice of the player before (see choose)
      if (this.diceRef !== hold.dice) {
        b.throwDice(hold.dice, g.players[hold.player].colors, 1);
        this.rolling = true;
        this.diceRef = hold.dice;
        this.diceOwner = hold.player;
        this.diceCleared = false;
      }
      b.diceStates(hold.dice.map(() => "burnt"));
      return;
    }
    let cur;
    if (dec && ["play", "keep"].includes(dec.kind)) cur = dec.dice;
    else if (dec && dec.kind === "dice") cur = this.online ? this.diceRef : dec.dice;   // online: the server's throw is on its way
    else if (g.lastDice !== this.seenLast) cur = g.lastDice;   // a throw with no move: every die burns
    else cur = this.diceRef;
    this.seenLast = g.lastDice;
    const colors = p => g.players[p].colors;
    if (cur !== this.diceRef) {
      const owner = dec && dec.dice === cur ? dec.player : (this.prevTurn ?? g.turn);
      if (cur && this.keptFrom && this.keptFrom === this.diceRef && cur.length === 2) b.keepDice(this.keptIdx);
      else if (cur && dec && dec.kind === "dice") b.placeDice(cur, colors(owner));
      else if (cur && cur.length) {
        const ai = g.players[owner].isAi;
        b.throwDice(cur, colors(owner), ai ? Math.max(0.45, Math.min(1.3, this.delay / 650)) : 1);
        this.rolling = true;
      }
      this.keptFrom = null;
      this.diceRef = cur;
      this.diceOwner = owner;
      this.diceCleared = false;
    } else if (cur && dec && dec.kind === "dice" && !this.online) b.placeDice(cur, colors(dec.player));
    this.prevTurn = g.turn;
    if (!cur) return;
    if (this.diceOwner !== g.turn && !this.diceCleared && !b.diceRolling()) {   // the turn has passed: fade after the move
      const at = Math.max(b.animEnd || 0, this.settledAt || 0) + 600;
      if (now >= at) { b.clearDice(); this.diceCleared = true; }
      else { clearTimeout(this.diceTimer); this.diceTimer = setTimeout(() => this.render(), at - now + 20); }
    }
    const sel = this.sel, mine = dec && dec.dice === cur;
    let states;
    if (mine && dec.kind === "dice") states = cur.map(() => "edit");
    else if (mine && human && dec.kind === "keep" && dec.options.some(o => Array.isArray(o.payload))) {
      states = cur.map((_, k) => sel.keep.includes(k) ? "sel" : "pick");
    } else if (mine && human && dec.kind === "play" && !sel.list) {
      const used = new Set(sel.picks.map(x => x.di));
      const use = sel.piece ? this.pieceDice(sel.piece) : this.usableDice();
      states = cur.map((_, k) => used.has(k) ? "used" : (sel.die === k ? "sel" : (use.has(k) ? "pick" : "off")));
    } else if (mine) states = cur.map(() => "idle");
    else if (this.usedFrom === cur) states = cur.map((_, k) => this.usedIdx.includes(k) ? "used" : "burnt");
    else states = cur.map(() => "burnt");                   // no move was possible
    b.diceStates(states);
  }

  // which of the dice a play used (matched by value)
  usedDice(dice, play) {
    const left = dice.map((v, k) => k), out = [];
    for (const s of play.steps || []) {
      const j = left.findIndex(k => dice[k] === s.die);
      if (j >= 0) out.push(left.splice(j, 1)[0]);
    }
    return out;
  }

  // which two of three dice a "keep" choice keeps, in the order of the kept pair
  keptDice(dice, pair) {
    const pref = this.sel && this.sel.keep.length === 2 ? this.sel.keep : [];
    const left = pref.concat(dice.map((v, k) => k).filter(k => !pref.includes(k)));
    return pair.map(v => left.splice(left.findIndex(k => dice[k] === v), 1)[0]);
  }

  // A die on the board was clicked (step +1 or -1 for the debug dice being set).
  dieClick(hit, ev, step = 1) {
    const g = this.game;
    if (!g || !hit || hit.die === undefined || !g.pending) return;
    if (g.pending.kind === "dice") {
      if (this.online) return;                                   // only debug sets dice by hand
      const d = g.pending.dice, k = hit.die;
      d[k] = ((d[k] - 1 + step) % 6 + 6) % 6 + 1;
      this.render();
      return;
    }
    if (step === 1) this.clickDie(hit.die, ev);
  }

  toggleScores() {
    const g = this.game;
    this.scoresMode = !this.scoresMode;
    const shown = this.sel && this.sel.picks.length ? this.sel.picks[this.sel.picks.length - 1].state : g.state;
    this.board.showScores(this.scoresMode ? shown : null, x => num(this.lang, x));
    if (!this.scoresMode) this.nextAi = performance.now() + this.delay;
    this.render();
  }

  clickDie(k, ev) {
    const g = this.game, dec = g.pending, sel = this.sel;
    if (this.busy()) return;
    if (!dec || g.players[g.turn].isAi) return;
    if (this.board.viewMode) this.board.setViewMode(false);   // back to playing
    if (dec.kind === "keep") {
      if (!dec.options.some(o => Array.isArray(o.payload))) return;
      sel.keep = sel.keep.includes(k) ? sel.keep.filter(x => x !== k) : sel.keep.concat([k]);
      if (sel.keep.length === 2) {
        const pair = sel.keep.map(i => dec.dice[i]).sort((a, b) => a - b).join();
        const o = dec.options.find(x => Array.isArray(x.payload) && x.payload[1].join() === pair);
        if (o) { this.choose(o); return; }
      }
      this.render();
      return;
    }
    if (dec.kind !== "play" || sel.list) return;
    if (sel.piece) {                         // piece first: this die moves it
      if (!this.pieceDice(sel.piece).has(k)) { this.forbidMove(ev, sel.piece, [k]); return; }
      sel.die = k;
      this.movePiece(sel.piece, ev);
      return;
    }
    if (!this.usableDice().has(k)) return;
    sel.die = sel.die === k ? null : k;
    sel.ambig = null;
    this.render();
  }

  // Does mover m stand for the clicked piece? Any yard piece stands for its color's yard mover.
  moverMatcher(pc) {
    const sel = this.sel, g = this.game;
    const shown = sel.picks.length ? sel.picks[sel.picks.length - 1].state : g.state;
    const inYard = pc[0] === "p" && shown.pos[pc[1]][pc[2]] === -1;
    if (pc[0] === "hn") return m => m[0] === "hn" && m[1] === pc[1];   // the waiting hunter: either direction
    return m => (m[0] === pc[0] && m.join() === pc.join())
      || (inYard && m[0] === "p" && m[1] === pc[1] && shown.pos[m[1]][m[2]] === -1);
  }

  // dice the piece can move with now
  pieceDice(pc) {
    const n = this.sel.picks.length, isMe = this.moverMatcher(pc);
    return new Set(this.matching().filter(q => isMe(q.steps[n].mover)).map(q => q.dieIdx[n]));
  }

  // Where the selected piece can go: one target per usable die (equal dice: one target).
  pieceTargets() {
    const sel = this.sel, n = sel.picks.length, isMe = this.moverMatcher(sel.piece), out = [];
    const seen = new Set();
    for (const q of this.matching()) {
      if (!isMe(q.steps[n].mover)) continue;
      const di = q.dieIdx[n], m = q.steps[n].mover, st = q.states[n];
      const pos = m[0] === "p" ? this.board.piecePos(st, m[1], m[2]) : this.board.hunterPos(st, m[1]);
      const k = pos.x.toFixed(2) + "," + pos.z.toFixed(2);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ id: out.length, di, pos, label: sel.dec.dice[di] });
    }
    this.shownTargets = out;
    return out;
  }

  // move the piece with the selected die, or show the "not allowed" sign
  movePiece(pc, ev) {
    const g = this.game, sel = this.sel, isMe = this.moverMatcher(pc);
    const mine = this.candidates().filter(c => isMe(c.step.mover));
    if (mine.length === 1) this.pickCandidate(mine[0]);
    else if (mine.length > 1) {
      sel.ambig = mine.map(x => ({ cand: x, label: g.describe({ steps: [x.step] })[0] }));
      this.render();
    } else {
      this.forbidMove(ev, pc, [sel.die]);
    }
  }

  // The "not allowed" sign. When an opponent's wall or castle stops piece pc with one of these
  // dice (indices into the throw), the sign of that wall or castle shows on its pieces instead.
  forbidMove(ev, pc, dieIdx) {
    const g = this.game, sel = this.sel;
    const shown = sel.picks.length ? sel.picks[sel.picks.length - 1].state : g.state;
    if (pc && pc[0] === "p" && sel.dec)
      for (const di of dieIdx) {
        const b = g.blockerOf(shown, g.turn, pc, sel.dec.dice[di]);
        if (b) { this.board.forbidStructure(shown, b, ev); return; }
      }
    this.board.forbid(ev);
  }

  // The view menu: a button at the top of the panel; it opens a small panel of views
  // and folds back into the button when a view is chosen.
  viewMenuHtml() {
    const on = this.board.viewMode;
    const cam = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 8h3l2-2h6l2 2h3v11H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
    return `<div class="viewmenu"><button class="btn vm-btn${on ? " on" : ""}${this.viewOpen ? " open" : ""}" data-act="viewmenu"
      aria-expanded="${this.viewOpen ? "true" : "false"}">${cam}<span>${this.T(on ? "view_free_done" : "view_menu")}</span></button>
      <div class="viewpop${this.viewOpen && !this.viewOpening ? " open" : ""}" ${this.viewOpen ? "" : "hidden"}>
      <div class="views">
      <button class="btn" data-view="top">${this.T("view_top")}</button>
      <button class="btn" data-view="angled">${this.T("view_angled")}</button>
      <button class="btn" data-view="low">${this.T("view_low")}</button>
      <button class="btn" data-view="left" title="${this.T("view_left")}">&#8634;</button>
      <button class="btn" data-view="right" title="${this.T("view_right")}">&#8635;</button>
      <button class="btn" data-view="mine">${this.T("view_mine")}</button></div>
      <button class="btn wide${on ? " on" : ""}" data-view="free" title="${this.T("view_free_hint")}">${this.T(on ? "view_free_done" : "view_free")}</button>
      <label class="check small"><input type="checkbox" data-act="follow" ${this.follow ? "checked" : ""}>${this.T("view_follow")}</label>
      </div></div>`;
  }

  // The hint shows on the board when it changes and fades after a few seconds, so a long
  // line never makes the ribbon grow. The scores legend stays while the scores are shown.
  showToast(html, stay) {
    const el = this.toast;
    if (html === this.toastHtml && el.classList.contains("stay") === !!stay) return;
    this.toastHtml = html;
    clearTimeout(this.toastTimer);
    el.classList.remove("show");
    el.classList.toggle("stay", !!stay);
    if (!html) return;
    el.innerHTML = html;
    void el.offsetWidth;
    el.classList.add("show");
    if (!stay) {
      const ms = Math.min(TOAST_MAX_MS, TOAST_MS + TOAST_MS_PER_CHAR * el.textContent.length);
      this.toastTimer = setTimeout(() => el.classList.remove("show"), ms);
    }
  }

  openViewMenu(open) {
    const pop = document.querySelector("#ribbon .viewpop");
    if (open) {
      this.viewOpen = true;
      this.viewOpening = true;
      this.render();
      setTimeout(() => {                                   // next tick: let the panel start folded, then grow
        this.viewOpening = false;
        const p = document.querySelector("#ribbon .viewpop");
        const btn = document.querySelector("#ribbon .vm-btn");
        if (p && btn) {                                    // grow out of the button, fold back into it
          const r = btn.getBoundingClientRect(), q = p.getBoundingClientRect();
          p.style.setProperty("--vm-origin", `${r.left + r.width / 2 - q.left}px`);
        }
        if (p) { void p.offsetWidth; p.classList.add("open"); }
      }, 20);
      return;
    }
    if (!this.viewOpen) return;
    this.viewOpen = false;
    const btn = document.querySelector("#ribbon .vm-btn");
    if (pop && btn) {
      const r = btn.getBoundingClientRect(), q = pop.getBoundingClientRect();
      pop.style.setProperty("--vm-origin", `${r.left + r.width / 2 - q.left}px`);
    }
    if (pop) pop.classList.remove("open");                 // folds back into the button
    if (btn) { btn.classList.remove("open"); btn.classList.add("pulse"); }
    setTimeout(() => this.render(), 260);
  }

  // ------------------------------------------------------------ actions
  choose(opt, entries = null) {
    const g = this.game, dec = g.pending;
    if (this.online && !this.online.applying) { this.sendMove(opt, entries); return; }
    const card = dec && dec.kind === "pre_roll" && opt.payload === "triple";
    if (!entries && dec && dec.kind === "play" && opt.payload && opt.payload.steps) entries = this.replay(opt.payload);
    if (dec && dec.kind === "play") { this.usedFrom = dec.dice; this.usedIdx = this.usedDice(dec.dice, opt.payload); }
    if (dec && dec.kind === "keep" && Array.isArray(opt.payload)) {
      this.keptFrom = dec.dice;
      this.keptIdx = this.keptDice(dec.dice, opt.payload[1]);
    }
    g.noMove = null;
    this.table.choose(opt);
    // a throw with no move followed at once by the next player's throw (a stuck player throws
    // straight away): show the burnt dice first, then the next throw
    if (g.noMove && g.pending && g.pending.dice && g.pending.dice.length && g.pending.player !== g.noMove.player) {
      this.hold = { ...g.noMove, until: performance.now() + 4000 };   // shortened to 1 s once the dice settle (tick)
      setTimeout(() => this.render(), 4020);
    }
    if (card) this.cardEffect();
    this.aiPlan = null;
    this.render();
    let end = performance.now();
    if (entries && entries.length) end = this.board.animateSteps(entries, this.hop());
    this.checkNests(end);
    if (g.over && !this.fireworksDone) {     // the game is over: fireworks once the last move has landed
      this.fireworksDone = true;
      setTimeout(() => this.board.fireworks(), Math.max(0, end - performance.now()) + 400);
    }
    this.nextAi = end + this.delay;
    this.moveEnd = entries && entries.length ? end + this.delay : end;   // online: the next throw waits for this
  }

  // A debug command was typed (js/debugcmd.js); the answer shows under the box.
  command(input) {
    const g = this.game;
    if (!g || !input.value.trim()) return;
    const text = input.value.trim(), at = this.table.events.length;
    const r = runCommand(g, input.value, o => this.choose(o));
    if (r.key === "cmd_score" || r.key === "cmd_moved")
      (this.table.edits = this.table.edits || []).push({ at, cmd: text });     // score / move change the state outside the events
    this.cmdBox.querySelector(".cmd-out").textContent = t(this.lang, r.key, r.params);
    this.cmdBox.querySelector(".cmd-out").classList.toggle("bad", !/^cmd_(score|moved|dice|dice_next)$/.test(r.key));
    if (!/usage|not_|no_|bad|taken|count/.test(r.key)) input.value = "";
    this.aiPlan = null;
    if (this.sel && g.pending !== this.sel.dec) this.resetSelection(g.pending);
    this.render();
  }

  setDebug(on) {
    const g = this.game;
    this.debug = on;
    this.table.autoDice = !on;
    this.aiPlan = null;
    if (!on && g.pending && g.pending.kind === "dice") {
      this.table.choose(new Option(null, ["dice", g.roll(g.pending.dice.length)]));
    }
    this.nextAi = performance.now() + this.delay;
    this.render();
  }

  // Click on the board. Both orders work:
  //  - die first: a click on a piece moves it with that die (or shows the "not allowed" sign);
  //  - piece first: the piece is selected and only the dice it can use stay clickable;
  //    a click on one of them makes the move. A piece with no move gets the sign.
  // The hunter enters by clicking the gate of its completed color (then: which direction).
  boardClick(hit, ev) {
    const g = this.game, sel = this.sel;
    if (this.busy()) return;
    if (g && hit && hit.die !== undefined) { this.dieClick(hit, ev); return; }
    if (g && hit && hit.tunnel && g.pending && g.pending.kind === "pre_roll" && !g.players[g.turn].isAi) {   // a tap on a drawn tunnel declares it
      const o = g.pending.options.find(o => Array.isArray(o.payload) && o.payload.join() === hit.tunnel.join());
      if (o) this.choose(o);
      return;
    }
    if (!g || !hit || !g.pending || g.pending.kind !== "play" || g.players[g.turn].isAi || sel.list || sel.ambig) return;
    const shown = sel.picks.length ? sel.picks[sel.picks.length - 1].state : g.state;
    if (hit.target !== undefined && sel.piece) {     // a highlighted field of the selected piece
      const tg = this.shownTargets && this.shownTargets[hit.target];
      if (tg) { sel.die = tg.di; this.movePiece(sel.piece, ev); }
      return;
    }
    if (hit.piece) {
      const pc = hit.piece;
      if (sel.die !== null) { this.movePiece(pc, ev); return; }
      if (sel.piece && sel.piece.join() === pc.join()) { sel.piece = null; this.render(); return; }
      const dice = this.pieceDice(pc);
      if (!dice.size) {
        const used = sel.picks.map(c => c.di);
        sel.piece = null;
        this.forbidMove(ev, pc, sel.dec ? sel.dec.dice.map((_, i) => i).filter(i => !used.includes(i)) : []);
        this.render();
        return;
      }
      sel.piece = pc;
      this.render();
      return;
    }
    if (hit.field !== undefined) {
      if (sel.die === null) { this.board.forbid(ev); return; }
      const mine = this.candidates().filter(c => c.step.mover[0] === "hn" && g.gate(g._completedColor(g.turn, shown)) === hit.field);
      if (mine.length) {
        sel.ambig = mine.map(x => ({ cand: x, label: g.describe({ steps: [x.step] })[0] }));
        this.render();
      } else this.board.forbid(ev);
    }
  }

  // ------------------------------------------------------------ info: the scoring of this board
  showInfo(on) {
    const el = $("#info");
    el.hidden = !on;
    if (!on) return;
    const g = this.game, c = g.cfg, L = this.lang, n = c.n_colors;
    const N = x => esc(num(L, x));
    const P = (sign, x) => `<bdi dir="ltr">${sign}${N(x)}</bdi>`;   // a signed number, kept in one piece
    const row = (a, b) => `<tr><td>${a}</td><td class="pts">${b}</td></tr>`;
    const table = (title, rows) => `<h3>${this.T(title)}</h3><table class="info-table"><tbody>${rows.join("")}</tbody></table>`;
    const corr = [];
    for (let k = 1; k <= n; k++) {
      const name = k === 1 ? this.T("info_corr_first", { n: N(1) }) : k === n ? this.T("info_corr_final", { n: N(n) }) : this.T("info_corr", { n: N(k) });
      corr.push(row(name, N(c.corridor_points[Math.min(k - 1, c.corridor_points.length - 1)])));
    }
    corr.push(row(this.T("info_gate"), P("+", c.gate_bonus)));
    corr.push(row(this.T("info_threshold"), P("+", c.threshold_bonus)));
    const brk = [row(this.T("info_wall"), P("+", c.wall_break))];
    if (c.castles && c.break_decl_on) brk.push(row(this.T("info_castle"), P("+", c.castle_break)));   // castles only break by declaration
    const ranks = [
      row(this.T("info_general", { n: N(c.general_points) }), P("×", c.general_mult)),
      row(this.T("info_marshal", { n: N(c.marshal_points) }), P("×", c.marshal_mult)),
      row(this.T("info_hit_general"), P("+", c.general_bounty) + " / " + P("−", c.general_bounty)),
      row(this.T("info_hit_marshal"), P("+", c.marshal_bounty) + " / " + P("−", c.marshal_bounty)),
    ];
    const end = [row(this.T("info_clean"), P("+", c.clean_piece_bonus)), row(this.T("info_color"), P("+", c.color_bonus))];
    c.finish_bonus.forEach((b, k) => end.push(row(this.T("info_place", { n: N(k + 1) }), P("+", b))));
    const tun = [];
    const skips = [...new Set(c.tunnels().map(([a, b]) => b - a))].sort();
    for (const k of skips) {
      const [, , T] = g.tunnelGeom(1, 1 + k);
      tun.push(row(this.T("info_tunnel", { k: N(k), f: N(T) }), P("−", c.tunnel_costs[k - 1])));
    }
    el.dir = this.rtl ? "rtl" : "ltr";
    el.innerHTML = `<div class="info-card"><div class="row between"><h2>${this.T("info_title", { n: N(n) })}</h2>
      <button class="btn" data-act="info_close">${this.T("close")}</button></div>
      <p class="muted small">${this.T("info_lead")}</p>
      ${table("info_dice", [row(this.T(c.six_chance == null ? "level_beginner" : "level_intermediate"),
        c.six_chance == null ? P("", "1/6") : P("", "1/" + Math.round(1 / c.six_chance)))])}
      ${table("info_hits", corr)}${c.walls ? table("info_breaks", brk) : ""}${c.ranks ? table("info_ranks", ranks) : ""}
      ${table("info_end", end)}${c.tunnels_on ? table("info_tunnels", tun) : ""}
      <p class="muted small">${this.T("info_note")}</p>
      <div class="row between log-head"><h3>${this.T("log")}</h3><button class="btn" data-act="copy_log" title="${this.T("copy_log_hint")}">${this.T("copy_log")}</button></div><div class="info-log">${g.log.slice().reverse().map(m => `<div>${this.S(m)}</div>`).join("")}</div></div>`;
  }

  // The text behind the Copy button of the move log: the setup, the moves in English, and the
  // setup and events as JSON, so the owner can paste a game into a chat and tools/replay.mjs
  // rebuilds it exactly.
  gameReport() {
    const g = this.game, tb = this.table, en = x => tr("en", x);
    const cname = c => COLOR_NAMES.en[c] || String(c);
    const setup = { ...tb.setup, players: tb.setup.players.map(p => ({ name: p.name, colors: p.colors.slice(), isAi: !!p.isAi })) };
    const lines = [
      `SuperMensch ${VERSION} · game report · ${new Date().toISOString()}`,
      `Board: ${g.cfg.n_colors} colors · corridor ${setup.corridor || 10} · mode ${g.mode} · level ${setup.level || "beginner"}`,
      "Players:",
      ...g.players.map((p, i) => `  ${i + 1}. ${en(p.name)} · ${p.isAi ? "computer" : "human"} · colors ${p.colors.map(cname).join(", ")} · score ${g.state.scores[i]}`),
      `Online: ${this.online ? `room ${this.online.id}, this device plays seats ${this.online.seats.map(i => i + 1).join(", ")}` : "no (one device)"}`,
      `Debug mode: ${this.debug ? "on" : "off"} · debug edits: ${(tb.edits || []).length}`,
      `Language: ${this.lang} · round ${g.turnNo} · turn of player ${g.turn + 1} · pending ${g.pending ? g.pending.kind : "none"} · over ${!!g.over}`,
      `Fingerprint: ${fingerprint(g)} · events ${tb.events.length}`,
      "",
      "Moves (oldest first):",
      ...g.log.map((m, i) => `${i + 1}. ${en(m)}`),
      "",
      "Replay data (node tools/replay.mjs <file>):",
      JSON.stringify({ version: VERSION, setup, events: tb.events, edits: tb.edits || [], fp: fingerprint(g) }),
    ];
    return lines.join("\n");
  }

  async copyLog() {
    const text = this.gameReport();
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (e) { /* file:// or an old browser: below */ }
    if (!ok) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      ta.remove();
    }
    this.showToast(this.T(ok ? "copy_log_done" : "copy_log_failed"));
  }

  // Board views, as in chess programs: from above, angled, low; turn by one seat; my side.
  view(name) {
    const g = this.game;
    if (!g) return;
    if (name === "free") {                   // view mode on / off
      this.board.setViewMode(!this.board.viewMode);
      this.render();
      return;
    }
    const step = 360 / g.cfg.n_colors;
    if (name === "left" || name === "right") this.board.setView({ turn: name === "left" ? -step : step });
    else if (name === "mine") {
      const hum = g.players[g.turn].isAi ? g.players.find(x => !x.isAi) : g.players[g.turn];
      this.board.setView({ side: (hum || g.players[0]).colors[0] });
    } else this.board.setView({ tilt: name });
  }

  // ------------------------------------------------------------ online game (v2)
  // The server throws the dice and checks the moves. This device sends the moves of its own
  // seats and plays every event the server sends, one by one, with the usual animations.
  // Seats played elsewhere (and the computer, which the server plays) count as computer
  // players here, so the panel offers nothing for them.
  startOnline(id, seats) {
    this.online = { id, seats, remote: new Set(), queue: [], sent: null, applying: false, fp: null, ws: null };
    $("#setup").hidden = true;
    this.connect();
  }

  connect() {
    const o = this.online;
    const ws = new WebSocket(`${apiBase().replace(/^http/, "ws")}/api/games/${encodeURIComponent(o.id)}/ws`);
    o.ws = ws;
    ws.onopen = () => this.hello();
    ws.onmessage = e => this.onServer(JSON.parse(e.data));
    ws.onclose = e => {
      if (o.ws !== ws) return;
      if (e.code === 4000 || e.code === 4001) {                  // the admin deleted the room or changed its players
        o.ws = null;
        this.showToast(this.T(e.code === 4000 ? "online_deleted" : "online_changed"), true);
        setTimeout(() => { location.href = location.pathname; }, 3000);
        return;
      }
      this.showToast(this.T("online_lost"), true);
      setTimeout(() => { if (o.ws === ws) this.connect(); }, 2000);
    };
  }

  // which seats this device plays; the token lets this browser take its seats back after a break
  hello() {
    const o = this.online;
    o.ws.send(JSON.stringify({ t: "hello", device: navigator.userAgent.includes("Mobile") ? "phone" : "computer",
      token: deviceToken(), seats: o.seats }));
  }

  onServer(m) {
    const o = this.online;
    if (m.t === "state" && m.taken && m.taken.length) {     // a name is in play on another device that has not left
      const ws = o.ws;
      o.ws = null;
      ws.close();
      const names = m.taken.map(i => m.setup.players[i].name).join(", ");
      this.showToast(this.T("online_taken", { p: names }), true);
      setTimeout(() => { location.href = location.pathname; }, 4000);
      return;
    }
    if (m.t === "state") {
      if (!this.table) { this.openOnline(m); return; }
      const have = this.table.events.length + o.queue.length;
      if (m.events.length < have) { location.reload(); return; }     // should not happen: start again from the server
      o.queue.push(...m.events.slice(have));
      o.fp = m.fp;
    } else if (m.t === "events") {
      const have = this.table.events.length + o.queue.length;
      if (m.from !== have) { this.hello(); return; }   // missed some: ask again
      o.queue.push(...m.events);
      o.fp = m.fp;
    } else if (m.t === "refused") {
      o.sent = null;
      this.showToast(esc(m.reason), true);
      if (m.reason === "stale") this.hello();
      this.render();
    }
  }

  // the first state: replay the game so far without animations
  openOnline(m) {
    const o = this.online;
    const players = m.setup.players.map((p, i) => ({ ...p, isAi: p.isAi || !o.seats.includes(i) }));
    m.setup.players.forEach((p, i) => { if (!p.isAi && !o.seats.includes(i)) o.remote.add(i); });
    this.table = new Table({ ...m.setup, players }, { autoDice: false });
    for (const ev of m.events) this.table.apply(ev);
    o.fp = m.fp;
    this.game = this.table.game;
    this.ais = {};
    this.aiPlan = null;
    this.sel = null;
    this.doneNests = new Set();
    this.fireworksDone = this.game.over;
    this.diceRef = null;
    this.seenLast = null;
    this.prevTurn = undefined;
    $("#setup").hidden = true;
    this.board.setGame(this.game, p => shape(tr(this.lang, this.game.players[p].name)));
    const me = this.game.players[o.seats[0]];
    if (me) this.board.fitView(me.colors);
    this.nextAi = performance.now() + this.delay;
    this.render();
  }

  // a move of this device: send it, and show it when the server sends it back to everybody
  sendMove(opt, entries) {
    const o = this.online, g = this.game;
    if (o.sent || o.queue.length || !g.pending || !o.seats.includes(g.pending.player)) return;
    let ev;
    try { ev = this.table.eventFor(opt); } catch { return; }
    if (ev.dice) return;
    o.sent = { seq: this.table.events.length, pick: ev.pick, entries };
    o.ws.send(JSON.stringify({ t: "move", seq: o.sent.seq, ev }));
  }

  // play the next event from the server once the board is free; others' moves keep the usual pace
  nextEvent() {
    const o = this.online, g = this.game;
    if (!g || !o.queue.length || this.busy()) return;
    const ev = o.queue[0], dec = g.pending;
    const mine = dec && o.seats.includes(dec.player);
    if (!ev.dice && !mine && performance.now() < this.nextAi) return;
    if (ev.dice && performance.now() < (this.moveEnd || 0)) return;    // let the last move land before the next throw
    o.queue.shift();
    let opt, entries = null;
    if (ev.dice) opt = new Option(null, ["dice", ev.dice]);
    else {
      opt = dec.options[ev.pick];
      if (o.sent && o.sent.seq === this.table.events.length && o.sent.pick === ev.pick) entries = o.sent.entries;
    }
    if (!ev.dice) o.sent = null;
    o.applying = true;
    try { this.choose(opt, entries); }
    catch { location.reload(); return; }                          // out of step with the server: start again
    finally { o.applying = false; }
    if (!o.queue.length && o.fp && fingerprint(g) !== o.fp) location.reload();
  }

  tick() {
    const g = this.game;
    if (this.rolling && !this.board.diceRolling()) {   // the dice have settled
      this.rolling = false;
      this.settledAt = performance.now();
      if (this.hold && this.hold.until > this.settledAt + 1000) {   // burnt dice stay crossed out for 1 s
        this.hold.until = this.settledAt + 1000;
        setTimeout(() => this.render(), 1020);
      }
      if (g) this.render();
    }
    if (this.online) { this.nextEvent(); return; }
    if (!g || g.over || !g.pending || !g.players[g.turn].isAi) return;
    if (this.debug || g.pending.kind === "dice") return;
    if (this.busy()) { this.nextAi = Math.max(this.nextAi, performance.now() + this.delay * 0.5); return; }
    if (performance.now() < this.nextAi) return;
    this.choose(this.ais[g.turn].choose(g));
  }
}

// ------------------------------------------------------------ event wiring
function wire(app) {
  document.addEventListener("click", e => {
    if (e.target.id === "info") { app.showInfo(false); return; }      // click beside the card closes it
    if (e.target.closest("#confirm")) {
      const a = e.target.closest("[data-act]")?.dataset.act;
      if (a === "leave_yes") { app.askLeave(false); app.showSetup(); }
      else if (a === "leave_no" || e.target.id === "confirm") app.askLeave(false);
      return;
    }
    if (app.viewOpen && !e.target.closest(".viewmenu")) app.openViewMenu(false);   // click elsewhere folds it
    const b = e.target.closest("[data-act],[data-opt],[data-pay],[data-view]");
    if (!b) return;
    if (b.closest("#setup")) {
      if (b.dataset.act && b.dataset.act !== "lang") app.setupAction(b.dataset.act, b.dataset.val);
      return;
    }
    const g = app.game;
    if (!g) return;
    if (app.scoresMode && !["scores", "info", "info_close", "menu"].includes(b.dataset.act) && b.dataset.view === undefined) return;
    if (b.dataset.view !== undefined) { app.view(b.dataset.view); app.openViewMenu(false); return; }
    if (b.dataset.pay !== undefined) {
      app.choose(g.pending.options.find(o => String(o.payload) === b.dataset.pay));
      return;
    }
    if (b.dataset.opt !== undefined) {
      const o = app.shownOpts[+b.dataset.opt];
      if (o && o.cand) app.pickCandidate(o.cand);
      else if (o) app.choose(o);
      return;
    }
    const act = b.dataset.act;
    if ((act === "dice_go" || act === "dice_rand") && app.online) return;
    if (act === "dice_go") app.choose(new Option(null, ["dice", g.pending.dice.slice()]));
    else if (act === "dice_rand") { g.pending.dice = g.roll(g.pending.dice.length); app.render(); }
    else if (act === "ai_go") app.choose(app.aiPlan[1]);
    else if (act === "undo") { app.resetSelection(g.pending); app.render(); }
    else if (act === "list") { app.sel.list = true; app.render(); }
    else if (act === "tunnels") { const c = +b.dataset.val; app.tunnelOpen = app.tunnelOpen === c ? null : c; app.render(); }
    else if (act === "clicks") { app.resetSelection(g.pending); app.render(); }
    else if (act === "menu") app.askLeave(true);
    else if (act === "viewmenu") app.openViewMenu(!app.viewOpen);
    else if (act === "info") app.showInfo(true);
    else if (act === "scores") app.toggleScores();
    else if (act === "info_close") app.showInfo(false);
    else if (act === "copy_log") app.copyLog();
  });
  document.addEventListener("input", e => {
    if (e.target.dataset.name === undefined) return;
    const s = app.setup;
    s.names = s.names || [];
    s.names[+e.target.dataset.name] = e.target.value;
    app.persist();
  });
  document.addEventListener("change", e => {
    const act = e.target.dataset.act;
    if (act === "lang") app.setLang(e.target.value);
    else if (act === "debug") app.setDebug(e.target.checked);
    else if (act === "follow") {
      app.follow = e.target.checked;
      app.persist();
      if (app.follow && app.game && !app.game.players[app.game.turn].isAi) app.view("mine");
      app.openViewMenu(false);
    }
    else if (act === "speed" && Config.ANIM_SPEEDS[e.target.value]) {
      app.speed = e.target.value;
      app.delay = Config.ANIM_PAUSE * Config.ANIM_SPEEDS[app.speed];
      app.persist();
    }
  });
  const hover = e => {
    const b = e.target.closest("[data-opt]");
    if (!app.game || !app.shownOpts) return;
    if (!b) { if (e.type === "mouseout") app.board.preview(null); return; }
    const o = app.shownOpts[+b.dataset.opt];
    if (!o || o.cand) return;
    const pl = o.payload;
    if (e.type === "mouseout") app.board.preview(null);
    else app.board.preview(pl && pl.steps ? pl : null, Array.isArray(pl) && pl[0] === "tunnel" ? pl : null);
  };
  document.addEventListener("mouseover", hover);
  document.addEventListener("mouseout", hover);
}

async function main() {
  try { await Promise.all([document.fonts.load("400 16px Vazirmatn"), document.fonts.load("700 16px Vazirmatn")]); }
  catch { /* fall back to the system font */ }
  const app = new App();
  window.superMensch = app;            // handy for testing from the console
  wire(app);
  app.setLang(app.lang);
  const q = new URLSearchParams(location.search);       // an online game: play?game=K7QX-42&seats=0,2
  if (!app.offline) app.loadRooms();
  if (q.get("game")) app.startOnline(q.get("game").toUpperCase(), (q.get("seats") || "").split(",").filter(x => x !== "").map(Number));
}
main();

// where the online server is: this page's own host when the server serves it, else Config.SERVER_URL
function apiBase() {
  const h = location.hostname;
  const own = location.protocol.startsWith("http") && (h.endsWith(".workers.dev") || ((h === "localhost" || h === "127.0.0.1") && location.port === "8787"));
  return own ? location.origin : Config.SERVER_URL;
}

// a random id for this browser, kept between visits (online seats come back to it)
function deviceToken() {
  try {
    let k = localStorage.getItem("supermensch-device");
    if (!k) { k = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem("supermensch-device", k); }
    return k;
  } catch { return null; }
}
