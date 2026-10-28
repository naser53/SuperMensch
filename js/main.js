// SuperMensch browser version: setup screen, side panel and game loop.
import { Config } from "./config.js";
import { Game, Option, Player } from "./engine.js";
import { SimpleAI } from "./ai.js";
import { COLOR_NAMES, LANGS, LANG_NAMES, M, RTL, num, shape, t, tr } from "./i18n.js";
import { Board3D, COLORS } from "./render3d.js";

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function load() {
  try { return JSON.parse(localStorage.getItem("supermensch") || "{}"); } catch { return {}; }
}
function save(d) {
  try { localStorage.setItem("supermensch", JSON.stringify(d)); } catch { /* private mode: no settings */ }
}

const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const dieHtml = (v, edit, k) =>
  `<div class="die${edit ? " edit" : ""}" ${edit ? `data-die="${k}"` : ""}>` +
  Array.from({ length: 9 }, (_, i) => `<i class="${PIPS[v].includes(i) ? "on" : ""}"></i>`).join("") + "</div>";

class App {
  constructor() {
    const st = load();
    this.lang = LANGS.includes(st.lang) ? st.lang : "en";
    this.setup = Object.assign({ colors: 6, mode: "two", n: 3, pairing: "opposite",
      seats: ["human", "ai", "ai", "ai", "ai", "ai"] }, st.setup || {});
    this.delay = st.delay || 650;
    this.debug = false;
    this.game = null;
    this.ais = {};
    this.filterPiece = null;
    this.aiPlan = null;
    this.nextAi = 0;
    this.board = new Board3D($("#stage"), { onPick: m => this.pickPiece(m) });
    const hint = document.createElement("div");
    hint.className = "hint3d";
    $("#stage").appendChild(hint);
    this.hint = hint;
    setInterval(() => this.tick(), 40);
    window.addEventListener("keydown", e => {
      if (e.key === "Escape" && this.game) this.showSetup();
    });
    this.showSetup();
  }

  T(key, params) { return esc(t(this.lang, key, params)); }
  S(x) { return esc(shape(tr(this.lang, x))); }
  get rtl() { return RTL.has(this.lang); }
  persist() { save({ lang: this.lang, setup: this.setup, delay: this.delay }); }

  setLang(l) {
    this.lang = l;
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
      h += `<div class="seat">${choice(esc(shape(tr(this.lang, M("seat", { n: i + 1, who, colors: names })))), "seat", i, false)}` +
        cols.map(c => `<span class="dot" style="background:${COLORS[c]}"></span>`).join("") + "</div>";
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
      players.push(Player(M(ai ? "player_ai" : "player_human", { n: i + 1 }), this.seatColors(i), ai));
    }
    this.game = new Game(players, s.mode, Config.forBoard(s.colors), null, this.debug);
    this.ais = {};
    players.forEach((p, i) => { if (p.isAi) this.ais[i] = new SimpleAI(); });
    this.filterPiece = null;
    this.aiPlan = null;
    $("#setup").hidden = true;
    this.board.setGame(this.game, p => shape(tr(this.lang, this.game.players[p].name)));
    this.nextAi = performance.now() + this.delay;
    this.render();
  }

  // ------------------------------------------------------------ game panel
  render() {
    if (!this.game) { this.renderSetup(); return; }
    const g = this.game, el = $("#panel");
    el.dir = this.rtl ? "rtl" : "ltr";
    this.hint.textContent = t(this.lang, "view_hint");
    const dec = g.pending, p = g.players[g.turn];
    let h = `<div class="pad row between"><label class="check${this.debug ? " on" : ""}">
      <input type="checkbox" data-act="debug" ${this.debug ? "checked" : ""}>${this.T("debug")}</label>${this.langSelect()}</div>`;
    h += '<div class="players sep">';
    g.players.forEach((pl, i) => {
      const parts = [t(this.lang, "score", { n: g.state.scores[i] })];
      if (g.mode === "two") parts.push(t(this.lang, "cards", { n: g.cards[i] }));
      if (g.stuck(i)) parts.push(t(this.lang, "stuck"));
      h += `<div class="player${i === g.turn && g.winner === null ? " turn" : ""}">` +
        pl.colors.map(c => `<span class="dot" style="background:${COLORS[c]}"></span>`).join("") +
        `<span>${this.S(pl.name)}</span><span class="stats">${esc(parts.join(" · "))}</span></div>`;
    });
    h += '</div><div class="pad sep">';
    if (g.winner !== null) {
      h += `<div class="won">${this.T("won", { p: tr(this.lang, g.players[g.winner].name) })}</div>
        <button class="btn primary" data-act="menu">${this.T("new_game")}</button></div>`;
      h += this.logHtml() + this.footHtml();
      el.innerHTML = h;
      this.board.sync(g.state);
      this.board.preview(null);
      return;
    }
    const who = t(this.lang, p.isAi ? "thinking" : "your_turn");
    h += `<div class="turnline"><b>${this.T("turn", { p: tr(this.lang, p.name), who })}</b>
      <span class="muted small">${this.T("round", { n: g.turnNo })}</span></div>`;
    const dice = dec && dec.kind === "dice" ? dec.dice : g.lastDice;
    h += `<div class="dice">${dice.map((v, k) => dieHtml(v, dec && dec.kind === "dice", k)).join("")}</div>`;
    if (dec && dec.note) h += `<div class="note">${this.S(dec.note)}</div>`;
    h += "</div>";

    let opts = [];
    if (dec && dec.kind === "dice") {
      h += `<div class="pad" style="padding-top:0"><div class="muted small">${this.T("dice_hint")}</div>
        <div class="btns"><button class="btn primary" data-act="dice_go">${this.T("continue")}</button>
        <button class="btn" data-act="dice_rand">${this.T("random")}</button></div></div><div class="grow"></div>`;
    } else if (dec && p.isAi && this.debug) {
      if (!this.aiPlan || this.aiPlan[0] !== dec) this.aiPlan = [dec, this.ais[g.turn].choose(g)];
      const o = this.aiPlan[1];
      const lines = Array.isArray(o.label) ? o.label : [o.label];
      h += `<div class="pad" style="padding-top:0"><div class="muted small">${this.T("ai_will")}</div>` +
        lines.map(x => `<div>${this.S(x)}</div>`).join("") +
        `<div class="btns"><button class="btn primary" data-act="ai_go">${this.T("continue")}</button></div></div><div class="grow"></div>`;
    } else if (dec && !p.isAi) {
      opts = dec.options;
      if (dec.kind === "play" && this.filterPiece) {
        const fp = this.filterPiece.join(",");
        opts = opts.filter(o => o.payload.steps.some(s => s.mover.join(",") === fp));
      }
      if (dec.kind === "play") h += `<div class="pad muted small" style="padding-top:0">${this.T("moves_hint", { n: opts.length })}</div>`;
      h += '<div class="options grow">' + opts.map((o, k) => {
        const lines = Array.isArray(o.label) ? o.label : [o.label];
        return `<button class="opt" data-opt="${k}">${lines.map(x => `<div>${this.S(x)}</div>`).join("")}</button>`;
      }).join("") + "</div>";
    } else {
      h += '<div class="grow"></div>';
    }
    this.shownOpts = opts;
    h += this.logHtml() + this.footHtml();
    el.innerHTML = h;
    this.board.sync(g.state, this.filterPiece);
    if (dec && p.isAi && this.debug && this.aiPlan) {
      const pl = this.aiPlan[1].payload;
      this.board.preview(pl && pl.steps ? pl : null, Array.isArray(pl) && pl[0] === "tunnel" ? pl : null);
    } else {
      this.board.preview(null);
    }
  }

  logHtml() {
    const lines = this.game.log.slice(-14).reverse();
    return `<div class="log sep">${lines.map(m => `<div>${this.S(m)}</div>`).join("")}</div>`;
  }

  footHtml() {
    const speed = Math.round((2050 - this.delay) / 20);
    return `<div class="foot sep"><button class="btn" data-act="menu">${this.T("menu")}</button>
      <button class="btn" data-act="view">${this.T("reset_view")}</button>
      <button class="btn" data-act="top">${this.T("top_view")}</button>
      <span class="muted">${this.T("speed")}</span><input type="range" min="0" max="100" value="${speed}" data-act="speed"></div>`;
  }

  // ------------------------------------------------------------ actions
  choose(opt) {
    this.game.choose(opt);
    this.filterPiece = null;
    this.aiPlan = null;
    this.nextAi = performance.now() + this.delay;
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

  pickPiece(m) {
    const g = this.game;
    if (!g || !g.pending || g.pending.kind !== "play" || g.players[g.turn].isAi) return;
    this.filterPiece = m && this.filterPiece && m.join(",") === this.filterPiece.join(",") ? null : m;
    this.render();
  }

  tick() {
    const g = this.game;
    if (!g || g.winner !== null || !g.pending || !g.players[g.turn].isAi) return;
    if (this.debug || g.pending.kind === "dice") return;
    if (performance.now() < this.nextAi) return;
    this.choose(this.ais[g.turn].choose(g));
  }
}

// ------------------------------------------------------------ event wiring
function wire(app) {
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-act],[data-opt],[data-die]");
    if (!b) return;
    if (b.closest("#setup")) {
      if (b.dataset.act && b.dataset.act !== "lang") app.setupAction(b.dataset.act, b.dataset.val);
      return;
    }
    const g = app.game;
    if (!g) return;
    if (b.dataset.die !== undefined) {
      const k = +b.dataset.die;
      g.pending.dice[k] = g.pending.dice[k] % 6 + 1;
      app.render();
      return;
    }
    if (b.dataset.opt !== undefined) { app.choose(app.shownOpts[+b.dataset.opt]); return; }
    const act = b.dataset.act;
    if (act === "dice_go") app.choose(new Option(null, ["dice", g.pending.dice.slice()]));
    else if (act === "dice_rand") { g.pending.dice = g.roll(g.pending.dice.length); app.render(); }
    else if (act === "ai_go") app.choose(app.aiPlan[1]);
    else if (act === "menu") app.showSetup();
    else if (act === "view") app.board.fitView(false);
    else if (act === "top") app.board.fitView(true);
  });
  document.addEventListener("contextmenu", e => {
    const b = e.target.closest("[data-die]");
    if (!b || !app.game) return;
    e.preventDefault();
    const k = +b.dataset.die;
    app.game.pending.dice[k] = (app.game.pending.dice[k] + 4) % 6 + 1;
    app.render();
  });
  document.addEventListener("change", e => {
    const act = e.target.dataset.act;
    if (act === "lang") app.setLang(e.target.value);
    else if (act === "debug") app.setDebug(e.target.checked);
    else if (act === "speed") { app.delay = 2050 - 20 * +e.target.value; app.persist(); }
  });
  const hover = e => {
    const b = e.target.closest("[data-opt]");
    if (!app.game || !app.shownOpts) return;
    if (!b) { if (e.type === "mouseout") app.board.preview(null); return; }
    const o = app.shownOpts[+b.dataset.opt];
    if (!o) return;
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
