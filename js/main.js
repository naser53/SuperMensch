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
const dieHtml = (v, cls, attrs) =>
  `<div class="die ${cls}" ${attrs}>` +
  Array.from({ length: 9 }, (_, i) => `<i class="${PIPS[v].includes(i) ? "on" : ""}"></i>`).join("") + "</div>";

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
    this.board = new Board3D($("#stage"), { onPick: (hit, ev) => this.boardClick(hit, ev) });
    const hint = document.createElement("div");
    hint.className = "hint3d";
    $("#stage").appendChild(hint);
    this.hint = hint;
    setInterval(() => this.tick(), 40);
    window.addEventListener("keydown", e => {
      if (e.key === "Escape" && !$("#info").hidden) { this.showInfo(false); return; }
      if (e.key === "Escape" && this.game) this.showSetup();
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
    this.aiPlan = null;
    this.sel = null;
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
    this.hint.textContent = t(this.lang, this.board.viewMode ? "view_hint" : "view_hint_off");
    const dec = g.pending, p = g.players[g.turn];
    let h = `<div class="pad row between"><label class="check${this.debug ? " on" : ""}">
      <input type="checkbox" data-act="debug" ${this.debug ? "checked" : ""}>${this.T("debug")}</label>${this.langSelect()}</div>`;
    h += '<div class="players sep">';
    g.players.forEach((pl, i) => {
      const parts = [t(this.lang, "score", { n: g.state.scores[i] })];
      if (g.mode === "two") parts.push(t(this.lang, "cards", { n: g.cards[i] }));
      if (g.stuck(i) && !g.places.includes(i)) parts.push(t(this.lang, "stuck"));
      const place = g.places.indexOf(i);
      if (place >= 0) parts.unshift(t(this.lang, "place", { n: place + 1 }));
      h += `<div class="player${i === g.turn && !g.over ? " turn" : ""}${place >= 0 ? " done" : ""}">` +
        pl.colors.map(c => `<span class="dot" style="background:${COLORS[c]}"></span>`).join("") +
        `<span>${this.S(pl.name)}</span><span class="stats">${esc(parts.join(" · "))}</span></div>`;
    });
    h += '</div><div class="pad sep">';
    if (g.over) {
      h += `<div class="won">${this.T("game_over")}</div><ol class="ranking">` +
        g.places.map((i, k) => `<li><span class="muted">${num(this.lang, k + 1)}.</span> <b>${this.S(g.players[i].name)}</b> <span class="muted">${this.T("final_score", { n: g.state.scores[i] })}</span></li>`).join("") +
        `</ol><button class="btn primary" data-act="menu">${this.T("new_game")}</button></div>`;
      h += this.logHtml() + this.footHtml();
      el.innerHTML = h;
      this.board.sync(g.state);
      this.board.preview(null);
      return;
    }
    const who = t(this.lang, p.isAi ? "thinking" : "your_turn");
    h += `<div class="turnline"><b>${this.T("turn", { p: tr(this.lang, p.name), who })}</b>
      <span class="muted small">${this.T("round", { n: g.turnNo })}</span></div>`;
    const human = dec && !p.isAi;
    if (dec !== (this.sel && this.sel.dec)) this.resetSelection(dec);
    h += this.diceHtml(dec, human);
    if (dec && dec.note && !(human && dec.kind === "keep")) h += `<div class="note">${this.S(dec.note)}</div>`;
    h += "</div>";

    let opts = [], shown = g.state;
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
    } else if (human && dec.kind === "play" && !this.sel.list) {
      const sel = this.sel;
      shown = sel.picks.length ? sel.picks[sel.picks.length - 1].state : g.state;
      const hint = sel.ambig ? "pick_which" : sel.piece ? "pick_die_for_piece"
        : (sel.die === null ? "pick_die" : "pick_piece");
      h += `<div class="pad" style="padding-top:0"><div class="note">${this.T(hint)}</div>`;
      if (sel.ambig) {
        opts = sel.ambig;
        h += '<div class="options" style="padding:0">' + opts.map((c, k) =>
          `<button class="opt" data-opt="${k}">${this.S(c.label)}</button>`).join("") + "</div>";
      }
      if (sel.picks.length) {
        h += '<div class="small muted" style="margin-top:6px">' +
          sel.picks.map(x => `<div>${this.S(g.describe({ steps: [x.step] })[0])}</div>`).join("") + "</div>";
      }
      h += '<div class="btns small">' +
        (sel.picks.length ? `<button class="btn" data-act="undo">${this.T("undo")}</button>` : "") +
        `<button class="btn" data-act="list">${this.T("all_moves", { n: dec.options.length })}</button></div></div>`;
      h += '<div class="grow"></div>';
    } else if (human && dec.kind === "keep" && dec.options.some(o => Array.isArray(o.payload))) {
      h += `<div class="pad" style="padding-top:0"><div class="note">${this.T("pick_keep")}</div><div class="btns small">` +
        dec.options.filter(o => !Array.isArray(o.payload)).map(o =>
          `<button class="btn" data-pay="${esc(o.payload)}">${this.S(o.label)}</button>`).join("") +
        "</div></div><div class=\"grow\"></div>";
    } else if (human) {
      opts = dec.options;
      if (dec.kind === "play") {
        h += `<div class="pad small" style="padding-top:0"><button class="btn" data-act="clicks">${this.T("by_clicks")}</button></div>`;
      }
      h += '<div class="options grow">' + opts.map((o, k) => {
        const lines = Array.isArray(o.label) ? o.label : [o.label];
        const prim = dec.kind === "pre_roll" && o.payload === "roll" ? " primary" : "";
        return `<button class="opt${prim}" data-opt="${k}">${lines.map(x => `<div>${this.S(x)}</div>`).join("")}</button>`;
      }).join("") + "</div>";
    } else {
      h += '<div class="grow"></div>';
    }
    this.shownOpts = opts;
    h += this.logHtml() + this.footHtml();
    el.innerHTML = h;
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
    sel.picks.push(c);
    sel.die = null;
    sel.ambig = null;
    sel.piece = null;
    const done = this.matching().filter(q => q.steps.length === sel.picks.length);
    if (done.length) { this.choose(done[0].option); return; }
    this.autoDie();
    this.render();
  }

  clickDie(k, ev) {
    const g = this.game, dec = g.pending, sel = this.sel;
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

  diceHtml(dec, human) {
    const g = this.game;
    if (dec && dec.kind === "dice") {
      return `<div class="dice">${dec.dice.map((v, k) => dieHtml(v, "edit", `data-die="${k}"`)).join("")}</div>`;
    }
    if (human && dec.kind === "keep" && dec.options.some(o => Array.isArray(o.payload))) {
      return `<div class="dice">${dec.dice.map((v, k) =>
        dieHtml(v, "pick" + (this.sel.keep.includes(k) ? " sel" : ""), `data-pdie="${k}"`)).join("")}</div>`;
    }
    if (human && dec.kind === "play" && !this.sel.list) {
      const sel = this.sel, used = new Set(sel.picks.map(x => x.di));
      const use = sel.piece ? this.pieceDice(sel.piece) : this.usableDice();
      return `<div class="dice">${dec.dice.map((v, k) => {
        const cls = used.has(k) ? "used" : (sel.die === k ? "pick sel" : (use.has(k) ? "pick" : "off"));
        return dieHtml(v, cls, `data-pdie="${k}"`);
      }).join("")}</div>`;
    }
    return `<div class="dice">${g.lastDice.map(v => dieHtml(v, "", "")).join("")}</div>`;
  }

  logHtml() {
    const lines = this.game.log.slice(-14).reverse();
    return `<div class="log sep">${lines.map(m => `<div>${this.S(m)}</div>`).join("")}</div>`;
  }

  footHtml() {
    const speed = Math.round((2050 - this.delay) / 20);
    return `<div class="foot sep"><div class="views">
      <button class="btn" data-view="top" title="${this.T("view_top")}">${this.T("view_top")}</button>
      <button class="btn" data-view="angled" title="${this.T("view_angled")}">${this.T("view_angled")}</button>
      <button class="btn" data-view="low" title="${this.T("view_low")}">${this.T("view_low")}</button>
      <button class="btn" data-view="left" title="${this.T("view_left")}">&#8634;</button>
      <button class="btn" data-view="right" title="${this.T("view_right")}">&#8635;</button>
      <button class="btn" data-view="mine">${this.T("view_mine")}</button>
      <button class="btn${this.board.viewMode ? " on" : ""}" data-view="free" title="${this.T("view_free_hint")}">${this.T(this.board.viewMode ? "view_free_done" : "view_free")}</button></div>
      <label class="check small"><input type="checkbox" data-act="follow" ${this.follow ? "checked" : ""}>${this.T("view_follow")}</label>
      <div class="row" style="width:100%"><button class="btn" data-act="menu">${this.T("menu")}</button>
      <button class="btn" data-act="info">${this.T("info")}</button>
      <span class="muted">${this.T("speed")}</span><input type="range" min="0" max="100" value="${speed}" data-act="speed"></div></div>`;
  }

  // ------------------------------------------------------------ actions
  choose(opt) {
    this.game.choose(opt);
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

  // Click on the board. Both orders work:
  //  - die first: a click on a piece moves it with that die (or shows the "not allowed" sign);
  //  - piece first: the piece is selected and only the dice it can use stay clickable;
  //    a click on one of them makes the move. A piece with no move gets the sign.
  // The hunter enters by clicking the gate of its completed color (then: which direction).
  boardClick(hit, ev) {
    const g = this.game, sel = this.sel;
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
      row(this.T("info_general", { n: N(c.general_at) }), P("×", c.general_mult)),
      row(this.T("info_marshal", { n: N(c.marshal_at) }), P("×", c.marshal_mult)),
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
      ${table("info_hits", corr)}${table("info_breaks", brk)}${table("info_ranks", ranks)}
      ${table("info_end", end)}${table("info_tunnels", tun)}
      <p class="muted small">${this.T("info_note")}</p></div>`;
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
    if (!g || g.over || !g.pending || !g.players[g.turn].isAi) return;
    if (this.debug || g.pending.kind === "dice") return;
    if (performance.now() < this.nextAi) return;
    this.choose(this.ais[g.turn].choose(g));
  }
}

// ------------------------------------------------------------ event wiring
function wire(app) {
  document.addEventListener("click", e => {
    if (e.target.id === "info") { app.showInfo(false); return; }      // click beside the card closes it
    const b = e.target.closest("[data-act],[data-opt],[data-die],[data-pdie],[data-pay],[data-view]");
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
    if (b.dataset.pdie !== undefined) { app.clickDie(+b.dataset.pdie, e); return; }
    if (b.dataset.view !== undefined) { app.view(b.dataset.view); return; }
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
    else if (act === "clicks") { app.resetSelection(g.pending); app.render(); }
    else if (act === "menu") app.showSetup();
    else if (act === "info") app.showInfo(true);
    else if (act === "info_close") app.showInfo(false);
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
    else if (act === "follow") {
      app.follow = e.target.checked;
      app.persist();
      if (app.follow && app.game && !app.game.players[app.game.turn].isAi) app.view("mine");
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
