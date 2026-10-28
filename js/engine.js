// Rules engine for the multi-color Mensch game.
//
// The engine is a state machine. `game.pending` always holds the decision the
// current player must make; `game.choose(option)` applies it and advances until
// the next decision. Dice come from the engine's own RNG, or — in manual (debug)
// mode — from a "dice" decision the player answers.
//
// Positions are stored relative to each color's gate:
//   -1          yard (H)
//   0 .. L-1    track, 0 = gate, L-1 = threshold
//   L .. L+3    home Z1..Z4
//   -2          inside a tunnel (the tunnel record in state.tunnels says where)
//
// Rules sections: §3 basic moves · §4 two-color dice · §5 bonuses · §6 stuck help
// §7 single-color · §8 triple-dice card · §9 hunter · §10 wall & castle
// §11 points & ranks · §13 tunnels

import { Config } from "./config.js";
import { M } from "./i18n.js";

export const YARD = -1;
export const TUN = -2;

export function Player(name, colors, isAi = false) {
  return { name, colors, isAi };
}

export class Decision {
  constructor(kind, player, options, dice = [], note = "") {
    this.kind = kind;       // pre_roll | keep | play | dice
    this.player = player;
    this.options = options; // list of Option
    this.dice = dice;
    this.note = note;
  }
}

export class Option {
  constructor(label, payload) {
    this.label = label;
    this.payload = payload;
  }
}

// ---------------------------------------------------------------- random numbers
export function mulberry32(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- state
export class State {
  constructor(pos, kills, hunters, scores, tunnels = null, tmark = null, hit = null, earned = null, hits = null) {
    this.pos = pos;           // pos[color][i] -> rel
    this.kills = kills;       // kills[color][i]
    this.hunters = hunters;   // hunters[player] -> null | [color, abs, dir, kills]
    this.scores = scores;     // scores[player]
    // §13 active tunnels: [player, color, piece, from_corridor, to_corridor, t]
    // t is null while declared (piece still on the track), else 1..T inside
    this.tunnels = tunnels || [];
    // tmark[color][i]: the piece has used a tunnel (debt rule at the threshold)
    this.tmark = tmark || pos.map(x => x.map(() => false));
    // hit[color][i]: the piece has been captured at least once (no clean-piece bonus)
    this.hit = hit || pos.map(x => x.map(() => false));
    // for the "scores" view only (no rule reads them): points each piece has won and
    // how many pieces it has captured, over the whole game (not reset when it is captured)
    this.earned = earned || pos.map(x => x.map(() => 0));
    this.hits = hits || pos.map(x => x.map(() => 0));
  }

  copy() {
    return new State(this.pos.map(p => p.slice()), this.kills.map(k => k.slice()),
      this.hunters.map(h => (h ? h.slice() : null)), this.scores.slice(),
      this.tunnels.map(t => t.slice()), this.tmark.map(m => m.slice()), this.hit.map(m => m.slice()),
      this.earned.map(m => m.slice()), this.hits.map(m => m.slice()));
  }

  key() {
    return JSON.stringify([this.pos, this.hunters.map(h => (h ? h.slice(0, 3) : null)), this.tunnels]);
  }
}

export class Step {
  constructor(mover, die, src, dst, captures, entered, tun = false) {
    this.mover = mover; this.die = die; this.src = src; this.dst = dst;
    this.captures = captures;   // list of objects
    this.entered = entered;
    this.tun = tun;             // the step used a declared tunnel
  }
}

export class Play {
  constructor(steps, state, kind = "normal", target = null) {
    this.steps = steps;
    this.state = state;   // resulting state (before scoring)
    this.kind = kind;     // normal | break
    this.target = target; // struct id for breaks
  }
}

const mk = m => m.join(",");          // mover key
const sameMover = (a, b) => mk(a) === mk(b);
const mod = (a, n) => ((a % n) + n) % n;

function permutations(arr) {
  if (arr.length <= 1) return [arr.slice()];
  const out = [], seen = new Set();
  arr.forEach((x, i) => {
    for (const rest of permutations(arr.slice(0, i).concat(arr.slice(i + 1)))) {
      const p = [x, ...rest], k = p.join(",");
      if (!seen.has(k)) { seen.add(k); out.push(p); }
    }
  });
  return out;
}

function combinations2(n) {
  const out = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) out.push([i, j]);
  return out;
}

// ---------------------------------------------------------------- game
export class Game {
  constructor(players, mode = "two", config = null, seed = null, manual = false) {
    this.cfg = config || new Config();
    this.players = players;
    this.mode = mode;     // "two" (two-color) or "one" (single-color)
    this.rng = mulberry32(seed == null ? (Math.random() * 2 ** 32) >>> 0 : seed);
    const c = this.cfg;
    this.L = c.track_len;
    this.owner = new Array(c.n_colors).fill(null);
    players.forEach((p, pi) => p.colors.forEach(col => { this.owner[col] = pi; }));
    const per = () => new Array(c.pieces_per_color);
    this.state = new State(
      Array.from({ length: c.n_colors }, () => per().fill(YARD)),
      Array.from({ length: c.n_colors }, () => per().fill(0)),
      players.map(() => null), players.map(() => 0));
    this.cards = players.map(() => c.triple_dice_cards);
    this.noSix = players.map(() => 0);
    this.turn = 0;
    this.turnNo = 1;
    this.winner = null;     // first player to finish
    this.places = [];       // players in the order they finished (§11 final bonuses)
    this.over = false;      // the game goes on until only one player is left
    this.log = [];
    this.lastDice = [];
    this.bonus = [];
    this.pending = null;
    this._attempt = 0;
    this._three = null;
    this._throwKind = null;
    this.manual = manual;   // debug: the player sets the dice values
    this._diceCont = null;
    this._startTurn();
  }

  // ------------------------------------------------------------ geometry
  gate(color) { return color * this.cfg.corridor_len; }
  absOf(color, rel) { return mod(this.gate(color) + rel, this.L); }
  relOf(color, a) { return mod(a - this.gate(color), this.L); }

  fieldName(color, rel) {
    if (rel === YARD) return M("yard");
    if (rel === TUN) return M("tunnel_f");
    if (rel >= this.L) return M("home", { n: rel - this.L + 1 });
    return String(this.absOf(color, rel) + 1);
  }

  moverName(m, st = null) {
    if (m[0] === "p") return M("piece", { color: M("color", { i: m[1] }), n: m[2] + 1 });
    st = st || this.state;
    const h = st.hunters[m[1]];
    const col = h ? h[0] : this._completedColor(m[1], st);
    return M("hunter", { color: M("color", { i: col }) });
  }

  // ------------------------------------------------------------ queries
  occupancy(st) {
    const occ = new Map();
    for (let col = 0; col < this.cfg.n_colors; col++)
      st.pos[col].forEach((r, i) => { if (r >= 0 && r < this.L) occ.set(this.absOf(col, r), ["p", col, i]); });
    st.hunters.forEach((h, p) => { if (h) occ.set(h[1], ["h", p]); });
    return occ;
  }

  ownerOf(m) { return m[0] === "p" ? this.owner[m[1]] : m[1]; }

  finished(st, col, i) {
    const r = st.pos[col][i];
    if (r < this.L) return false;
    const have = new Set(st.pos[col].filter((x, j) => j !== i && x >= this.L));
    for (let d = r + 1; d <= this.cfg.last_rel; d++) if (!have.has(d)) return false;
    return true;
  }

  alive(st, col, i) {
    if (st.pos[col][i] === YARD) return false;
    return !this.finished(st, col, i);
  }

  colorComplete(st, col) {
    for (let i = 0; i < this.cfg.pieces_per_color; i++) if (!this.finished(st, col, i)) return false;
    return true;
  }

  colorHasAlive(st, col) {
    for (let i = 0; i < this.cfg.pieces_per_color; i++) if (this.alive(st, col, i)) return true;
    return false;
  }

  // §2: no alive piece in any color (the hunter does not count)
  stuck(p, st = null) {
    st = st || this.state;
    return !this.players[p].colors.some(c => this.colorHasAlive(st, c));
  }

  hasWon(p, st = null) {
    st = st || this.state;
    return this.players[p].colors.every(c => this.colorComplete(st, c));
  }

  _completedColor(p, st) {
    for (const c of this.players[p].colors) if (this.colorComplete(st, c)) return c;
    return null;
  }

  _otherColor(p, col) {
    const cs = this.players[p].colors;
    return cs[0] === col ? cs[1] : cs[0];
  }

  // §9: one color complete and the other still has a living piece
  hunterEligible(p, st) {
    if (this.mode !== "two" || st.hunters[p] !== null) return null;
    const cc = this._completedColor(p, st);
    if (cc === null) return null;
    if (!this.colorHasAlive(st, this._otherColor(p, cc))) return null;
    return cc;
  }

  // §10: runs of same-color pieces on consecutive track fields.
  // Returns Map abs -> [sid, color, cells] for runs of length >= 2.
  structures(st) {
    const out = new Map(), L = this.L;
    let sid = 0;
    for (let col = 0; col < this.cfg.n_colors; col++) {
      const cells = st.pos[col].filter(r => r >= 0 && r < L).map(r => this.absOf(col, r)).sort((a, b) => a - b);
      if (cells.length < 2) continue;
      const cs = new Set(cells), seen = new Set();
      for (const a of cells) {
        const prev = mod(a - 1, L);
        if ((seen.has(a) || (cs.has(prev) && cs.size < L)) && cs.has(prev)) continue;
        const run = [a];
        let b = mod(a + 1, L);
        while (cs.has(b) && b !== a) { run.push(b); b = mod(b + 1, L); }
        run.forEach(x => seen.add(x));
        if (run.length >= 2) {
          for (const x of run) out.set(x, [sid, col, run]);
          sid++;
        }
      }
    }
    return out;
  }

  // ------------------------------------------------------------ tunnels §13
  // Entrance rel, exit rel and tunnel length for a tunnel from corridor a to b.
  tunnelGeom(a, b) {
    const cl = this.cfg.corridor_len, mid = Math.floor(cl / 2) - 1;   // field 5 of a 10-field corridor
    return [(a - 1) * cl + mid, (b - 1) * cl + mid, Math.floor((b - a) * cl / 4)];
  }

  tunnelCost(a, b) { return this.cfg.tunnel_costs[b - a - 1]; }

  tunnelOf(st, col, i) {
    for (const t of st.tunnels) if (t[1] === col && t[2] === i) return t;
    return null;
  }

  // Progress of a piece; a piece inside a tunnel counts as just before the exit.
  effectiveRel(st, col, i) {
    const r = st.pos[col][i];
    if (r !== TUN) return r;
    const t = this.tunnelOf(st, col, i);
    const [, X, T] = this.tunnelGeom(t[3], t[4]);
    return X - (T + 1 - t[5]);
  }

  tunnelOptions(p, st = null) {
    st = st || this.state;
    const c = this.cfg;
    if (st.scores[p] < 0 || st.tunnels.filter(t => t[0] === p).length >= c.max_active_tunnels) return [];
    const busy = new Set(st.tunnels.map(t => `${t[1]},${t[3]},${t[4]}`));
    const out = [];
    for (const col of this.players[p].colors) {
      st.pos[col].forEach((r, i) => {
        if (!(r >= 0 && r < this.L) || this.tunnelOf(st, col, i)) return;
        for (const [a, b] of c.tunnels()) {
          const [E] = this.tunnelGeom(a, b);
          if (E - r >= 0 && E - r <= c.tunnel_declare_range && !busy.has(`${col},${a},${b}`)) out.push([col, i, a, b]);
        }
      });
    }
    return out;
  }

  _tunnelStep(st, p, m, die, tr, blocked, victimAt) {
    const col = m[1], i = m[2];
    const [, , , ta, tb, t] = tr;
    const [E, X, T] = this.tunnelGeom(ta, tb);
    const r = st.pos[col][i];
    const src = r === TUN ? M("tunnel_f") : this.fieldName(col, r);
    const captures = [];
    let victim = null, a = null, atEntrance = false, ns, k;
    if (t === null) {
      if (r + die < E) return null;                 // the die does not reach the entrance: burnt
      const cells = [];
      for (let x = r + 1; x < Math.min(r + die, E + 1); x++) if (x !== r + die) cells.push(this.absOf(col, x));
      if (blocked(cells)) return null;
      if (r + die === E) {                          // stops on the entrance field
        a = this.absOf(col, E);
        const [v, bad] = victimAt(a);
        if (bad) return null;
        victim = v;
        ns = st.copy();
        ns.pos[col][i] = E;
        k = null; atEntrance = true;
      } else {
        k = r + die - E;
      }
    } else {
      k = t + die;
    }
    if (!atEntrance) {
      ns = st.copy();
      const rec = this.tunnelOf(ns, col, i);
      if (k <= T) {
        ns.pos[col][i] = TUN;
        rec[5] = k;
      } else {                                      // leaves the tunnel
        const dstRel = X + k - T - 1;
        a = this.absOf(col, dstRel);
        const [v, bad] = victimAt(a);
        if (bad) return null;
        victim = v;
        ns.pos[col][i] = dstRel;
        ns.tunnels.splice(ns.tunnels.indexOf(rec), 1);
        ns.tmark[col][i] = true;
      }
    }
    const dst = this.fieldName(col, ns.pos[col][i]);
    if (victim !== null) this._capture(st, ns, victim, a, false, captures, !atEntrance);  // the exit hits even walls and castles
    return [ns, new Step(m, die, src, dst, captures, false, true)];
  }

  _capture(st, ns, victim, a, entered, captures, free = false) {
    if (victim[0] === "p") {
      const vc = victim[1], vi = victim[2];
      captures.push({ victim, color: vc, rel: st.pos[vc][vi], abs: a, vkills: st.kills[vc][vi],
                      gate_right: entered, free });
      ns.pos[vc][vi] = YARD;
      ns.kills[vc][vi] = 0;
      ns.tmark[vc][vi] = false;
      ns.hit[vc][vi] = true;
      ns.tunnels = ns.tunnels.filter(t => !(t[1] === vc && t[2] === vi));
    } else {
      const q = victim[1], hh = st.hunters[q];
      captures.push({ victim, color: hh[0], rel: this.relOf(hh[0], hh[1]), abs: a, vkills: hh[3],
                      gate_right: entered, free });
      ns.hunters[q] = null;
    }
  }

  // ------------------------------------------------------------ movers
  movers(p, st) {
    const ms = [];
    for (const col of this.players[p].colors) {
      let yardAdded = false;
      st.pos[col].forEach((r, i) => {
        if (r === YARD) {
          if (!yardAdded) { ms.push(["p", col, i]); yardAdded = true; }
        } else if (!this.finished(st, col, i)) {
          ms.push(["p", col, i]);
        }
      });
    }
    if (st.hunters[p]) ms.push(["h", p]);
    else if (this.hunterEligible(p, st) !== null) { ms.push(["hn", p, 1]); ms.push(["hn", p, -1]); }
    return ms;
  }

  // ------------------------------------------------------------ one step
  // Apply one die to one mover. Returns [newState, Step] or null.
  step(st, p, m, die, structs, target = null) {
    const L = this.L;
    const occ = this.occupancy(st);
    const own = new Set(this.players[p].colors);

    const blocked = cells => {
      for (const a of cells) {
        const s = structs.get(a);
        if (s && s[2].length >= 3 && !own.has(s[1]) && s[0] !== target) return true;
      }
      return false;
    };
    const victimAt = a => {
      const v = occ.get(a);
      if (v === undefined) return [null, false];
      if (this.ownerOf(v) === p) return [null, true];   // own piece: cannot land
      return [v, false];
    };

    let ns, victim, entered, src, dst, a;
    if (m[0] === "p") {
      const col = m[1], i = m[2];
      const r = st.pos[col][i];
      const tr = r !== YARD ? this.tunnelOf(st, col, i) : null;
      if (tr !== null) return this._tunnelStep(st, p, m, die, tr, blocked, victimAt);
      let dstRel, cells;
      if (r === YARD) {
        if (die !== 6) return null;
        dstRel = 0; a = this.gate(col); entered = true; cells = [];
      } else {
        dstRel = r + die;
        if (dstRel >= L && r < L && st.tmark[col][i] && st.scores[this.owner[col]] < 0) {
          // §13 debt: a tunnel piece of an indebted player laps again
          cells = [];
          for (let x = r + 1; x < dstRel; x++) cells.push(this.absOf(col, x));
          dstRel -= L;
          a = this.absOf(col, dstRel);
          if (blocked(cells)) return null;
          const [v, bad] = victimAt(a);
          if (bad) return null;
          ns = st.copy();
          ns.pos[col][i] = dstRel;
          const captures = [];
          if (v !== null) this._capture(st, ns, v, a, false, captures);
          return [ns, new Step(m, die, this.fieldName(col, r), this.fieldName(col, dstRel), captures, false)];
        }
        if (dstRel > this.cfg.last_rel) return null;
        cells = [];
        for (let x = r + 1; x < Math.min(dstRel, L); x++) cells.push(this.absOf(col, x));
        entered = false;
        a = dstRel < L ? this.absOf(col, dstRel) : null;
      }
      if (blocked(cells)) return null;
      if (dstRel >= L) {
        if (st.pos[col].some((x, j) => j !== i && x === dstRel)) return null;
        victim = null;
      } else {
        const [v, bad] = victimAt(a);
        if (bad) return null;
        victim = v;
      }
      ns = st.copy();
      ns.pos[col][i] = dstRel;
      src = this.fieldName(col, r);
      dst = this.fieldName(col, dstRel);
    } else if (m[0] === "h") {
      const h = st.hunters[p];
      a = mod(h[1] + h[2] * die, L);
      const cells = [];
      for (let k = 1; k < die; k++) cells.push(mod(h[1] + h[2] * k, L));
      if (blocked(cells)) return null;
      const [v, bad] = victimAt(a);
      if (bad) return null;
      victim = v;
      ns = st.copy();
      ns.hunters[p][1] = a;
      entered = false;
      src = String(h[1] + 1); dst = String(a + 1);
    } else {                 // hunter enters
      if (die !== 6) return null;
      const cc = this._completedColor(p, st);
      a = this.gate(cc);
      const [v, bad] = victimAt(a);
      if (bad) return null;
      victim = v;
      ns = st.copy();
      ns.hunters[p] = [cc, a, m[2], 0];
      entered = true;
      src = "H"; dst = String(a + 1);
    }
    const captures = [];
    if (victim !== null) this._capture(st, ns, victim, a, entered, captures);
    return [ns, new Step(m, die, src, dst, captures, entered)];
  }

  // ------------------------------------------------------------ sequences
  _valid(p, steps, structs, breakRoll = false, target = null, st0 = null) {
    const own = new Set(this.players[p].colors);
    const prot = new Map();
    for (const s of steps) {
      for (const c of s.captures) {
        const st_ = structs.get(c.abs);
        if (c.victim[0] !== "p" || st_ === undefined || own.has(st_[1])) continue;
        if (c.gate_right || c.free) continue;        // §10 gate right, §13 tunnel exit
        if (!prot.has(st_[0])) prot.set(st_[0], []);
        prot.get(st_[0]).push([s.mover, c.abs, st_]);
      }
    }
    for (const [sid, lst] of prot) {
      const cells = lst[0][2][2];
      const movers = lst.map(x => mk(x[0]));
      if (new Set(movers).size !== movers.length) return false;   // one piece cannot break
      if (lst.some(x => x[0][0] !== "p") && !this.cfg.hunter_can_break) return false;
      if (cells.length === 2) {
        if (breakRoll || lst.length !== 2) return false;
      } else if (!breakRoll || sid !== target || lst.length !== 3) {
        return false;
      }
    }
    if (breakRoll && !prot.has(target)) return false;
    // §13 no sum move through a tunnel
    for (const s of steps) {
      if (s.tun && steps.filter(x => sameMover(x.mover, s.mover)).length > 1) return false;
    }
    // §4.5 six first: when a piece of that color stands on its own gate at the start of the
    // play and the throw has a 6, the 6 is played first (no clearing the gate with the other
    // die to bring a new piece in with the 6).
    if (steps.length === 2 && !breakRoll && st0) {
      const [a, b] = steps;
      if (a.mover[0] === "p" && b.mover[0] === "p" && a.mover[1] === b.mover[1]
          && !sameMover(a.mover, b.mover) && a.die !== b.die && b.die === 6
          && st0.pos[a.mover[1]].includes(0)) return false;
    }
    return true;
  }

  // All step sequences using every die in `dice` (in any order).
  _gen(p, st, dice, structs, breakRoll = false, target = null) {
    const out = [];
    const rec = (cur, remaining, steps, used) => {
      if (!remaining.length) { out.push([steps, cur]); return; }
      const d = remaining[0];
      for (const m of this.movers(p, cur)) {
        if (breakRoll && used.has(mk(m))) continue;
        if (m[0] === "hn" && cur.hunters[p] !== null) continue;
        const r = this.step(cur, p, m, d, structs, target);
        if (r === null) continue;
        const [ns, s] = r;
        const mm = m[0] === "hn" ? ["h", p] : m;
        const u2 = new Set(used); u2.add(mk(mm));
        rec(ns, remaining.slice(1), steps.concat([s]), u2);
      }
    };
    const orders = permutations(dice).sort((x, y) => {          // fixed order, so equal moves are always described the same way
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
      return 0;
    });
    for (const order of orders) rec(st, order, [], new Set());
    return out;
  }

  _playsFrom(p, seqs, structs, kind = "normal", breakRoll = false, target = null, st0 = null) {
    const plays = [], seen = new Set();
    for (const [steps, ns] of seqs) {
      if (!this._valid(p, steps, structs, breakRoll, target, st0)) continue;
      const k = ns.key();
      if (seen.has(k)) continue;
      seen.add(k);
      plays.push(new Play(steps, ns, kind, target));
    }
    return plays;
  }

  // §4 (two dice) or a single die. Returns a list of Play.
  playsFor(p, dice, st = null) {
    st = st || this.state;
    const structs = this.structures(st);
    if (dice.length === 1) return this._playsFrom(p, this._gen(p, st, dice, structs), structs, "normal", false, null, st);
    const p1 = this._playsFrom(p, this._gen(p, st, [dice[0]], structs).concat(this._gen(p, st, [dice[1]], structs)), structs, "normal", false, null, st);
    const p2 = this._playsFrom(p, this._gen(p, st, dice, structs), structs, "normal", false, null, st);
    const colors = this.players[p].colors;
    const has = new Map(colors.map(c => [c, false]));
    for (const pl of p1.concat(p2)) {
      for (const s of pl.steps) {
        const ac = this._agent(s.mover, st);
        if (has.has(ac)) has.set(ac, true);
      }
    }
    if (this.mode !== "two" || [...has.values()].every(Boolean)) return p2.length ? p2 : p1;  // §4.3 both dice
    const live = colors.filter(c => has.get(c));
    if (!live.length) return [];
    const c = live[0];                                        // §4.2 only one die for that color
    return p1.filter(pl => pl.steps.every(s => this._agent(s.mover, st) === c));
  }

  // Color a mover plays for; the hunter plays for its completed color.
  _agent(m, st) {
    if (m[0] === "p") return m[1];
    const h = st.hunters[m[1]];
    return h ? h[0] : this._completedColor(m[1], st);
  }

  // §10 castle-break declaration with three dice
  breakPlays(p, dice, st = null) {
    st = st || this.state;
    const structs = this.structures(st);
    const own = new Set(this.players[p].colors);
    const targets = new Set();
    for (const s of structs.values()) if (s[2].length >= 3 && !own.has(s[1])) targets.add(s[0]);
    let plays = [];
    for (const t of targets) {
      const seqs = this._gen(p, st, dice, structs, true, t);
      plays = plays.concat(this._playsFrom(p, seqs, structs, "break", true, t, st));
    }
    return plays;
  }

  opponentCastles(p, st = null) {
    st = st || this.state;
    const own = new Set(this.players[p].colors);
    const out = new Map();
    for (const s of this.structures(st).values()) if (s[2].length >= 3 && !own.has(s[1])) out.set(s[0], s);
    return out;
  }

  // Every way to play the current "play" decision step by step, for the click-by-click
  // interface: [{steps, states, option}], where states[k] is the board after steps[k].
  // Unlike the option list (one entry per resulting position), the same position can be
  // reached by several sequences here, e.g. die A first or die B first. Only sequences
  // the rules allow (six first, wall break, tunnels...) are listed.
  sequences(dec = this.pending) {
    if (!dec || dec.kind !== "play" || !dec.options.length) return [];
    const p = this.turn, st0 = this.state;
    const structs = this.structures(st0);
    const legal = new Map(dec.options.map(o => [o.payload.state.key(), o]));
    const first = dec.options[0].payload;
    const isBreak = first.kind === "break";
    const nd = first.steps.length;
    const targets = isBreak ? [...new Set(dec.options.map(o => o.payload.target))] : [null];
    const out = [];
    for (const target of targets) {
      const rec = (cur, used, steps, states, movers) => {
        if (steps.length === nd) {
          const o = legal.get(cur.key());
          if (o && this._valid(p, steps, structs, isBreak, target, st0)) out.push({ steps, states, option: o, dieIdx: used });
          return;
        }
        dec.dice.forEach((d, di) => {
          if (used.includes(di)) return;
          for (const m of this.movers(p, cur)) {
            if (isBreak && movers.has(mk(m))) continue;
            if (m[0] === "hn" && cur.hunters[p] !== null) continue;
            const r = this.step(cur, p, m, d, structs, target);
            if (r === null) continue;
            const mm = m[0] === "hn" ? ["h", p] : m;
            const mv = new Set(movers); mv.add(mk(mm));
            rec(r[0], used.concat([di]), steps.concat([r[1]]), states.concat([r[0]]), mv);
          }
        });
      };
      rec(st0, [], [], [], new Set());
    }
    return out;
  }

  // ------------------------------------------------------------ scoring §11
  piecePoints(color, rel) {
    const c = this.cfg;
    const idx = Math.min(Math.floor(rel / c.corridor_len), c.corridor_points.length - 1);
    let pts = c.corridor_points[idx];
    if (rel === 0) pts += c.gate_bonus;
    if (rel === this.L - 1) pts += c.threshold_bonus;
    return pts;
  }

  bounty(kills) {
    const c = this.cfg;
    if (kills >= c.marshal_at) return c.marshal_bounty;
    if (kills >= c.general_at) return c.general_bounty;
    return 0;
  }

  rankName(kills) {
    const c = this.cfg;
    if (kills >= c.marshal_at) return M("marshal");
    if (kills >= c.general_at) return M("general");
    return M("soldier");
  }

  // the "scores" view: points shared by the pieces that made a capture or a break
  _credit(st, movers, pts, captures) {
    const ps = movers.filter(m => m[0] === "p");
    ps.forEach((m, k) => {
      st.earned[m[1]][m[2]] += Math.floor(pts / ps.length) + (k < pts % ps.length ? 1 : 0);
      st.hits[m[1]][m[2]] += captures;
    });
  }

  _applyScore(p, play) {
    const st = play.state, msgs = [];
    let caps = [];
    for (const s of play.steps) for (const c of s.captures) caps.push([s, c]);
    if (!caps.length) return msgs;
    if (play.kind === "break") {
      let best = 0;
      const pen = [];
      for (const [, c] of caps) {
        const b = this.bounty(c.vkills);
        best = Math.max(best, this.piecePoints(c.color, c.rel) + b);
        if (b) pen.push([this.ownerOf(c.victim), b]);
      }
      const n = caps.length;
      const bonus = n >= 3 ? this.cfg.castle_break : this.cfg.wall_break;
      st.scores[p] += best + bonus;
      this._credit(st, caps.map(([s]) => s.mover), best + bonus, 1);
      for (const [q, b] of pen) st.scores[q] -= b;
      msgs.push(M("log_score_break", { what: M(n >= 3 ? "castle" : "wall"), pts: best + bonus }));
      return msgs;
    }
    // wall break inside a normal roll
    const structs = this.structures(this.state);
    const own = new Set(this.players[p].colors);
    const wall = caps.map(x => x[1]).filter(c => structs.has(c.abs) && !own.has(structs.get(c.abs)[1])
      && !c.gate_right && !c.free && c.victim[0] === "p");
    if (wall.length === 2) {
      const best = Math.max(...wall.map(c => this.piecePoints(c.color, c.rel) + this.bounty(c.vkills)));
      st.scores[p] += best + this.cfg.wall_break;
      this._credit(st, caps.filter(([, c]) => wall.includes(c)).map(([s]) => s.mover), best + this.cfg.wall_break, 1);
      for (const c of wall) {
        const b = this.bounty(c.vkills);
        if (b) st.scores[this.ownerOf(c.victim)] -= b;
      }
      msgs.push(M("log_score_break", { what: M("wall"), pts: best + this.cfg.wall_break }));
      caps = caps.filter(([, c]) => !wall.includes(c));
    }
    for (const [s, c] of caps) {
      const m = s.mover;
      let k;
      if (m[0] === "p") {
        st.kills[m[1]][m[2]] += 1;
        k = st.kills[m[1]][m[2]];
      } else {
        const h = st.hunters[p];
        if (h) { h[3] += 1; k = h[3]; } else k = 1;
      }
      let mult = 1;
      if (k > this.cfg.marshal_at) mult = this.cfg.marshal_mult;
      else if (k > this.cfg.general_at) mult = this.cfg.general_mult;
      const base = this.piecePoints(c.color, c.rel) * mult;
      const b = this.bounty(c.vkills);
      st.scores[p] += base + b;
      this._credit(st, [m], base + b, 1);
      if (b) st.scores[this.ownerOf(c.victim)] -= b;
      const extra = b ? M("log_bounty", { b, rank: this.rankName(c.vkills) }) : "";
      msgs.push(M("log_score_hit", { v: this.moverName(c.victim, this.state), pts: base, extra }));
      if ((k === this.cfg.general_at || k === this.cfg.marshal_at) && m[0] === "p")
        msgs.push(M("log_rank_up", { piece: this.moverName(m), rank: this.rankName(k) }));
    }
    return msgs;
  }

  // §9: the hunter leaves when its second color has no living piece
  _cleanupHunters(st) {
    st.hunters.forEach((h, q) => {
      if (h && !this.colorHasAlive(st, this._otherColor(q, h[0]))) {
        st.hunters[q] = null;
        this.log.push(M("log_hunter_gone", { p: this.players[q].name }));
      }
    });
  }

  // ------------------------------------------------------------ describing
  describe(play) {
    if (!play.steps.length) return M("pass");
    return play.steps.map(s => {
      const nm = s.mover[0] !== "hn" ? this.moverName(s.mover)
        : M(s.mover[2] === 1 ? "hunter_fwd" : "hunter_back");
      return M("step", { name: nm, src: s.src, dst: s.dst, die: s.die, cap: s.captures.length ? M("cap") : "" });
    });
  }

  // ------------------------------------------------------------ turn flow
  roll(n) { return Array.from({ length: n }, () => 1 + Math.floor(this.rng() * 6)); }

  // Roll n dice and continue with them; in manual (debug) mode ask for the values.
  _withDice(n, cont) {
    if (!this.manual) { cont(this.roll(n)); return; }
    this._diceCont = cont;
    this.pending = new Decision("dice", this.turn, [], new Array(n).fill(1), M("note_dice", { n }));
  }

  _startTurn() {
    const p = this.turn;
    this.bonus = [];
    this._attempt = 0;
    if (this.mode === "two" && this.stuck(p)) { this._stuckThrow(); return; }
    this._preRoll();
  }

  _preRoll() {
    const p = this.turn;
    const opts = [new Option(M("roll"), "roll")];
    if (this.mode === "two") {
      if (this.cards[p] > 0) opts.push(new Option(M("card", { n: this.cards[p] }), "triple"));
      if (this.opponentCastles(p).size) opts.push(new Option(M("break_decl"), "break"));
    }
    for (const [col, i, a, b] of this.tunnelOptions(p)) {
      const [, , T] = this.tunnelGeom(a, b);
      opts.push(new Option(M("tunnel_decl", { piece: this.moverName(["p", col, i]), a, b, n: T,
        cost: this.tunnelCost(a, b) }), ["tunnel", col, i, a, b]));
    }
    if (opts.length === 1) this._throw();
    else this.pending = new Decision("pre_roll", p, opts);
  }

  _throw() {
    if (this.mode === "one") this._throwSingleMode();
    else this._normalThrow();
  }

  // §6 gift-six counter, only while the player is stuck
  _countSix(p, dice) {
    if (!this.stuck(p)) return false;
    if (dice.includes(6)) { this.noSix[p] = 0; return false; }
    this.noSix[p] += 1;
    return this.noSix[p] >= this.cfg.gift_six_n;
  }

  _normalThrow() { this._withDice(2, d => this._normalThrowWith(d)); }

  _normalThrowWith(dice) {
    const p = this.turn;
    this.lastDice = dice;
    this.log.push(M("log_roll2", { p: this.players[p].name, a: dice[0], b: dice[1] }));
    this._throwKind = ["double", dice];
    this._offerPlays(dice);
  }

  _stuckThrow() { this._withDice(3, d => this._stuckThrowWith(d)); }

  _stuckThrowWith(dice) {
    const p = this.turn;
    this._attempt += 1;
    this.lastDice = dice;
    this._three = dice;
    this.log.push(M("log_stuck", { p: this.players[p].name, t: this._attempt, a: dice[0], b: dice[1], c: dice[2] }));
    const hit = this._countSix(p, dice);
    if (hit && this._attempt >= 2) { this._gift(); return; }
    let opts = this._keepOptions(dice);
    if (this._attempt === 1) opts.push(new Option(M("retry"), "retry"));
    if (hit) opts = [new Option(M("retry"), "retry"), new Option(M("take_gift"), "gift")];
    this.pending = new Decision("keep", p, opts, dice, M("note_keep"));
  }

  _keepOptions(dice) {
    const opts = [], seen = new Set();
    for (const [i, j] of combinations2(3)) {
      const pair = [dice[i], dice[j]].sort((x, y) => x - y);
      const k = pair.join(",");
      if (seen.has(k)) continue;
      seen.add(k);
      opts.push(new Option(M("keep", { a: pair[0], b: pair[1] }), ["keep", pair]));
    }
    return opts;
  }

  _gift() {
    const p = this.turn;
    this.noSix[p] = 0;
    this.log.push(M("log_gift", { p: this.players[p].name }));
    const plays = this.playsFor(p, [6]).filter(pl => pl.steps.every(s => s.entered));
    this.bonus = [];
    this._throwKind = ["gift", [6]];
    if (!plays.length) { this._endTurn(); return; }
    this.pending = new Decision("play", p, plays.map(pl => new Option(this.describe(pl), pl)), [6], M("note_gift"));
  }

  _offerPlays(dice, plays = null) {
    const p = this.turn;
    if (plays === null) plays = this.playsFor(p, dice);
    if (!plays.length) {
      this.log.push(M("log_nomove"));
      this._afterPlay();
      return;
    }
    this.pending = new Decision("play", p, plays.map(pl => new Option(this.describe(pl), pl)), dice);
  }

  _throwSingleMode() { this._withDice(1, d => this._throwSingleModeWith(d)); }

  _throwSingleModeWith(d) {
    const p = this.turn;
    this.lastDice = d;
    this.log.push(M("log_roll1", { p: this.players[p].name, a: d[0] }));
    this._throwKind = ["single_mode", d];
    if (this._countSix(p, d)) { this._gift(); return; }
    this._offerPlays(d);
  }

  // Apply the current player's choice.
  choose(option) {
    const dec = this.pending;
    this.pending = null;
    const p = this.turn;
    const pl = option.payload;
    if (dec.kind === "dice") {
      const cont = this._diceCont;
      this._diceCont = null;
      cont(pl[1].map(v => Math.max(1, Math.min(6, v | 0))));
      return;
    }
    if (dec.kind === "pre_roll") {
      if (Array.isArray(pl) && pl[0] === "tunnel") {
        const [, col, i, a, b] = pl;
        const cost = this.tunnelCost(a, b);
        this.state.scores[p] -= cost;
        this.state.tunnels.push([p, col, i, a, b, null]);
        this.log.push(M("log_tunnel", { piece: this.moverName(["p", col, i]), a, b, cost }));
        this._preRoll();
        return;
      }
      if (pl === "roll") this._throw();
      else if (pl === "triple") {
        this.cards[p] -= 1;
        this._withDice(3, d => this._cardWith(d));
      } else if (pl === "break") {
        this._withDice(3, d => this._breakWith(d));
      }
      return;
    }
    if (dec.kind === "keep") {
      if (pl === "retry") { this._stuckThrow(); return; }
      if (pl === "gift") { this._gift(); return; }
      const pair = pl[1].slice();
      const kind = this._throwKind && this._throwKind[0] === "card" ? "card" : "kept";
      this._throwKind = [kind, pair, this._three];
      this.lastDice = pair;
      this._offerPlays(pair);
      return;
    }
    if (dec.kind === "play") {
      this._applyPlay(pl);
      if (this._throwKind && this._throwKind[0] === "gift") { this._endTurn(); return; }
      this._afterPlay();
    }
  }

  _cardWith(dice) {
    const p = this.turn;
    this.lastDice = dice;
    this._three = dice;
    this._attempt = 2;     // no retry with a card
    this.log.push(M("log_card", { p: this.players[p].name, a: dice[0], b: dice[1], c: dice[2] }));
    this._throwKind = ["card", dice];
    this.pending = new Decision("keep", p, this._keepOptions(dice), dice, M("note_keep"));
  }

  _breakWith(dice) {
    const p = this.turn;
    this.lastDice = dice;
    this.log.push(M("log_break", { p: this.players[p].name, a: dice[0], b: dice[1], c: dice[2] }));
    this._throwKind = ["break", dice];
    const plays = this.breakPlays(p, dice);
    if (!plays.length) {
      this.log.push(M("log_break_fail"));
      this._afterPlay();
    } else {
      this.pending = new Decision("play", p, plays.map(x => new Option(this.describe(x), x)), dice, M("note_break"));
    }
  }

  _applyPlay(play) {
    const p = this.turn, before = this.state;
    const msgs = this._applyScore(p, play);
    this.state = play.state;
    this._cleanupHunters(this.state);
    this.log.push(M("log_play", { play: this.describe(play) }));
    for (const m of msgs) this.log.push(m);
    this._finalBonuses(p, before);
  }

  // §11 end bonuses: a clean piece reaches the nest, a color is complete, a player finishes.
  // Points spent on tunnels stay spent: the final score is what is left.
  _finalBonuses(p, before) {
    const st = this.state, c = this.cfg, L = this.L;
    for (const col of this.players[p].colors) {
      st.pos[col].forEach((r, i) => {
        if (r >= L && before.pos[col][i] < L && !st.hit[col][i] && c.clean_piece_bonus) {
          st.scores[p] += c.clean_piece_bonus;
          this.log.push(M("log_bonus_clean", { piece: this.moverName(["p", col, i]), pts: c.clean_piece_bonus }));
        }
      });
      if (!this.colorComplete(before, col) && this.colorComplete(st, col) && c.color_bonus) {
        st.scores[p] += c.color_bonus;
        this.log.push(M("log_bonus_color", { color: M("color", { i: col }), pts: c.color_bonus }));
      }
    }
    if (!this.hasWon(p) || this.places.includes(p)) return;
    const pts = c.finish_bonus[this.places.length] || 0;
    this.places.push(p);
    st.scores[p] += pts;
    if (this.winner === null) this.winner = p;
    this.log.push(M("log_finish", { p: this.players[p].name, n: this.places.length, pts }));
    const left = this.players.map((_, i) => i).filter(i => !this.places.includes(i));
    if (left.length <= 1) {
      this.places.push(...left);
      this.over = true;
      this.log.push(M("log_game_over"));
    }
  }

  // §5 bonuses, then the next queued throw or the next player
  _afterPlay() {
    if (this.over) { this.pending = null; return; }
    if (this.places.includes(this.turn)) { this._endTurn(); return; }   // finished: no bonus throws
    const tk = this._throwKind || ["none", []];
    const [kind, dice] = tk;
    const same = arr => arr.every(v => v === arr[0]);
    if (["double", "kept", "card", "bonus2"].includes(kind)) {
      if (dice.length === 2 && dice[0] === dice[1]) this.bonus.push(dice[0] === 6 ? "double" : ["single", dice[0]]);
      if ((kind === "kept" || kind === "card") && tk.length > 2 && tk[2] && same(tk[2])) this.bonus.push("triple");
    } else if (kind === "break") {
      if (same(dice)) this.bonus.push("triple");
      else {
        for (const v of new Set(dice)) {
          if (dice.filter(x => x === v).length >= 2) this.bonus.push(v === 6 ? "double" : ["single", v]);
        }
      }
    } else if (kind === "bonus1") {
      // a single bonus die goes on with a 6 (from then on only 6 continues) or with the pair's number
      const v = tk[2], d = dice[0];
      if (d === 6) this.bonus.push(["single", 6]);
      else if (d === v) this.bonus.push(["single", v]);
    } else if (kind === "single_mode") {
      if (dice[0] === 6) this.bonus.push(["single", 6]);          // §7: a 6 always throws again
    }
    this._nextBonus();
  }

  _nextBonus() {
    if (!this.bonus.length) { this._endTurn(); return; }
    const b = this.bonus.pop();
    const n = b === "double" ? 2 : (b === "triple" ? 3 : 1);
    this._withDice(n, dice => this._bonusWith(b, dice));
  }

  _bonusWith(b, dice) {
    const p = this.turn;
    if (b === "double") {
      this.lastDice = dice;
      this.log.push(M("log_bonus2", { a: dice[0], b: dice[1] }));
      if (this.stuck(p) && this._countSix(p, dice)) { this._gift(); return; }
      this._throwKind = ["bonus2", dice];
      this._offerPlays(dice);
    } else if (b === "triple") {
      this.lastDice = dice;
      this._three = dice;
      this.log.push(M("log_bonus3", { a: dice[0], b: dice[1], c: dice[2] }));
      this._throwKind = ["card", dice];
      this.pending = new Decision("keep", p, this._keepOptions(dice), dice, M("note_keep"));
    } else {
      const v = b[1], d = dice;
      this.lastDice = d;
      this.log.push(M("log_bonus1", { a: d[0] }));
      if (this._countSix(p, d)) { this._gift(); return; }
      this._throwKind = ["bonus1", d, v];
      this._offerPlays(d);
    }
  }

  _endTurn() {
    if (this.over) { this.pending = null; return; }
    do {                                  // players who have finished are skipped
      this.turn = (this.turn + 1) % this.players.length;
      if (this.turn === 0) this.turnNo += 1;
    } while (this.places.includes(this.turn));
    this._startTurn();
  }
}
