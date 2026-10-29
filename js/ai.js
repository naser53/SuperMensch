// A simple heuristic computer player.
import { TUN, YARD, mulberry32 } from "./engine.js";

// Weights of the position value beyond plain progress (see evaluate):
// reach = per opponent pawn one of ours can hit next turn (half for 7..12 fields ahead),
// colors = per own color with a pawn in play (two colors in play split the dice and reach more),
// capture = scale of the immediate capture bonus,
// points = per rank point a pawn in play carries (so a soldier in the nest swaps back in, §11).
// Cards: the bar for a triple-dice card drops by 1 for every cardPace rounds without one, and by
// cardBlocked while one of the player's pawns is stuck behind an opponent's castle.
export const AI_WEIGHTS = { reach: 2.5, colors: 8, capture: 1, points: 0.8, cardPace: 0, cardBlocked: 5 };

export class SimpleAI {
  // cardZ: a triple-dice card is played only for a throw that gains this many standard
  // deviations more than this player's usual throw (less as the player's pieces get home)
  constructor(seed = null, cardZ = 2.4, breakRate = 0.5, tunnelReserve = 40, weights = AI_WEIGHTS) {
    this.rng = mulberry32(seed == null ? (Math.random() * 2 ** 32) >>> 0 : seed);
    this.w = weights;
    this.cardZ = cardZ;
    this.gains = { n: 0, sum: 0, sq: 0 };
    this.lastCard = 0;            // round of the last card (or of the start)
    this.breakRate = breakRate;
    this.tunnelReserve = tunnelReserve;
  }

  // value of a position for player p (higher is better)
  evaluate(g, st, p) {
    const L = g.L;
    let v = 0;
    const occ = g.occupancy(st), reach = new Map();
    for (const col of g.players[p].colors) {
      if (st.pos[col].some((r, i) => r !== YARD && !g.finished(st, col, i))) v += this.w.colors;
      st.pos[col].forEach((r, i) => {
        if (r === YARD) return;
        // opponents this pawn can hit next turn: 1..6 ahead with one die, 7..12 with the sum
        if (r >= 0 && r < L && this.w.reach)
          for (let k = 1; k <= 12 && r + k < L; k++) {
            const a = g.absOf(col, r + k), m = occ.get(a);
            if (m && g.ownerOf(m) !== p) reach.set(a, Math.max(reach.get(a) || 0, k <= 6 ? 1 : 0.5));
          }
        if (r === TUN) { v += 10 + g.effectiveRel(st, col, i) + 2; return; }   // safe inside a tunnel
        v += 10 + r;
        if (r < L && this.w.points) v += this.w.points * st.kills[col][i];
        if (r >= L) {
          v += 25;
          if (g.finished(st, col, i)) v += 15;
          return;
        }
        // danger: opponents 1..6 fields behind
        const a = g.absOf(col, r);
        for (let k = 1; k <= 6; k++) {
          const m = occ.get(((a - k) % L + L) % L);
          if (m && g.ownerOf(m) !== p) v -= 0.25 * r / 6 + 1.5;
        }
      });
    }
    for (const x of reach.values()) v += this.w.reach * x;
    if (st.hunters[p]) v += 20;
    v += 1.2 * st.scores[p];
    for (let q = 0; q < g.players.length; q++) {
      if (q === p) continue;
      v -= 0.4 * st.scores[q];
      for (const col of g.players[q].colors)
        st.pos[col].forEach((r, i) => { if (r !== YARD) v -= 0.3 * (10 + g.effectiveRel(st, col, i)); });
    }
    return v;
  }

  // value of a play without the random tie-break
  playValue(g, play, p) {
    let bonus = 0;
    for (const s of play.steps)
      for (const c of s.captures) bonus += 6 + g.piecePoints(c.color, c.rel) + g.bounty(c.vkills);
    return this.evaluate(g, play.state, p) + this.w.capture * bonus;
  }

  scorePlay(g, play, p) { return this.playValue(g, play, p) + this.rng() * 0.5; }

  // How much better this throw is expected to be with three dice (keep the best two) than with
  // two: the same best-play values, averaged over every throw.
  cardGain(g, p) {
    const six = g.cfg.six_chance ?? 1 / 6, P = v => (v === 6 ? six : (1 - six) / 5);
    const here = this.evaluate(g, g.state, p), memo = new Map();
    const V = (a, b) => {
      const k = Math.min(a, b) * 7 + Math.max(a, b);
      if (!memo.has(k)) {
        const plays = g.playsFor(p, [a, b]);
        memo.set(k, plays.length ? Math.max(...plays.map(pl => this.playValue(g, pl, p))) : here);
      }
      return memo.get(k);
    };
    let e2 = 0, e3 = 0;
    for (let a = 1; a <= 6; a++)
      for (let b = 1; b <= 6; b++) {
        e2 += P(a) * P(b) * V(a, b);
        for (let c = 1; c <= 6; c++) e3 += P(a) * P(b) * P(c) * Math.max(V(a, b), V(a, c), V(b, c));
      }
    return e3 - e2;
  }

  choose(g) {
    const dec = g.pending, p = dec.player, opts = dec.options;
    if (dec.kind === "pre_roll") {
      const find = k => opts.find(o => o.payload === k);
      if (find("break") && this._breakHopeful(g, p) && this.rng() < this.breakRate) return find("break");
      if (find("triple") && this._cardNow(g, p)) { this.lastCard = g.turnNo; return find("triple"); }
      const t = this._tunnelPick(g, p, opts);
      if (t) return t;
      return find("roll");
    }
    if (dec.kind === "keep") {
      const pay = opts.filter(o => Array.isArray(o.payload));
      if (!pay.length) return opts.find(o => o.payload === "retry") || opts[0];
      if (g.stuck(p) && pay.every(o => !o.payload[1].includes(6))) {
        const r = opts.find(o => o.payload === "retry");
        if (r) return r;
      }
      let best = null, bv = null;
      for (const o of pay) {
        const plays = g.playsFor(p, o.payload[1].slice());
        const v = plays.length ? Math.max(...plays.map(pl => this.scorePlay(g, pl, p))) : this.evaluate(g, g.state, p);
        if (bv === null || v > bv) { best = o; bv = v; }
      }
      return best;
    }
    // play / gift
    let best = opts[0], bv = -Infinity;
    for (const o of opts) {
      const v = this.scorePlay(g, o.payload, p);
      if (v > bv) { best = o; bv = v; }
    }
    return best;
  }

  // Take the longest tunnel the player can pay for without going into debt.
  _tunnelPick(g, p, opts) {
    let best = null, gain = 0;
    const score = g.state.scores[p];
    for (const o of opts) {
      if (!(Array.isArray(o.payload) && o.payload[0] === "tunnel")) continue;
      const [, , , a, b] = o.payload;
      const cost = g.tunnelCost(a, b);
      const [E, X, T] = g.tunnelGeom(a, b);
      const saved = X - E - T - 1;
      if (cost <= score - this.tunnelReserve && saved > gain) { best = o; gain = saved; }
    }
    return best;
  }

  // Save the cards for the throws where three dice help most: compare this throw's gain with
  // the gains seen so far in this game (at least a few rounds of them).
  _cardNow(g, p) {
    const x = this.cardGain(g, p), s = this.gains;
    s.n += 1; s.sum += x; s.sq += x * x;
    if (s.n < 12) return false;
    const mean = s.sum / s.n, sd = Math.sqrt(Math.max(1e-6, s.sq / s.n - mean * mean));
    let home = 0, all = 0;
    for (const col of g.players[p].colors) g.state.pos[col].forEach(r => { all++; if (r >= g.L) home++; });
    const w = this.w, wait = w.cardPace ? Math.min(2, (g.turnNo - this.lastCard) / w.cardPace) : 0;
    const blocked = w.cardBlocked && this._behindCastle(g, p) ? w.cardBlocked : 0;
    return x > mean + sd * (this.cardZ + 0.35 * (g.cards[p] - 1) - 1.5 * home / all - wait - blocked);
  }

  // one of p's pawns on the track has an opponent's castle 1..6 fields ahead (it cannot pass)
  _behindCastle(g, p) {
    const castles = g.opponentCastles(p);
    if (!castles.size) return false;
    const cells = new Set();
    for (const [, [, , cs]] of castles) cs.forEach(a => cells.add(a));
    for (const col of g.players[p].colors)
      for (const r of g.state.pos[col])
        if (r >= 0 && r < g.L)
          for (let k = 1; k <= 6 && r + k < g.L; k++) if (cells.has(g.absOf(col, r + k))) return true;
    return false;
  }

  _breakHopeful(g, p) {
    const castles = g.opponentCastles(p);
    if (!castles.size) return false;
    const occ = g.occupancy(g.state);
    for (const [, [, , cells]] of castles) {
      const near = new Set();
      for (const a of cells)
        for (let k = 1; k <= 6; k++) {
          const m = occ.get(((a - k) % g.L + g.L) % g.L);
          if (m && g.ownerOf(m) === p && m[0] === "p") near.add(m.join(","));
        }
      if (near.size >= 3) return true;
    }
    return false;
  }
}
