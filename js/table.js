// A table: one game plus the list of everything that happened in it.
//
// The engine runs in manual mode, so every throw is a "dice" decision. A table answers it
// itself (`autoDice`, the offline game and the server) or waits for the dice from outside
// (a device in the online game, the server's throw). Every answer is one event:
//   { dice: [3, 6] }   the dice of a throw
//   { pick: 2 }        option 2 of the pending decision (the engine lists options in a fixed order)
// The engine is deterministic, so the setup and the events rebuild the same game anywhere:
// on the server, on every device, and later from the stored game.

import { Config } from "./config.js";
import { Game, Option, Player } from "./engine.js";

// setup = { players: [{ name, colors, isAi }], mode, colors, level }; plain JSON
export class Table {
  // rng: where the table's own dice come from (the server passes a crypto source)
  constructor(setup, { seed = null, autoDice = true, rng = null } = {}) {
    this.setup = setup;
    const players = setup.players.map(p => Player(p.name, p.colors, !!p.isAi));
    this.game = new Game(players, setup.mode, Config.forBoard(setup.colors, setup.level || "beginner", setup.mode), seed, true);
    if (rng) this.game.rng = rng;
    this.events = [];
    this.autoDice = autoDice;
    this._settle();
  }

  // the event for an option of the pending decision
  eventFor(opt) {
    const dec = this.game.pending;
    if (dec.kind === "dice") return { dice: opt.payload[1].slice() };
    const i = dec.options.indexOf(opt);
    if (i < 0) throw new Error("option is not part of the pending decision");
    return { pick: i };
  }

  choose(opt) { this.apply(this.eventFor(opt)); }

  // Apply one event. Throws (and changes nothing) if it does not fit the pending decision.
  apply(ev) {
    const g = this.game, dec = g.pending;
    if (!dec || g.over) throw new Error("the game has no pending decision");
    let opt;
    if (dec.kind === "dice") {
      if (!Array.isArray(ev.dice) || ev.dice.length !== dec.dice.length || ev.dice.some(v => !(v >= 1 && v <= 6 && v % 1 === 0)))
        throw new Error("these dice do not fit the throw");
      opt = new Option(null, ["dice", ev.dice.slice()]);
    } else {
      opt = Number.isInteger(ev.pick) ? dec.options[ev.pick] : undefined;
      if (!opt) throw new Error("no such option");
    }
    // dice set with the debug command "dice" become events too, so the list stays complete
    const queued = g.queuedDice;
    g.queuedDice = null;
    this.events.push(dec.kind === "dice" ? { dice: ev.dice.slice() } : { pick: ev.pick });
    g.choose(opt);
    this._settle(queued);
  }

  // answer the throws this table answers itself
  _settle(queued = null) {
    const g = this.game;
    while (g.pending && g.pending.kind === "dice" && !g.over) {
      const n = g.pending.dice.length;
      if (queued && queued.length === n) { const d = queued; queued = null; this.apply({ dice: d }); return; }
      if (!this.autoDice) break;
      g.queuedDice = queued;              // still kept for a later throw with that many dice
      this.apply({ dice: g.roll(n) });
      return;
    }
    if (queued) g.queuedDice = queued;
  }

  // Rebuild a table from its setup and events (dice come only from the events).
  static replay(setup, events) {
    const t = new Table(setup, { autoDice: false });
    for (const ev of events) t.apply(ev);
    return t;
  }
}

// A short fingerprint of everything the rules look at, to check that two tables agree.
export function fingerprint(g) {
  const s = g.state;
  const str = JSON.stringify([s.pos, s.kills, s.hunters, s.scores, s.tunnels, s.tmark, g.cards, g.noSix,
    g.turn, g.turnNo, g.places, g.over, g.pending && g.pending.kind]);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
  return h.toString(36);
}
