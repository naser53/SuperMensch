// Server logic with no Cloudflare parts, so Node tests can run it: game ids, setup checks,
// and a room (one online game) that throws the dice and answers for the computer players.

import { SimpleAI } from "../js/ai.js";
import { Config } from "../js/config.js";
import { tr } from "../js/i18n.js";
import { Table, fingerprint } from "../js/table.js";

export const USERS = 10;                 // user1 .. user10 at the first start
export const NAME_MAX = 24;
export const OPEN_HOURS = 24;            // a game idle this long leaves the list of open games

const ID_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ";   // no I, L, O: easy to read out loud

// a fresh game id such as K7QX-42 (four letters, two digits)
export function newGameId(rand = cryptoRandom) {
  let s = "";
  for (let i = 0; i < 4; i++) s += ID_CHARS[Math.floor(rand() * ID_CHARS.length)];
  return `${s}-${String(Math.floor(rand() * 100)).padStart(2, "0")}`;
}

// Which of the wanted seats a device gets. A seat held by a connected device of another
// token stays with it until that device leaves (Exit, or its connection closes); the same
// token (the same browser, reconnecting) takes its seats back.
//   humans: the seats of people; others: [{ token, seats }] of the other connected devices
export function claimSeats(want, humans, others, token) {
  const held = new Map();
  for (const o of others) for (const s of o.seats || []) held.set(s, o.token);
  const seats = [], taken = [];
  for (const s of new Set(want)) {
    if (!humans.includes(s)) continue;
    if (held.has(s) && !(token && held.get(s) === token)) taken.push(s); else seats.push(s);
  }
  return { seats, taken };
}

export function isGameId(s) { return typeof s === "string" && /^[A-Z]{4}-\d\d$/.test(s); }

export function cryptoRandom() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 4294967296;
}

// The admin's piece colors: one entry per color of Config.PIECE_COLORS, "#rrggbb" or null (the
// default). A color equal to its default is stored as null, so a later default change reaches it.
export function cleanColors(list, defaults = Config.PIECE_COLORS) {
  if (!Array.isArray(list) || list.length !== defaults.length) throw new Error("bad colors");
  return list.map((c, i) => {
    if (c === null || c === "") return null;
    if (typeof c !== "string" || !/^#[0-9a-f]{6}$/i.test(c)) throw new Error("bad colors");
    c = c.toLowerCase();
    return c === defaults[i] ? null : c;
  });
}

// the board's own colors, [surface, edge], checked the same way (defaults Config.BOARD_COLORS)
export const cleanBoard = list => cleanColors(list, Config.BOARD_COLORS);

// the name of the next game of a room ("Play again"): "Test" -> "Test (2)" -> "Test (3)"
export function nextName(name) {
  const m = /^(.*) \((\d+)\)$/.exec(name || "");
  const base = m ? m[1] : name || "Game", n = m ? +m[2] + 1 : 2, tail = ` (${n})`;
  return base.slice(0, NAME_MAX - tail.length) + tail;
}

export function cleanName(s) {
  if (typeof s !== "string") return null;
  s = s.replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
  return s || null;
}

// Check a setup sent by a device; returns a clean copy or throws.
// seats: [{ user: id } | { ai: true }], each with its colors.
// The colors of seat i: two colors each (the seat's own and the one opposite) or one.
export function seatColors(mode, colors, i) { return mode === "two" ? [i, i + colors / 2] : [i]; }

// The admin changes who plays in a room (a test aid). Board, game type and dice stay. The same
// number of seats keeps the game going (only who sits there changes); another number starts
// the game again. seats: [{ user } | { ai: true }]
export function editSetup(old, seats, users) {
  const setup = checkSetup({ mode: old.mode, colors: old.colors, level: old.level, corridor: old.corridor,
    seats: (seats || []).map((s, i) => ({ ...(s.ai ? { ai: true } : { user: s.user }), colors: seatColors(old.mode, old.colors, i) })) }, users);
  return { setup, keep: setup.players.length === old.players.length };
}

// A child picks the colors of a seat on the first page, until the first move of a person
// (owner, 2026-11-01). First come, first served: a color picked by another seat is taken; a
// color of a seat that has not picked yet (or of a computer) is swapped with the one given up.
// In the two-color game the seat names both its colors. Returns the new setup (the seat is
// marked `picked`) or throws.
export function pickColors(setup, seat, colors) {
  const players = setup.players.map(p => ({ ...p, colors: p.colors.slice() }));
  const me = players[seat];
  if (!Number.isInteger(seat) || !me || me.isAi) throw new Error("no such seat");
  const n = setup.mode === "two" ? 2 : 1;
  if (!Array.isArray(colors) || colors.length !== n || new Set(colors).size !== n ||
      colors.some(c => !Number.isInteger(c) || c < 0 || c >= setup.colors)) throw new Error("bad colors");
  const give = me.colors.filter(c => !colors.includes(c));
  for (const c of colors) {
    if (me.colors.includes(c)) continue;
    const j = players.findIndex((p, k) => k !== seat && p.colors.includes(c));
    if (j >= 0) {
      if (players[j].picked) throw new Error("color taken");
      players[j].colors[players[j].colors.indexOf(c)] = give.shift();
    } else give.shift();                                  // a free color: the given-up one stays free
  }
  me.colors = colors.slice();
  me.picked = true;
  return { ...setup, players };
}

// How many events stay when the colors change: those before the first move (a pick) of
// anybody; or -1 when a person has moved already and the colors are fixed.
export function colorsKeep(setup, events) {
  const t = new Table(setup, { autoDice: false });
  let keep = -1;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.pick !== undefined) {
      if (keep < 0) keep = i;
      if (!setup.players[t.game.pending.player].isAi) return -1;
    }
    t.apply(ev);
  }
  return keep < 0 ? events.length : keep;
}

export function checkSetup(su, users) {
  if (!su || typeof su !== "object") throw new Error("no setup");
  const mode = su.mode === "one" ? "one" : su.mode === "two" ? "two" : null;
  const colors = Config.BOARDS.includes(su.colors) ? su.colors : null;
  const level = Object.keys(Config.LEVELS).includes(su.level) ? su.level : "beginner";
  if (!mode || !colors) throw new Error("bad mode or board");
  const corridor = (colors === 6 || colors === 8) && Config.CORRIDORS.includes(su.corridor) ? su.corridor : 10;
  const seats = Array.isArray(su.seats) ? su.seats : [];
  const max = mode === "two" ? colors / 2 : colors;
  if (seats.length < 2 || seats.length > max) throw new Error("bad number of players");
  const used = new Set(), seen = new Set();
  const players = seats.map((s, i) => {
    const cols = Array.isArray(s.colors) ? s.colors : [];
    if (cols.length !== (mode === "two" ? 2 : 1)) throw new Error("bad colors");
    for (const c of cols) {
      if (!Number.isInteger(c) || c < 0 || c >= colors || used.has(c)) throw new Error("bad colors");
      used.add(c);
    }
    if (s.ai) return { name: `Computer ${i + 1}`, colors: cols, isAi: true, user: null };
    const u = users.find(x => x.id === s.user);
    if (!u || seen.has(u.id)) throw new Error("bad player");
    seen.add(u.id);
    return { name: u.name, colors: cols, isAi: false, user: u.id };
  });
  if (!players.some(p => !p.isAi)) throw new Error("no human player");
  return { players, mode, colors, level, ...(corridor !== 10 ? { corridor } : {}) };
}

// One online game. The setup and the events are all that is stored.
// The admin's "place" (a test aid): the pieces as text, a line per color or per piece, e.g.
//   R: 5 y y y        B: z1 z2 z3 z4        R2 23        R2z 3  (or R2 z3)
// Track fields 1..L as on the board, z1.. the color's own nest (z1 just inside, the last one at the
// back; L+1.. still works), y (or 0) the yard. A line per piece moves that piece only (R2 = red 2).
const LETTERS = "RBGYPTNK";
export function placeText(g) {
  const L = g.L;
  return g.state.pos.map((a, col) => `${LETTERS[col]}: ` + a.map(r => (r === -1 ? "y" : r >= L ? "z" + (r - L + 1) : String(g.absOf(col, r) + 1))).join(" ")).join("\n");
}

export function parsePlace(text, g) {
  const L = g.L, pos = g.state.pos.map(a => a.slice());
  const field = (col, w) => {
    if (/^y$/i.test(w) || w === "0") return -1;
    const z = /^z(\d+)$/i.exec(w);
    if (z) {
      const k = Number(z[1]);
      if (k < 1 || k > pos[col].length) throw new Error(`no such nest field: ${w}`);
      return L + k - 1;
    }
    const n = Number(w);
    if (!Number.isInteger(n) || n < 1 || n > L + pos[col].length) throw new Error(`no such field: ${w}`);
    return n <= L ? g.relOf(col, n - 1) : n - 1;
  };
  const colorOf = (c, line) => {
    const col = LETTERS.indexOf(c.toUpperCase());
    if (col < 0 || col >= pos.length) throw new Error(`no such color: ${line.trim()}`);
    return col;
  };
  for (const line of String(text || "").split(/[\n;]+/)) {
    if (!line.trim()) continue;
    const one = /^\s*([a-z])\s*(\d+)\s*(z?)\s*:?\s*(\S+)\s*$/i.exec(line);   // R2 23 · R2z 3 · R2 z3
    if (one) {
      const col = colorOf(one[1], line), i = Number(one[2]) - 1;
      if (i < 0 || i >= pos[col].length) throw new Error(`no such piece: ${line.trim()}`);
      pos[col][i] = field(col, one[3] ? "z" + one[4] : one[4]);
      continue;
    }
    const m = /^\s*([a-z])\s*:?\s*(.*)$/i.exec(line);
    if (!m) throw new Error(`no such color: ${line.trim()}`);
    const col = colorOf(m[1], line);
    const ws = m[2].trim().split(/[\s,]+/).filter(Boolean);
    if (ws.length !== pos[col].length) throw new Error(`${LETTERS[col]} needs ${pos[col].length} fields`);
    pos[col] = ws.map(w => field(col, w));
  }
  return pos;
}

// The admin's debug commands for a room (a test aid), on the dice turns of the game. A dice turn
// is one turn of throwing: a second try (retry) belongs to the turn of the first throw.
//   rewind N         the game goes back to dice turn N (0 = the first) and throws it again with
//                    the same dice (a computer keeps its moves with them); N < 0 counts back
//                    from the last turn (-1: the one before it); "go drop N" is the old name
//   roll dice 3,6    the last dice turn is thrown again with these dice (as many as it had);
//                    "drop dice" is the old name
//   reset            the game starts again from the beginning, with the same players
export function parseDebug(text) {
  const s = String(text || "").trim().toLowerCase();
  if (s === "reset") return { reset: true };
  let m = /^(?:rewind|go\s+drop)\s+(-?\d+)$/.exec(s);
  if (m) return { go: +m[1] };
  m = /^(?:roll|drop)\s+dice\s+([1-6](?:[\s,]+[1-6])*)$/.exec(s);
  if (m) return { dice: m[1].split(/[\s,]+/).map(Number) };
  throw new Error("commands: rewind N · roll dice 3,6 · reset");
}

// the dice turns of a game: [{ at, player, dice }], at = index of the turn's first throw event
export function diceTurns(setup, events) {
  const t = new Table(setup, { autoDice: false }), out = [];
  let retry = false;
  for (const ev of events) {
    const g = t.game;
    if (ev.dice) {
      if (retry && out.length) out[out.length - 1].dice.push(ev.dice.slice());
      else out.push({ at: t.events.length, player: g.pending.player, dice: [ev.dice.slice()] });
      retry = false;
    } else if (ev.pick !== undefined) retry = g.pending.options[ev.pick].payload === "retry";
    else retry = false;
    t.apply(ev);
  }
  return out;
}

export class Room {
  constructor(setup, events = [], rng = cryptoRandom) {
    this.setup = setup;
    this.table = Table.replay(setup, events);
    this.table.game.rng = rng;
    this.table.autoDice = true;
    this.table._settle();
    this.ais = {};
    setup.players.forEach((p, i) => { if (p.isAi) this.ais[i] = new SimpleAI(); });
    this._advance();
  }

  get events() { return this.table.events; }

  // may the seats still pick their colors? (no person has moved yet)
  colorsOpen() { return colorsKeep(this.setup, this.events) >= 0; }

  // A seat picks its colors (pickColors). Returns a new room with the new setup and the events
  // before the first move; the server answers the new throws and the computer's moves again.
  recolor(seat, colors) {
    const keep = colorsKeep(this.setup, this.events);
    if (keep < 0) throw new Error("the game has started");
    return new Room(pickColors(this.setup, seat, colors), this.events.slice(0, keep), this.table.game.rng);
  }

  // A device's move. `seq` is the number of events the device has seen; `seats` the seats it
  // holds. Returns { from, events } (the new events) or throws with the reason.
  move(seq, ev, seats) {
    const g = this.table.game, from = this.events.length;
    if (seq !== from) throw new Error("stale");
    if (!g.pending || g.over) throw new Error("no decision");
    if (!seats.includes(g.pending.player) || this.setup.players[g.pending.player].isAi) throw new Error("not your turn");
    if (!ev || !Number.isInteger(ev.pick)) throw new Error("dice come from the server");
    this.table.apply({ pick: ev.pick });
    this._advance();
    return { from, events: this.events.slice(from) };
  }

  // the admin puts the pieces somewhere else (text as in parsePlace); the turn starts again
  place(text) {
    const from = this.events.length;
    this.table.apply({ place: parsePlace(text, this.table.game) });
    this._advance();
    return { from, events: this.events.slice(from) };
  }

  placeText() { return placeText(this.table.game); }

  // the admin's debug command (parseDebug): a new room from the events before that dice turn
  // and the turn's throw again (the same dice, or the given ones)
  debug(text) {
    const cmd = parseDebug(text);
    if (cmd.reset) return { turn: null, room: new Room(this.setup, [], this.table.game.rng) };
    const turns = diceTurns(this.setup, this.events);
    if (!turns.length) throw new Error("no dice thrown yet");
    const k = cmd.dice ? turns.length - 1 : cmd.go < 0 ? turns.length - 1 + cmd.go : cmd.go;
    if (k < 0 || k >= turns.length) throw new Error(`no dice turn ${cmd.go} (0..${turns.length - 1})`);
    const first = turns[k].dice[0];
    if (cmd.dice && cmd.dice.length !== first.length) throw new Error(`this throw has ${first.length} dice`);
    let events = this.events.slice(0, turns[k].at).concat([{ dice: cmd.dice || first.slice() }]);
    if (!cmd.dice) {             // the same dice: the computers play on as before, up to a person
      const t = Table.replay(this.setup, events);
      for (let j = events.length; j < this.events.length; j++) {
        const ev = this.events[j], g = t.game;
        if ((ev.pick === undefined && !ev.dice) || !g.pending || !this.setup.players[g.pending.player].isAi) break;
        t.apply(ev);
      }
      events = t.events;
    }
    return { turn: k, room: new Room(this.setup, events, this.table.game.rng) };
  }

  // the dice turns as text, one per line: "#3 Naser 6 2 / 5 5" (a second try after the slash)
  turnsText() {
    return diceTurns(this.setup, this.events).map((t, i) =>
      `#${i} ${this.setup.players[t.player].name} ${t.dice.map(d => d.join(" ")).join(" / ")}`).join("\n");
  }

  // the computer players move at once; the devices show their moves one by one
  _advance() {
    const g = this.table.game;
    for (let k = 0; k < 5000 && g.pending && !g.over && this.setup.players[g.pending.player].isAi; k++)
      this.table.choose(this.ais[g.pending.player].choose(g));
  }

  fingerprint() { return fingerprint(this.table.game); }

  // what a plain page shows: whose decision, its options in English, the dice
  view(lang = "en") {
    const g = this.table.game, d = g.pending;
    const label = l => (Array.isArray(l) ? l.map(x => tr(lang, x)).join(" / ") : tr(lang, l));
    return {
      over: g.over, places: g.places, scores: g.state.scores, round: g.turnNo,
      pending: d && !g.over ? { player: d.player, kind: d.kind, dice: d.dice, options: d.options.map(o => label(o.label)) } : null,
      log: g.log.slice(-8).map(m => tr(lang, m)),
    };
  }

  result() {
    const g = this.table.game;
    return { places: g.places, scores: g.state.scores, names: this.setup.players.map(p => p.name), users: this.setup.players.map(p => p.user) };
  }
}
