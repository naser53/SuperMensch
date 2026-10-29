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

test("ranks and tunnel costs: general from 15 points, marshal from 25; bounties 10 / 15; tunnels 80 / 120 / 160", () => {
  const g = make();
  assert.equal(g.rankName(14).key, "soldier");
  assert.equal(g.rankName(15).key, "general");
  assert.equal(g.rankName(24).key, "general");
  assert.equal(g.rankName(25).key, "marshal");
  assert.equal(g.bounty(15), 10);
  assert.equal(g.bounty(25), 15);
  assert.equal(g.tunnelCost(1, 2), 80);
  assert.equal(g.tunnelCost(1, 3), 120);
  assert.equal(g.tunnelCost(1, 4), 160);
});

test("six first only when an own piece stands on the gate", () => {
  // blue piece on the board (not on its gate), 6 and 5: the 5 for that piece, then the 6 brings a new one in
  const g = make();
  put(g, 1, 0, 7); put(g, 4, 0, 3);
  g.turn = 1;
  const seqOk = g.playsFor(1, [6, 5]).some(p => p.steps.length === 2 && p.state.pos[1][0] === 12 && p.state.pos[1].includes(0));
  assert.ok(seqOk);
  // in click order too: 5 first, then the 6 brings the piece in
  g.manual = true;
  g.pending = new Decision("pre_roll", 1, [new Option("r", "roll")]);
  g.choose(g.pending.options[0]);
  g.choose(new Option(null, ["dice", [6, 5]]));
  const fiveFirst = g.sequences().some(q => q.steps[0].die === 5 && q.steps[0].mover.join() === "p,1,0"
    && q.steps[1].die === 6 && q.steps[1].entered);
  assert.ok(fiveFirst);
});

test("dice levels: fair for beginners, a 6 one time in ten for intermediate", () => {
  const count = level => {
    const g = new Game([Player("A", [0, 3]), Player("B", [1, 4])], "two", Config.forBoard(6, level), 7);
    const n = 60000, c = [0, 0, 0, 0, 0, 0, 0];
    for (let k = 0; k < n; k++) c[g._die()]++;
    return c.map(x => x / n);
  };
  const fair = count("beginner"), mid = count("intermediate");
  for (let v = 1; v <= 6; v++) assert.ok(Math.abs(fair[v] - 1 / 6) < 0.01);
  assert.ok(Math.abs(mid[6] - 0.1) < 0.01);
  for (let v = 1; v <= 5; v++) assert.ok(Math.abs(mid[v] - 0.18) < 0.01);
});

test("ranks come from the points the piece wins with its own captures", () => {
  const g = make();
  put(g, 0, 0, 5); put(g, 3, 0, 1);
  g.state.kills[0][0] = 10;                       // a soldier with 10 points
  put(g, 1, 0, g.relOf(1, 8));                    // blue on abs 8 = its corridor... worth piecePoints
  const p = g.playsFor(0, [3, 1]).find(x => x.state.pos[1][0] === YARD && x.steps[0].mover.join() === "p,0,0");
  const pts = g.piecePoints(1, g.relOf(1, 8));
  g._applyScore(0, p);
  assert.equal(p.state.kills[0][0], 10 + pts);    // soldier: no multiplier
  // a general (15+) doubles its capture points
  const h = make();
  put(h, 0, 0, 5); put(h, 3, 0, 1);
  h.state.kills[0][0] = 15;
  put(h, 1, 0, h.relOf(1, 8));
  const q = h.playsFor(0, [3, 1]).find(x => x.state.pos[1][0] === YARD && x.steps[0].mover.join() === "p,0,0");
  h._applyScore(0, q);
  assert.equal(q.state.scores[0], 2 * pts);
});

// ---------------------------------------------------------------- §11 ranked pieces survive a hit
test("a hit general becomes a soldier pushed back 7+ fields; a marshal a general; no room: yard with its points", () => {
  // red (0) at rel x hits with 3+1 the piece standing on red's rel x+4
  const setup = (vrel, vkills) => {
    const g = make();
    put(g, 3, 0, 1);
    const at = g.absOf(1, vrel);
    put(g, 0, 0, g.relOf(0, at) - 4);
    put(g, 1, 0, vrel);
    g.state.kills[1][0] = vkills;
    return g;
  };
  const hit = g => g.playsFor(0, [3, 1]).find(x => x.steps.some(s => s.captures.some(c => c.victim[1] === 1)));
  const g = setup(20, 0);
  g.state.kills[1][0] = g.cfg.general_points;
  put(g, 2, 0, g.relOf(2, g.absOf(1, 13)));           // 7 fields behind is taken (green)
  const hitPlay = hit(g);
  assert.ok(hitPlay);
  const st = hitPlay.state;
  assert.equal(st.pos[1][0], 12);                       // first free field 7+ behind
  assert.equal(st.kills[1][0], 0);                      // now a soldier
  const before = g.state.scores.slice();
  g._applyScore(0, hitPlay);
  assert.equal(hitPlay.state.scores[1], before[1] - g.cfg.general_bounty);   // the owner still loses the bounty
  // a marshal becomes a general with GENERAL_POINTS
  const h = setup(20, 0);
  h.state.kills[1][0] = h.cfg.marshal_points;
  const q = hit(h);
  assert.equal(q.state.kills[1][0], h.cfg.general_points);
  assert.equal(q.state.pos[1][0], 13);
  // close to its gate with every field behind taken: yard, rank and points kept
  const k = setup(5, 0);
  k.state.kills[1][0] = k.cfg.marshal_points + 3;
  put(k, 1, 1, 0);                                      // its own gate is taken
  const y = hit(k);
  assert.equal(y.state.pos[1][0], YARD);
  assert.equal(y.state.kills[1][0], k.cfg.marshal_points + 3);
  // a soldier still goes to the yard with 0
  const m = setup(20, 0);
  m.state.kills[1][0] = 4;
  const z = hit(m);
  assert.equal(z.state.pos[1][0], YARD);
  assert.equal(z.state.kills[1][0], 0);
});

test("the yard piece with the most points enters first", () => {
  const g = make();
  put(g, 3, 0, 1);
  g.state.kills[0][2] = 30;
  const plays = g.playsFor(0, [6, 1]);
  assert.ok(plays.some(x => x.steps.some(s => s.mover.join() === "p,0,2" && s.entered)));
  assert.ok(!plays.some(x => x.steps.some(s => s.mover[1] === 0 && s.mover[2] !== 2)));
});

// ---------------------------------------------------------------- §11 nest swap
test("nest swap: with a 6 a soldier in the nest with points comes out with them, a yard piece takes its place", () => {
  const g = make();
  put(g, 3, 0, 1);
  put(g, 0, 0, g.L + 3);                          // deepest nest field
  g.state.kills[0][0] = 9;                        // a soldier with points
  const p = g.playsFor(0, [6, 2]).find(x => x.steps.some(s => s.swap != null));
  assert.ok(p, "a swap is offered");
  const s = p.steps.find(x => x.swap != null);
  assert.equal(p.state.pos[0][0], 0);             // on its gate
  assert.equal(p.state.pos[0][s.swap], g.L + 3);  // the yard piece is in its nest place
  assert.equal(p.state.kills[0][0], 9);
  assert.ok(p.state.hit[0][0] && p.state.hit[0][s.swap]);   // no clean-piece bonus from a swap
  // not for a general, not without points, not without a yard piece, not without a 6
  g.state.kills[0][0] = 15;
  assert.ok(!g.playsFor(0, [6, 2]).some(x => x.steps.some(s => s.swap != null)));
  g.state.kills[0][0] = 0;
  assert.ok(!g.playsFor(0, [6, 2]).some(x => x.steps.some(s => s.swap != null)));
  g.state.kills[0][0] = 9;
  assert.ok(!g.playsFor(0, [5, 2]).some(x => x.steps.some(s => s.swap != null)));
  for (let i = 1; i < 4; i++) put(g, 0, i, g.L - 1 + i - 1);   // no piece left in the yard
  assert.ok(!g.playsFor(0, [6, 2]).some(x => x.steps.some(s => s.swap != null)));
});
