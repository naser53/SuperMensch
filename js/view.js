// The game as the page sees it (owner, 2026-11-06: the rules live on the server only).
// The server (server/frames.js) sends the game after every event with everything the page
// used to work out itself; this file reads it back into objects shaped as the page and the
// board (render3d.js) have always read the game: game.state, game.pending, game.players ...
// Only geometry and plain lookups are left here; no rule is worked out on this side.

export const YARD = -1;
export const TUN = -2;

// a state of the pieces; `x` holds what the server worked out about it
export class ViewState {
  constructor(o) {
    this.pos = o.pos; this.kills = o.kills; this.hunters = o.hunters; this.scores = o.scores;
    this.tunnels = o.tunnels; this.tmark = o.tmark; this.hit = o.hit; this.earned = o.earned; this.hits = o.hits;
    this.x = o.x || null;
  }

  // a copy for drawing (the board walks a piece field by field); `x` is shared
  copy() {
    const c = a => a.map(r => (Array.isArray(r) ? r.slice() : r));
    return new ViewState({ pos: c(this.pos), kills: c(this.kills), hunters: c(this.hunters), scores: this.scores.slice(),
      tunnels: c(this.tunnels), tmark: c(this.tmark), hit: c(this.hit), earned: c(this.earned), hits: c(this.hits), x: this.x });
  }
}

// Read the server's data: { $s: n } becomes state n of the table (one object per state).
export function decode(data, table) {
  const states = (table || []).map(s => new ViewState(s));
  const walk = v => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      if (v.$s !== undefined && Object.keys(v).length === 1) return states[v.$s];
      const o = {};
      for (const k of Object.keys(v)) o[k] = walk(v[k]);
      return o;
    }
    return v;
  };
  return walk(data);
}

const mod = (a, n) => ((a % n) + n) % n;

export class ViewGame {
  // v: gameView of server/frames.js
  constructor(v) {
    this.cfg = { ...v.cfg, tunnels: () => v.cfg.tunnel_list };
    this.mode = v.mode;
    this.players = v.players;
    this.owner = v.owner;
    this.log = v.log.slice();
    this.load(v, v.states);
  }

  // the game after an event (or the first view); the object stays the same, so the page may hold it
  load(v, table) {
    const d = decode(v, table);
    this.state = d.state;
    this.turn = d.turn;
    this.turnNo = d.turnNo;
    this.over = d.over;
    this.places = d.places;
    this.cards = d.cards;
    this.lastDice = d.lastDice;
    this.noMove = d.noMove;
    this._stuck = d.stuck;
    this._complete = d.complete;
    const p = d.pending;
    if (p) {
      p.options = p.options || [];
      this.seqs = (p.seqs || []).map(q => ({ ...q, option: p.options[q.option] }));
      this.tblock = p.tblock || { all: null, colors: {} };
      delete p.seqs;
      delete p.tblock;
    } else {
      this.seqs = [];
      this.tblock = { all: null, colors: {} };
    }
    this.pending = p;
  }

  get L() { return this.cfg.track_len; }

  // geometry
  gate(color) { return color * this.cfg.corridor_len; }
  absOf(color, rel) { return mod(this.gate(color) + rel, this.L); }
  tunnelGeom(a, b) {
    const cl = this.cfg.corridor_len, mid = Math.floor(cl / 2) - 1;   // field 5 of a 10-field corridor
    return [(a - 1) * cl + mid, (b - 1) * cl + mid, Math.floor((b - a) * cl / 4)];
  }
  tunnelCost(a, b) { return this.cfg.tunnel_costs[b - a - 1]; }
  tunnelOf(st, col, i) {
    for (const t of st.tunnels) if (t[1] === col && t[2] === i) return t;
    return null;
  }

  // ranks, as the info card states them
  rank(pts) {
    const c = this.cfg;
    if (!c.ranks) return 0;
    return pts >= c.marshal_points ? 2 : pts >= c.general_points ? 1 : 0;
  }
  bounty(pts) {
    const r = this.rank(pts);
    return r === 2 ? this.cfg.marshal_bounty : r === 1 ? this.cfg.general_bounty : 0;
  }

  // what the server worked out
  stuck(p) { return !!(this._stuck && this._stuck[p]); }
  colorComplete(st, col) { return !!(this._complete && this._complete[col]); }
  hunterEligible(p, st) { return st.x && st.x.he ? st.x.he[p] : null; }
  _completedColor(p, st) { return st.x && st.x.cc ? st.x.cc[p] : null; }
  structures(st) { return new Map(st.x && st.x.s ? st.x.s : []); }
  blockerOf(st, p, m, die) { return (st.x && st.x.b && st.x.b[`${m.join()}|${die}`]) || null; }
  tunnelBlockers() { return this.tblock; }
  sequences() { return this.seqs; }
}

// The table of an online game on this page: the setup, the events so far and the game.
// Events come from the server with their frames (server/frames.js).
export class RemoteTable {
  constructor(setup, events, view) {
    this.setup = setup;
    this.events = events.slice();
    this.game = new ViewGame(view);
  }

  // the event for an option of the pending decision
  eventFor(opt) {
    const dec = this.game.pending;
    if (!dec || dec.kind === "dice") throw new Error("dice come from the server");
    const i = dec.options.indexOf(opt);
    if (i < 0) throw new Error("option is not part of the pending decision");
    return { pick: i };
  }

  // one event and its frame: the game after it, and the new lines of the log
  apply(ev, frame) {
    this.events.push(ev);
    this.game.log.push(...frame.log);
    this.game.load(frame.view, frame.states);
  }
}

// the option and the steps to animate of a frame, read back
export function frameParts(frame) {
  return { opt: frame.o ? decode(frame.o, frame.states) : null, entries: frame.e ? decode(frame.e, frame.states) : null };
}
