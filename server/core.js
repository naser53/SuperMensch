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
  const setup = checkSetup({ mode: old.mode, colors: old.colors, level: old.level,
    seats: (seats || []).map((s, i) => ({ ...(s.ai ? { ai: true } : { user: s.user }), colors: seatColors(old.mode, old.colors, i) })) }, users);
  return { setup, keep: setup.players.length === old.players.length };
}

export function checkSetup(su, users) {
  if (!su || typeof su !== "object") throw new Error("no setup");
  const mode = su.mode === "one" ? "one" : su.mode === "two" ? "two" : null;
  const colors = su.colors === 4 || su.colors === 6 ? su.colors : null;
  const level = Object.keys(Config.LEVELS).includes(su.level) ? su.level : "beginner";
  if (!mode || !colors) throw new Error("bad mode or board");
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
  return { players, mode, colors, level };
}

// One online game. The setup and the events are all that is stored.
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
