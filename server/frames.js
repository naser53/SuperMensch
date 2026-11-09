// What a device is told about the game (owner, 2026-11-06: the rules live on the server only).
// The page has no rules engine: after every event the server sends a "view" of the game, the
// way the page reads it, with everything the page used to work out itself already worked out:
//   - every state (pieces, ranks, hunters, scores, tunnels) carries `x`: the hunter that may come
//     in for each player (he), each player's complete color (cc), the walls and castles (s), and
//     for a state the player may click through, what stops each piece with each die (b);
//   - a decision of a person carries its options, the click-by-click sequences (seqs, each step
//     with its words, desc) and, before the roll, why a color has no tunnel (tblock);
//   - a frame (one event) carries the chosen option (o), the steps to animate (e) and the new
//     lines of the move log (log).
// States are written once in a table and referred to as { $s: n }. js/view.js reads it back.

import { State } from "../js/engine.js";

// The page tells a new throw from the same dice by the array itself (main.js syncDice: the
// engine keeps one array per throw, shared by lastDice and the decision's dice). Every dice array
// gets a number, so the page can give one throw one array again.
const diceIds = new WeakMap();
let nextDiceId = 1;
function diceId(a) {
  if (!Array.isArray(a)) return null;
  if (!diceIds.has(a)) diceIds.set(a, nextDiceId++);
  return diceIds.get(a);
}

// the part of the config the page shows (the info card) or draws with
export function cfgView(cfg) {
  const out = {};
  for (const [k, v] of Object.entries(cfg)) if (k !== "two_dice") out[k] = v;
  out.track_len = cfg.track_len;
  out.last_rel = cfg.last_rel;
  out.tunnel_list = cfg.tunnels();
  return out;
}

class Encoder {
  constructor(g) { this.g = g; this.states = []; this.seen = new Map(); }

  // a state in the table, with what the page asks about it
  ref(st, blockers = false) {
    let n = this.seen.get(st);
    if (n === undefined) {
      const g = this.g, players = g.players.map((_, p) => p);
      const x = { he: players.map(p => g.hunterEligible(p, st)), cc: players.map(p => g._completedColor(p, st)),
        s: [...g.structures(st)] };
      n = this.states.length;
      this.seen.set(st, n);
      // a copy: the engine changes the current state in place as the game goes on
      this.states.push(JSON.parse(JSON.stringify({ pos: st.pos, kills: st.kills, hunters: st.hunters, scores: st.scores,
        tunnels: st.tunnels, tmark: st.tmark, hit: st.hit, earned: st.earned, hits: st.hits, x })));
    }
    if (blockers && !this.states[n].x.b) this.states[n].x.b = this.blockers(st);
    return { $s: n };
  }

  // what stops each piece of the player whose turn it is, with each die of the decision
  blockers(st) {
    const g = this.g, p = g.turn, dec = g.pending, out = {};
    const dice = [...new Set(dec && dec.dice ? dec.dice : [])];
    for (const col of g.players[p].colors)
      for (let i = 0; i < g.cfg.pieces_per_color; i++)
        for (const d of dice) {
          const b = g.blockerOf(st, p, ["p", col, i], d);
          if (b) out[`p,${col},${i}|${d}`] = b;
        }
    return out;
  }

  enc(v) {
    if (v instanceof State) return this.ref(v);
    if (Array.isArray(v)) return v.map(x => this.enc(x));
    if (v instanceof Map) return [...v].map(x => this.enc(x));
    if (v && typeof v === "object") {
      const o = {};
      for (const [k, x] of Object.entries(v)) if (x !== undefined && typeof x !== "function") o[k] = this.enc(x);
      return o;
    }
    return v;
  }
}

// The states after each step with the points of the captures made so far: ranks, earned points
// and scores (the engine scores a play as a whole, once it is over). Owner, 2026-11-07: the
// effects of a move (+points, a new general or marshal) show when that piece lands, not after
// the last die. A wall or castle is scored as a whole, so a play that breaks one keeps its
// points for its last step. Only for drawing: the engine's own states are not changed.
// cache: the scored copy of each step state (sequences that share their first steps share it).
export function scoredStates(g, steps, states, kind = "normal", target = null, cache = null) {
  const p = g.turn, structs = g.structures(g.state), own = new Set(g.players[p].colors);
  const breaks = kind === "break" || steps.some(s => s.captures.some(c => {
    const x = structs.get(c.abs);
    return x && !own.has(x[1]) && !c.gate_right && c.victim[0] === "p";
  }));
  return states.map((st, k) => {
    if (breaks && k < states.length - 1) return st;
    if (cache && !breaks && cache.has(st)) return cache.get(st);
    const part = { steps: steps.slice(0, k + 1), state: st.copy(), kind, target };
    g._applyScoreCore(p, part);
    if (cache && !breaks) cache.set(st, part.state);
    return part.state;
  });
}

// the steps of a play, from state st, as the page animates them: [{ before, after, step }]
export function playEntries(g, play, st = g.state) {
  const structs = g.structures(st), steps = [], states = [];
  let cur = st;
  for (const s of play.steps) {
    const r = g.step(cur, g.turn, s.mover, s.die, structs, play.target);
    if (!r) break;
    steps.push(r[1]);
    states.push(r[0]);
    cur = r[0];
  }
  const scored = st === g.state ? scoredStates(g, steps, states, play.kind, play.target) : states;
  return steps.map((step, k) => ({ before: k ? scored[k - 1] : st, after: scored[k], step }));
}

// The game as the page reads it. full: also the options of a person's decision (with the
// sequences and the reasons a move or a tunnel is not allowed); else only what is drawn.
function gameData(g, enc, full) {
  const dec = g.pending;
  const human = dec && !g.over && !g.players[dec.player].isAi;
  let pending = null;
  if (dec) {
    pending = { kind: dec.kind, player: dec.player, dice: dec.dice.slice(), diceId: diceId(dec.dice), note: dec.note };
    if (full && human) {
      pending.options = enc.enc(dec.options);
      if (dec.kind === "play") {
        enc.ref(g.state, true);
        const cache = new Map();
        pending.seqs = g.sequences(dec).map(q => ({
          option: dec.options.indexOf(q.option), dieIdx: q.dieIdx,
          steps: q.steps.map(s => ({ ...enc.enc(s), desc: g.describe({ steps: [s] })[0] })),
          states: scoredStates(g, q.steps, q.states, q.option.payload.kind, q.option.payload.target, cache).map(s => enc.ref(s, true)),
        }));
      }
      if (dec.kind === "pre_roll") pending.tblock = g.tunnelBlockers(dec.player);
    }
  }
  return {
    state: enc.ref(g.state), turn: g.turn, turnNo: g.turnNo, over: g.over, places: g.places.slice(),
    cards: g.cards.slice(), lastDice: g.lastDice.slice(), lastDiceId: diceId(g.lastDice), noMove: g.noMove ? enc.enc(g.noMove) : null,
    stuck: g.players.map((_, p) => g.stuck(p)),
    complete: Array.from({ length: g.cfg.n_colors }, (_, c) => g.colorComplete(g.state, c)),
    pending,
  };
}

// the whole game for a device that comes in: the setup's words, the config, the log and the view
export function gameView(g) {
  const enc = new Encoder(g);
  const data = gameData(g, enc, true);
  return { cfg: cfgView(g.cfg), mode: g.mode, players: g.players.map(p => ({ name: p.name, colors: p.colors.slice(), isAi: !!p.isAi })),
    owner: g.owner.slice(), log: g.log.slice(), ...data, states: enc.states };
}

// Collects one frame per event while a table applies them (Table.observer).
export class FrameRecorder {
  constructor() { this.frames = []; this.pre = null; }

  before(g, ev, opt, dec) {
    g.noMove = null;                 // only the throw with no move of this event is shown burnt (main.js did this before)
    const enc = new Encoder(g);
    const o = ev.pick !== undefined ? enc.enc(opt) : null;
    const e = dec.kind === "play" && opt.payload && opt.payload.steps ? enc.enc(playEntries(g, opt.payload)) : null;
    this.pre = { enc, o, e, logFrom: g.log.length };
  }

  after(g) {
    const { enc, o, e, logFrom } = this.pre || { enc: new Encoder(g), o: null, e: null, logFrom: g.log.length };
    this.pre = null;
    enc.seen.delete(g.state);        // the engine may have changed the state in place: write it again
    this.frames.push({ g, enc, o, e, log: g.log.slice(logFrom), view: gameData(g, enc, false) });
  }

  // the frames as sent; the last one also carries the options of a person's decision
  finish() {
    return this.frames.map((f, k) => {
      const view = k === this.frames.length - 1 ? gameData(f.g, f.enc, true) : f.view;
      return { o: f.o, e: f.e, log: f.log, view, states: f.enc.states };
    });
  }
}
