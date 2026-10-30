// SuperMensch browser version: setup screen, side panel and game loop.
import { Config } from "./config.js";
import { Game, Option, Player } from "./engine.js";
import { SimpleAI } from "./ai.js";
import { COLOR_NAMES, LANGS, LANG_NAMES, M, RTL, num, shape, t, tr } from "./i18n.js";
import { Board3D, COLORS } from "./render3d.js";
import { runCommand } from "./debugcmd.js";

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
    this.delay = st.delay || 650;
    this.follow = !!st.follow;
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
  persist() { save({ lang: this.lang, setup: this.setup, delay: this.delay, follow: this.follow }); }

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
    return [i];
  }

  // Leaving a running game for the menu asks first; a finished game just goes.
  askLeave(open) {
    let el = $("#confirm");
    if (open && (!this.game || this.game.over)) { this.showSetup(); return; }
    this.confirming = open;
    if (!open) { if (el) el.hidden = true; return; }
    if (!el) { el = document.createElement("div"); el.id = "confirm"; document.body.appendChild(el); }
    el.dir = this.rtl ? "rtl" : "ltr";
    el.innerHTML = `<div class="confirm-card"><p>${this.T("leave_q")}</p><div class="acts">
      <button class="btn" data-act="leave_no">${this.T("leave_no")}</button>
      <button class="btn primary" data-act="leave_yes">${this.T("leave_yes")}</button></div></div>`;
    el.hidden = false;
  }

  showSetup() {
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
      <div class="muted">${this.T("subtitle")}</div></div>${this.langSelect()}</div>`;
    h += `<h2>${this.T("board")}</h2><div class="choices">` +
      choice(this.T("board6"), "colors", 6, s.colors === 6) + choice(this.T("board4"), "colors", 4, s.colors === 4) + "</div>";
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
    for (let i = 0; i < s.n; i++) {
      const cols = this.seatColors(i);
      const who = t(this.lang, s.seats[i] === "human" ? "human" : "computer");
      const names = cols.map(c => COLOR_NAMES[this.lang][c]).join(tr(this.lang, M("and")));
      const nm = (s.names && s.names[i]) || "";
      const ph = t(this.lang, s.seats[i] === "ai" ? "player_ai" : "player_human", { n: i + 1 });
      h += `<div class="seat">${choice(esc(shape(tr(this.lang, M("seat", { n: i + 1, who, colors: names })))), "seat", i, false)}` +
        cols.map(c => `<span class="dot" style="background:${COLORS[c]}"></span>`).join("") +
        `<input class="name" type="text" maxlength="16" data-name="${i}" value="${esc(nm)}" placeholder="${esc(ph)}" aria-label="${this.T("name")}" autocomplete="off"></div>`;
    }
    h += `<button class="btn primary start" data-act="start">${this.T("start")}</button></div>`;
    el.innerHTML = h;
  }

  setupAction(act, val) {
    const s = this.setup;
    if (act === "colors") {
      s.colors = +val;
      s.n = Math.min(s.n, s.mode === "two" ? s.colors / 2 : s.colors);
    } else if (act === "mode") {
      s.mode = val;
      s.n = s.mode === "two" ? s.colors / 2 : 4;
    } else if (act === "n") s.n = +val;
    else if (act === "pairing") s.pairing = val;
    else if (act === "level") s.level = val;
    else if (act === "seat") s.seats[+val] = s.seats[+val] === "human" ? "ai" : "human";
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
    this.game = new Game(players, s.mode, Config.forBoard(s.colors, s.level || "beginner"), null, this.debug);
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
    if (dec !== (this.sel && this.sel.dec)) { this.resetSelection(dec); this.tunnelOpen = false; }
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
      const who = t(this.lang, p.isAi ? "thinking" : "your_turn");
      status = `<b class="rb-turn">${this.T("turn", { p: tr(this.lang, p.name), who })}</b> <span class="muted small">${this.T("round", { n: g.turnNo })}</span>`;
      if (dec && dec.note && !(human && dec.kind === "keep")) hint = this.S(dec.note);
      if (dec && dec.kind === "dice") {
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
        acts = btn(undo === null ? "disabled" : `data-opt="${undo}" title="${this.S(dec.options[undo].label)}"`,
          this.T("undo"), "undo", ICON.undo);
        if (tunnels.length) {
          pre.tun = `data-act="tunnels"`;
          pre.tunN = tunnels.length;
          if (this.tunnelOpen) list = tunnels.map(k => optHtml(dec.options[k], k)).join("");
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
        (two ? btn(pre.brk || "disabled", this.T("break_short"), "pre", ICON.castle) : "") +
        btn(`${pre.tun || "disabled"} data-n="${pre.tunN || 0}"`, this.T("tunnel_menu", { n: pre.tunN || 0 }),
          `pre${pre.tun && this.tunnelOpen ? " on" : ""}`, ICON.tunnel) + acts;
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
    const speed = Math.round((2050 - this.delay) / 20);
    return this.viewMenuHtml() +
      `<button class="btn rb-btn icon${this.scoresMode ? " on" : ""}" data-act="scores" title="${this.T("scores")}">${ICON.star}<span>${this.T("scores")}</span></button>` +
      `<button class="btn rb-btn icon" data-act="info" title="${this.T("info")}">${ICON.info}<span>${this.T("info")}</span></button>` +
      `<label class="btn rb-btn icon check${this.debug ? " on" : ""}" title="${this.T("debug")}"><input type="checkbox" data-act="debug" ${this.debug ? "checked" : ""}>${ICON.bug}<span>${this.T("debug_short")}</span></label>` +
      this.langSelect() +
      `<label class="rb-speed" title="${this.T("speed")}">${ICON.speed}<input type="range" min="0" max="100" value="${speed}" data-act="speed" aria-label="${this.T("speed")}"></label>` +
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

  hop() { return Math.max(50, Math.min(200, this.delay * 0.22)); }

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
    if (dec && ["play", "keep", "dice"].includes(dec.kind)) cur = dec.dice;
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
    } else if (cur && dec && dec.kind === "dice") b.placeDice(cur, colors(dec.player));
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
      if (!this.pieceDice(sel.piece).has(k)) { this.board.forbid(ev); return; }
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
      this.board.forbid(ev);
    }
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
    const card = dec && dec.kind === "pre_roll" && opt.payload === "triple";
    if (!entries && dec && dec.kind === "play" && opt.payload && opt.payload.steps) entries = this.replay(opt.payload);
    if (dec && dec.kind === "play") { this.usedFrom = dec.dice; this.usedIdx = this.usedDice(dec.dice, opt.payload); }
    if (dec && dec.kind === "keep" && Array.isArray(opt.payload)) {
      this.keptFrom = dec.dice;
      this.keptIdx = this.keptDice(dec.dice, opt.payload[1]);
    }
    g.noMove = null;
    g.choose(opt);
    // a throw with no move followed at once by the next player's throw (a stuck player throws
    // straight away): show the burnt dice first, then the next throw
    if (g.noMove && g.pending && g.pending.dice && g.pending.dice.length && g.pending.player !== g.noMove.player) {
      this.hold = { ...g.noMove, until: performance.now() + 2300 };
      setTimeout(() => this.render(), 2320);
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
  }

  // A debug command was typed (js/debugcmd.js); the answer shows under the box.
  command(input) {
    const g = this.game;
    if (!g || !input.value.trim()) return;
    const r = runCommand(g, input.value, o => this.choose(o));
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
    g.manual = on;
    this.aiPlan = null;
    if (!on && g.pending && g.pending.kind === "dice") {
      g.choose(new Option(null, ["dice", g.roll(g.pending.dice.length)]));
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
      if (!dice.size) { sel.piece = null; this.board.forbid(ev); this.render(); return; }
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
    const brk = [row(this.T("info_wall"), P("+", c.wall_break)), row(this.T("info_castle"), P("+", c.castle_break))];
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
      ${table("info_hits", corr)}${table("info_breaks", brk)}${table("info_ranks", ranks)}
      ${table("info_end", end)}${table("info_tunnels", tun)}
      <p class="muted small">${this.T("info_note")}</p>
      <h3>${this.T("log")}</h3><div class="info-log">${g.log.slice().reverse().map(m => `<div>${this.S(m)}</div>`).join("")}</div></div>`;
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

  tick() {
    const g = this.game;
    if (this.rolling && !this.board.diceRolling()) { this.rolling = false; this.settledAt = performance.now(); if (g) this.render(); }   // the dice have settled
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
    if (act === "dice_go") app.choose(new Option(null, ["dice", g.pending.dice.slice()]));
    else if (act === "dice_rand") { g.pending.dice = g.roll(g.pending.dice.length); app.render(); }
    else if (act === "ai_go") app.choose(app.aiPlan[1]);
    else if (act === "undo") { app.resetSelection(g.pending); app.render(); }
    else if (act === "list") { app.sel.list = true; app.render(); }
    else if (act === "tunnels") { app.tunnelOpen = !app.tunnelOpen; app.render(); }
    else if (act === "clicks") { app.resetSelection(g.pending); app.render(); }
    else if (act === "menu") app.askLeave(true);
    else if (act === "viewmenu") app.openViewMenu(!app.viewOpen);
    else if (act === "info") app.showInfo(true);
    else if (act === "scores") app.toggleScores();
    else if (act === "info_close") app.showInfo(false);
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
    else if (act === "speed") { app.delay = 2050 - 20 * +e.target.value; app.persist(); }
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
}
main();
