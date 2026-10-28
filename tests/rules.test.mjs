// Rule tests. Each test names the rule from the rules document.   npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Config } from "../js/config.js";
import { Decision, Game, Option, Player, TUN, YARD } from "../js/engine.js";
import { playOne } from "./simulate.mjs";
import { allGames } from "./golden.mjs";

function make(mode = "two") {
  const ps = mode === "two"
    ? [Player("A", [0, 3]), Player("B", [1, 4]), Player("C", [2, 5])]
    : [Player("A", [0]), Player("B", [1])];
  const g = new Game(ps, mode, null, 0);
  g.pending = null;
  g.turn = 0;
  return g;
}
const put = (g, col, i, rel) => { g.state.pos[col][i] = rel; };

test("exit needs a six", () => {
  const g = make();
  assert.deepEqual(g.playsFor(0, [5, 3]), []);
  const plays = g.playsFor(0, [6, 3]);
  assert.ok(plays.length && plays.every(p => p.steps.some(s => s.entered)));
});

test("never land on an own piece", () => {
  const g = make();
  put(g, 0, 0, 5); put(g, 0, 1, 8);
  put(g, 3, 0, 1);                         // color 3 is also player A's, keep it alive
  for (const p of g.playsFor(0, [3, 1])) {
    const cells = p.state.pos[0].filter(r => r >= 0 && r < g.L).map(r => g.absOf(0, r));
    assert.equal(cells.length, new Set(cells).size);
  }
});

test("a capture sends the piece home", () => {
  const g = make();
  put(g, 0, 0, 5); put(g, 3, 0, 1);
  put(g, 1, 0, g.relOf(1, 8));
  assert.ok(g.playsFor(0, [3, 1]).some(p => p.state.pos[1][0] === YARD));
});

test("both dice must be used when possible", () => {
  const g = make();
  put(g, 0, 0, 5); put(g, 3, 0, 1);
  const plays = g.playsFor(0, [3, 2]);
  assert.ok(plays.length && plays.every(p => p.steps.length === 2));
});

test("burnt die: one die only when the other color cannot move", () => {
  const g = make();
  put(g, 0, 0, 5);
  const plays = g.playsFor(0, [3, 2]);
  assert.ok(plays.length && plays.every(p => p.steps.length === 1));
});

test("sum move: the field in between counts and captures", () => {
  const g = make();
  put(g, 0, 0, 5); put(g, 3, 0, 1);
  put(g, 1, 0, g.relOf(1, 8));
  assert.ok(g.playsFor(0, [3, 4]).some(p => p.state.pos[0][0] === 12 && p.state.pos[1][0] === YARD));
});

test("six first within the same color", () => {
  const g = make();
  put(g, 0, 0, 0);
  put(g, 3, 0, g.cfg.track_len + 3);       // yellow finished, not alive
  for (const p of g.playsFor(0, [6, 5])) {
    const [a, b] = p.steps;
    if (b && a.mover.join() !== b.mover.join() && a.mover[1] === b.mover[1]) assert.equal(a.die, 6);
  }
});

test("wall protects; two pieces break it", () => {
  const g = make();
  const b = 1;
  put(g, b, 0, g.relOf(b, 20)); put(g, b, 1, g.relOf(b, 21));
  put(g, 0, 0, 17); put(g, 0, 1, 16); put(g, 3, 0, 1);
  for (const p of g.playsFor(0, [3, 1])) assert.notEqual(p.state.pos[b][0], YARD);
  assert.ok(g.playsFor(0, [3, 5]).some(p => p.state.pos[b][0] === YARD && p.state.pos[b][1] === YARD));
});

test("castle: no passing", () => {
  const g = make();
  [20, 21, 22].forEach((a, i) => put(g, 1, i, g.relOf(1, a)));
  put(g, 0, 0, 18); put(g, 3, 0, 1);
  for (const p of g.playsFor(0, [6, 1])) {
    const r = p.state.pos[0][0];
    assert.ok(!(r >= 20 && r <= 30 && r > 22));
  }
});

test("castle break with three dice", () => {
  const g = make();
  [20, 21, 22].forEach((a, i) => put(g, 1, i, g.relOf(1, a)));
  put(g, 0, 0, 18); put(g, 0, 1, 17); put(g, 3, 0, g.relOf(3, 19));
  const plays = g.breakPlays(0, [2, 4, 3]);
  assert.ok(plays.length);
  for (const p of plays) assert.equal([0, 1, 2].filter(i => p.state.pos[1][i] === YARD).length, 3);
});

test("stuck definition", () => {
  const g = make();
  assert.ok(g.stuck(0));
  put(g, 0, 0, 5);
  assert.ok(!g.stuck(0));
});

test("finished pieces are not alive", () => {
  const g = make();
  const L = g.L;
  put(g, 0, 0, L + 3); put(g, 0, 1, L + 2);
  assert.ok(g.finished(g.state, 0, 0) && g.finished(g.state, 0, 1));
  put(g, 0, 2, L);
  assert.ok(g.alive(g.state, 0, 2));
});

test("no overshooting the nest", () => {
  const g = make();
  put(g, 0, 0, g.L); put(g, 3, 0, 1);
  for (const p of g.playsFor(0, [5, 6])) assert.ok(p.state.pos[0][0] <= g.L + 3);
});

test("points by corridor", () => {
  const g = make();
  assert.equal(g.piecePoints(1, 0), 1 + 5);
  assert.equal(g.piecePoints(1, g.L - 1), 23 + 20);
  assert.equal(g.piecePoints(1, 45), 15);
});

test("full games finish", () => {
  for (let s = 0; s < 4; s++) {
    assert.ok(playOne(s, "two", 3).over);
    assert.ok(playOne(s, "one", 4).over);
  }
});

test("tunnel list: default and up to corridor 5", () => {
  const c = new Config();
  assert.deepEqual(c.tunnels(), [[1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4]]);
  c.tunnel_last_corridor = 5;
  const t = c.tunnels().map(x => x.join());
  assert.ok(t.includes("2,5") && t.includes("3,5") && t.includes("4,5") && !t.includes("1,5"));
});

test("4-color board: 40 fields, tunnels skip 1 or 2 corridors, points 1/4/8/10", () => {
  const c = Config.forBoard(4);
  assert.equal(c.track_len, 40);
  assert.deepEqual(c.tunnels(), [[1, 2], [1, 3], [2, 3]]);
  assert.deepEqual(c.corridor_points, [1, 4, 8, 10]);
  for (let s = 0; s < 3; s++) {
    assert.ok(playOne(s, "two", 2, 4).over);
    assert.ok(playOne(s, "one", 4, 4).over);
  }
});

// ---------------------------------------------------------------- §13 tunnels
function declare(g, col, i, a, b) {
  g.pending = new Decision("pre_roll", 0, [new Option("t", ["tunnel", col, i, a, b])]);
  g.choose(g.pending.options[0]);
  g.pending = null;
}

test("tunnel geometry", () => {
  const g = make();
  assert.deepEqual(g.tunnelGeom(1, 2), [4, 14, 2]);
  assert.deepEqual(g.tunnelGeom(1, 3), [4, 24, 5]);
  assert.deepEqual(g.tunnelGeom(1, 4), [4, 34, 7]);
});

test("tunnel options and cost", () => {
  const g = make();
  put(g, 0, 0, 0);
  const has = (col, i, a, b) => g.tunnelOptions(0).some(o => o.join() === [col, i, a, b].join());
  assert.ok(has(0, 0, 1, 2) && has(0, 0, 1, 4));
  put(g, 0, 0, 5);
  assert.ok(g.tunnelOptions(0).every(o => !(o[1] === 0 && o[2] === 1)));
  g.state.scores[0] = -1;
  assert.deepEqual(g.tunnelOptions(0), []);
});

test("tunnel: enter, move inside, exit hits a wall piece", () => {
  const g = make();
  put(g, 0, 0, 2); put(g, 3, 0, 1);
  declare(g, 0, 0, 1, 2);
  assert.equal(g.state.scores[0], -g.cfg.tunnel_costs[0]);
  assert.equal(g.step(g.state, 0, ["p", 0, 0], 1, new Map()), null);
  const [ns] = g.step(g.state, 0, ["p", 0, 0], 4, new Map());
  assert.equal(ns.pos[0][0], TUN);
  assert.equal(ns.tunnels[0][5], 2);
  g.state = ns;
  put(g, 1, 0, g.relOf(1, 15)); put(g, 1, 1, g.relOf(1, 16));
  const hit = g.playsFor(0, [2, 5]).filter(p => p.state.pos[1][0] === YARD && p.state.pos[0][0] === 15);
  assert.ok(hit.length);
  assert.equal(hit[0].state.tunnels.length, 0);
  assert.ok(hit[0].state.tmark[0][0]);
});

test("tunnel: no sum move", () => {
  const g = make();
  put(g, 0, 0, 3); put(g, 3, 0, 1);
  declare(g, 0, 0, 1, 3);
  for (const p of g.playsFor(0, [2, 3])) assert.ok(p.steps.filter(s => s.mover.join() === "p,0,0").length <= 1);
});

test("a piece inside a tunnel is safe", () => {
  const g = make();
  put(g, 0, 0, TUN);
  g.state.tunnels.push([0, 0, 0, 1, 3, 2]);
  assert.ok(!g.occupancy(g.state).has(g.absOf(0, 4)));
});

test("debt: a tunnel piece laps again", () => {
  const g = make();
  const L = g.L;
  put(g, 0, 0, L - 2); put(g, 3, 0, 1);
  g.state.tmark[0][0] = true;
  g.state.scores[0] = -10;
  assert.equal(g.step(g.state, 0, ["p", 0, 0], 4, new Map())[0].pos[0][0], 2);
  g.state.scores[0] = 0;
  assert.equal(g.step(g.state, 0, ["p", 0, 0], 4, new Map())[0].pos[0][0], L + 2);
});

// ---------------------------------------------------------------- debug mode
test("debug mode: every throw waits for the dice set by the player", () => {
  const g = new Game([Player("A", [0, 3]), Player("B", [1, 4]), Player("C", [2, 5])], "two", null, 1, true);
  assert.equal(g.pending.kind, "dice");
  assert.equal(g.pending.dice.length, 3);                 // stuck: three dice
  g.choose(new Option(null, ["dice", [6, 2, 3]]));
  assert.deepEqual(g.lastDice, [6, 2, 3]);
  assert.equal(g.pending.kind, "keep");
  g.choose(g.pending.options.find(o => Array.isArray(o.payload) && o.payload[1].join() === "2,6"));
  assert.equal(g.pending.kind, "play");
  g.choose(g.pending.options[0]);
  const inYard = g.state.pos[0].filter(r => r === YARD).length + g.state.pos[3].filter(r => r === YARD).length;
  assert.equal(inYard, 7);
});

test("debug mode: a double asks for the bonus die", () => {
  const g = make();
  g.manual = true;
  put(g, 0, 0, 5); put(g, 3, 0, 1);
  g.pending = new Decision("pre_roll", 0, [new Option("r", "roll")]);
  g.choose(g.pending.options[0]);
  assert.equal(g.pending.kind, "dice");
  assert.equal(g.pending.dice.length, 2);
  g.choose(new Option(null, ["dice", [3, 3]]));
  g.choose(g.pending.options[0]);
  assert.equal(g.pending.kind, "dice");
  assert.equal(g.pending.dice.length, 1);
});

// ---------------------------------------------------------------- regression
test("fixed games still play exactly as recorded (tests/golden.json)", () => {
  const want = JSON.parse(fs.readFileSync(new URL("./golden.json", import.meta.url), "utf8"));
  assert.deepEqual(allGames(), want);
});

// ---------------------------------------------------------------- §11 end bonuses
test("end bonuses: clean piece, complete color, finishing places; the game goes on", () => {
  const g = make();
  const L = g.L, c = g.cfg;
  // red: three pieces home, the fourth one step before Z1; yellow already complete
  [L + 3, L + 2, L + 1].forEach((r, i) => put(g, 0, i, r));
  put(g, 0, 3, L - 1);
  [0, 1, 2, 3].forEach(i => put(g, 3, i, L + i));
  g.state.hit[0][3] = false;
  const before = g.state.copy();
  g.state.pos[0][3] = L;                     // red 4 reaches Z1: red complete, player A done
  g._finalBonuses(0, before);
  assert.equal(g.state.scores[0], c.clean_piece_bonus + c.color_bonus + c.finish_bonus[0]);
  assert.deepEqual(g.places, [0]);
  assert.equal(g.winner, 0);
  assert.ok(!g.over);                        // B and C play on
  // B finishes second: game over, C last
  const b0 = g.state.copy();
  [1, 4].forEach(col => [0, 1, 2, 3].forEach(i => put(g, col, i, L + i)));
  b0.hit[1] = [true, true, true, true]; g.state.hit[1] = [true, true, true, true];
  g.state.hit[4] = [true, true, true, true];
  g._finalBonuses(1, b0);
  assert.equal(g.state.scores[1], 2 * c.color_bonus + c.finish_bonus[1]);
  assert.deepEqual(g.places, [0, 1, 2]);
  assert.ok(g.over);
});

test("a captured piece gets no clean-piece bonus", () => {
  const g = make();
  put(g, 0, 0, 5); put(g, 3, 0, 1);
  put(g, 1, 0, g.relOf(1, 8));
  const p = g.playsFor(0, [3, 1]).find(x => x.state.pos[1][0] === YARD);
  assert.ok(p.state.hit[1][0]);
});

test("finished players are skipped", () => {
  const g = make();
  g.places = [1];
  g.turn = 0;
  g.pending = null;
  g._endTurn();
  assert.equal(g.turn, 2);
});

// ---------------------------------------------------------------- §5 single six
function bonusChain(g, first, rolls) {
  // play: "first" dice, then answer every bonus die from "rolls"; returns how many bonus dice were asked for
  g.manual = true;
  g.pending = new Decision("pre_roll", 0, [new Option("r", "roll")]);
  g.choose(g.pending.options[0]);
  g.choose(new Option(null, ["dice", first]));
  let asked = 0;
  for (;;) {
    while (g.pending && g.pending.kind === "play" && g.turn === 0) g.choose(g.pending.options[0]);
    if (!g.pending || g.pending.kind !== "dice" || g.turn !== 0 || g.pending.dice.length !== 1 || asked >= rolls.length) break;
    g.choose(new Option(null, ["dice", [rolls[asked++]]]));
  }
  return asked;
}

test("bonus die after a pair: a 6 goes on, then only 6", () => {
  const g = make();
  put(g, 0, 0, 5); put(g, 3, 0, 1); put(g, 0, 1, 20);
  // 1-1, then bonus 6 (goes on), then 1 (stops: after a 6 only 6 continues)
  assert.equal(bonusChain(g, [1, 1], [6, 1, 3]), 2);
  const h = make();
  put(h, 0, 0, 5); put(h, 3, 0, 1); put(h, 0, 1, 20);
  // 1-1, then 1 (goes on), then 6 (goes on), then 6 (goes on), then 2 (stops)
  assert.equal(bonusChain(h, [1, 1], [1, 6, 6, 2, 4]), 4);
});

test("6 with another number in a normal throw: no bonus", () => {
  const g = make();
  put(g, 0, 0, 5); put(g, 3, 0, 1);
  assert.equal(bonusChain(g, [6, 3], [6]), 0);
});

test("single-color game: a 6 throws again, as long as 6 comes", () => {
  const g = make("one");
  put(g, 0, 0, 5);
  g.manual = true;
  g._startTurn();
  const throwOne = v => {
    g.choose(new Option(null, ["dice", [v]]));
    while (g.pending && g.pending.kind === "play") g.choose(g.pending.options[0]);
  };
  throwOne(6);
  assert.equal(g.turn, 0);                 // again
  throwOne(6);
  assert.equal(g.turn, 0);                 // and again
  throwOne(4);
  assert.equal(g.turn, 1);                 // next player
});

test("ranks and tunnel costs: general from 3 captures, marshal from 4; bounties 40 / 60; tunnels 80 / 120 / 160", () => {
  const g = make();
  assert.equal(g.rankName(2).key, "soldier");
  assert.equal(g.rankName(3).key, "general");
  assert.equal(g.rankName(4).key, "marshal");
  assert.equal(g.bounty(3), 40);
  assert.equal(g.bounty(4), 60);
  assert.equal(g.tunnelCost(1, 2), 80);
  assert.equal(g.tunnelCost(1, 3), 120);
  assert.equal(g.tunnelCost(1, 4), 160);
});
