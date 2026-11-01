// Table tests: the event list rebuilds the same game (the basis of the online game).   npm test
import test from "node:test";
import assert from "node:assert/strict";
import { Config } from "../js/config.js";
import { Game, Option, Player } from "../js/engine.js";
import { SimpleAI } from "../js/ai.js";
import { Table, fingerprint } from "../js/table.js";

function setup(mode, n, colors, level = "beginner") {
  const players = Array.from({ length: n }, (_, i) =>
    ({ name: `P${i + 1}`, colors: mode === "two" ? [i, i + colors / 2] : [i], isAi: true }));
  return { players, mode, colors, level };
}

function playTable(su, seed, maxDecisions = 20000) {
  const t = new Table(su, { seed });
  const ais = su.players.map((_, i) => new SimpleAI(seed * 10 + i));
  for (let k = 0; !t.game.over && t.game.pending && k < maxDecisions; k++) t.choose(ais[t.game.turn].choose(t.game));
  return t;
}

const CASES = [["two", 3, 6], ["one", 6, 6], ["two", 2, 4], ["one", 4, 4], ["two", 2, 6, "advanced"]];

test("a table plays exactly like the engine with its own dice", () => {
  for (const [mode, n, colors, level] of CASES) {
    const su = setup(mode, n, colors, level);
    const t = playTable(su, 5);
    const ps = su.players.map(p => Player(p.name, p.colors, true));
    const g = new Game(ps, mode, Config.forBoard(colors, level || "beginner", mode), 5);
    const ais = ps.map((_, i) => new SimpleAI(50 + i));
    for (let k = 0; !g.over && g.pending && k < 20000; k++) g.choose(ais[g.turn].choose(g));
    assert.ok(t.game.over, `${mode} ${n} ${colors}: finished`);
    assert.equal(fingerprint(t.game), fingerprint(g));
    assert.deepEqual(t.game.log, g.log);
  }
});

test("the 6-color board with 14 fields per corridor plays whole games", async () => {
  const { boardFor } = await import("../js/boards.js");
  for (const [mode, n] of [["two", 3], ["one", 6]]) {
    const su = { ...setup(mode, n, 6), corridor: 14 };
    const t = playTable(su, 3);
    assert.equal(t.game.cfg.corridor_len, 14);
    assert.ok(t.game.over, `${mode}: finished`);
    assert.equal(fingerprint(Table.replay(su, t.events).game), fingerprint(t.game));
  }
  const b = boardFor(6, 14);
  assert.equal(b.track.length, 84);
  const key = p => p.map(v => v.toFixed(3)).join();
  assert.equal(new Set(b.track.map(key)).size, 84);                 // no two fields in one place
  assert.equal(boardFor(6, 10).track.length, 60);
});

test("setup and events (through JSON) rebuild the same game", () => {
  for (const [mode, n, colors, level] of CASES) {
    const su = setup(mode, n, colors, level);
    const t = playTable(su, 11);
    const wire = JSON.parse(JSON.stringify({ su, events: t.events }));
    const r = Table.replay(wire.su, wire.events);
    assert.equal(fingerprint(r.game), fingerprint(t.game));
    assert.deepEqual(r.game.places, t.game.places);
    assert.deepEqual(r.game.state.scores, t.game.state.scores);
  }
});

test("a device table waits for the dice and follows the server table step by step", () => {
  const su = setup("two", 3, 6);
  const server = new Table(su, { seed: 3 });
  const device = new Table(su, { autoDice: false });
  device.apply(server.events[0]);                     // the first throw (everybody starts stuck)
  const ais = su.players.map((_, i) => new SimpleAI(i));
  for (let k = 0; k < 300 && !server.game.over; k++) {
    const from = server.events.length;
    server.choose(ais[server.game.turn].choose(server.game));
    for (const ev of server.events.slice(from)) device.apply(ev);
    assert.equal(fingerprint(device.game), fingerprint(server.game));
  }
  assert.equal(device.events.length, server.events.length);
});

test("events that do not fit are refused and change nothing", () => {
  const su = setup("two", 2, 4);
  const t = new Table(su, { autoDice: false });
  assert.equal(t.game.pending.kind, "dice");
  const before = fingerprint(t.game);
  assert.throws(() => t.apply({ dice: [1, 2] }));        // the stuck throw needs three dice
  assert.throws(() => t.apply({ dice: [1, 2, 7] }));
  assert.throws(() => t.apply({ pick: 0 }));
  assert.equal(fingerprint(t.game), before);
  assert.equal(t.events.length, 0);
  t.apply({ dice: [6, 6, 2] });
  assert.throws(() => t.apply({ pick: 99 }));
  assert.throws(() => t.choose(new Option("x", "roll")));   // not one of the listed options
});

test("dice set with the debug command become events", () => {
  const su = setup("two", 2, 4);
  const t = new Table(su, { seed: 1 });
  const first = t.events.length;
  t.game.queuedDice = [6, 6, 6];
  // any next decision that throws three dice takes them
  for (let k = 0; k < 50 && t.game.queuedDice; k++) t.choose(t.game.pending.options[0]);
  assert.ok(t.events.slice(first).some(ev => ev.dice && ev.dice.join() === "6,6,6"));
  const r = Table.replay(su, t.events);
  assert.equal(fingerprint(r.game), fingerprint(t.game));
});
