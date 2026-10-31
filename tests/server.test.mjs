// Server logic tests (server/core.js; no Cloudflare needed).   npm test
import test from "node:test";
import assert from "node:assert/strict";
import { Room, checkSetup, claimSeats, cleanName, isGameId, newGameId } from "../server/core.js";
import { Table, fingerprint } from "../js/table.js";
import { mulberry32 } from "../js/engine.js";

const users = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `user${i + 1}` }));
const twoSeats = (...who) => who.map((w, i) => (w === "ai" ? { ai: true, colors: [i, i + 3] } : { user: w, colors: [i, i + 3] }));

test("game ids are short and readable", () => {
  for (let k = 0; k < 200; k++) assert.ok(isGameId(newGameId()));
  assert.ok(!isGameId("K7QX-4"));
  assert.ok(!isGameId("../x"));
});

test("a seat stays with the connected device until it leaves; the same browser takes it back", () => {
  const humans = [0, 2, 3];
  const others = [{ token: "tabletA", seats: [0] }, { token: "phoneB", seats: [] }];
  assert.deepEqual(claimSeats([0, 2], humans, others, "phoneB"), { seats: [2], taken: [0] });
  assert.deepEqual(claimSeats([0, 2], humans, others, "tabletA"), { seats: [0, 2], taken: [] });   // reconnecting
  assert.deepEqual(claimSeats([0], humans, others, null), { seats: [], taken: [0] });              // no token: no way back
  assert.deepEqual(claimSeats([1, 3, 3, 9], humans, [], "x"), { seats: [3], taken: [] });          // computer and unknown seats
  // after Exit (or a closed connection) the device is gone from the list: the seat is free
  assert.deepEqual(claimSeats([0], humans, [{ token: "phoneB", seats: [] }], "phoneB"), { seats: [0], taken: [] });
});

test("names are trimmed and limited", () => {
  assert.equal(cleanName("  Maman   Bozorg "), "Maman Bozorg");
  assert.equal(cleanName("   "), null);
  assert.equal(cleanName("x".repeat(40)).length, 24);
});

test("setup check: names from the users, colors and seats checked", () => {
  const su = checkSetup({ mode: "two", colors: 6, seats: twoSeats(2, "ai", 5) }, users);
  assert.deepEqual(su.players.map(p => [p.name, p.isAi, p.user]), [["user2", false, 2], ["Computer 2", true, null], ["user5", false, 5]]);
  assert.equal(su.level, "beginner");
  const bad = [
    { mode: "two", colors: 6, seats: twoSeats(2) },                       // one player
    { mode: "two", colors: 6, seats: twoSeats(2, 2) },                    // same user twice
    { mode: "two", colors: 6, seats: twoSeats("ai", "ai") },              // nobody human
    { mode: "two", colors: 6, seats: twoSeats(2, 11) },                   // unknown user
    { mode: "two", colors: 6, seats: [{ user: 1, colors: [0, 3] }, { user: 2, colors: [0, 4] }] },   // color twice
    { mode: "one", colors: 4, seats: [{ user: 1, colors: [0] }, { user: 2, colors: [4] }] },         // no such color
    { mode: "x", colors: 6, seats: twoSeats(1, 2) },
  ];
  for (const b of bad) assert.throws(() => checkSetup(b, users));
});

test("a room throws the dice, plays the computer, and refuses what is not allowed", () => {
  const su = checkSetup({ mode: "two", colors: 6, seats: twoSeats(1, "ai", 2) }, users);
  const room = new Room(su, [], mulberry32(9));
  assert.ok(room.events.length > 0 && room.events[0].dice);
  const g = room.table.game;
  assert.equal(su.players[g.pending.player].isAi, false);          // the computer has moved already
  const seq = room.events.length, me = g.pending.player, other = me === 0 ? 2 : 0;
  assert.throws(() => room.move(seq - 1, { pick: 0 }, [me]), /stale/);
  assert.throws(() => room.move(seq, { pick: 0 }, [other]), /not your turn/);
  assert.throws(() => room.move(seq, { dice: [6, 6] }, [me]), /dice come from the server/);
  assert.throws(() => room.move(seq, { pick: 999 }, [me]));
  assert.equal(room.events.length, seq);
});

test("two humans and a computer play a whole game; a device rebuilds it from the events", () => {
  const su = checkSetup({ mode: "two", colors: 6, seats: twoSeats(1, "ai", 2) }, users);
  const room = new Room(su, [], mulberry32(4));
  const device = new Table(su, { autoDice: false });
  for (const ev of room.events) device.apply(ev);
  const pick = mulberry32(5);
  for (let k = 0; k < 20000 && !room.table.game.over; k++) {
    const d = room.table.game.pending;
    const r = room.move(room.events.length, { pick: Math.floor(pick() * d.options.length) }, [0, 2]);
    for (const ev of r.events) device.apply(ev);
  }
  assert.ok(room.table.game.over);
  assert.equal(fingerprint(device.game), room.fingerprint());
  const res = room.result();
  assert.equal(res.places.length, 3);
  assert.deepEqual(res.users, [1, null, 2]);
  // the stored events bring the room back after a restart
  const again = new Room(su, JSON.parse(JSON.stringify(room.events)));
  assert.equal(again.fingerprint(), room.fingerprint());
  assert.equal(again.events.length, room.events.length);
});

test("the plain page's view lists the options in words", () => {
  const su = checkSetup({ mode: "one", colors: 4, seats: [{ user: 1, colors: [0] }, { ai: true, colors: [2] }] }, users);
  const v = new Room(su, [], mulberry32(1)).view();
  assert.ok(v.pending && v.pending.options.length > 0);
  assert.ok(v.pending.options.every(o => typeof o === "string" && o.length));
});
