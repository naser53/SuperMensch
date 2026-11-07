// Server logic tests (server/core.js; no Cloudflare needed).   npm test
import test from "node:test";
import assert from "node:assert/strict";
import { Room, checkSetup, claimSeats, cleanBoard, cleanColors, cleanName, cleanRules, colorsKeep, editSetup, isGameId, newGameId, nextName, parseDebug, pickColors, diceTurns, ruleDefaults, rulesFor, withEngine, newPasskey, cleanPasskey, PasskeyGate, PASSKEY_TRIES, PASSKEY_WAIT_MS } from "../server/core.js";
import { ENGINE_LEVELS } from "../js/ai.js";
import { Table, fingerprint } from "../js/table.js";
import { mulberry32 } from "../js/engine.js";
import { Config } from "../js/config.js";
import { ADMIN_STR } from "../js/admin-strings.js";
import { LANGS } from "../js/i18n.js";

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

test("the 8-color board is accepted, with 10 or 14 fields per corridor", () => {
  const seats = [0, 1, 2, 3].map(i => (i === 0 ? { user: 1, colors: [0, 4] } : { ai: true, colors: [i, i + 4] }));
  const su = checkSetup({ mode: "two", colors: 8, corridor: 14, seats }, users);
  assert.equal(su.colors, 8);
  assert.equal(su.corridor, 14);
  assert.throws(() => checkSetup({ mode: "two", colors: 8, seats: seats.concat([{ ai: true, colors: [5, 6] }]) }, users));
  assert.throws(() => checkSetup({ mode: "two", colors: 7, seats }, users));
});

test("the admin changes who plays: same number keeps the game, another restarts it", () => {
  const old = checkSetup({ mode: "two", colors: 6, level: "intermediate", seats: twoSeats(1, "ai") }, users);
  assert.equal(old.level, "intermediate");
  const swap = editSetup(old, [{ user: 1 }, { user: 3 }], users);
  assert.ok(swap.keep);
  assert.deepEqual(swap.setup.players.map(p => p.name), ["user1", "user3"]);
  const more = editSetup(old, [{ user: 1 }, { ai: true }, { user: 4 }], users);
  assert.ok(!more.keep);
  assert.deepEqual(more.setup.players.map(p => p.colors), [[0, 3], [1, 4], [2, 5]]);
  assert.throws(() => editSetup(old, [{ user: 1 }, { user: 2 }, { user: 3 }, { user: 4 }], users));   // board full
  // a room keeps its moves when only the players change
  const room = new Room(old, [], mulberry32(2));
  const again = new Room(swap.setup, room.events.slice());
  assert.ok(again.events.length >= room.events.length);
});

test("the admin's piece colors: a hex or the default (null) per color", () => {
  const d = Config.PIECE_COLORS;
  assert.equal(d[3], "#cea70d");                                   // yellow, 15% darker (owner, 2026-11-02)
  const list = d.slice(); list[0] = "#ABCDEF"; list[3] = null;
  assert.deepEqual(cleanColors(list), ["#abcdef", null, null, null, null, null, null, null]);
  assert.throws(() => cleanColors(d.slice(0, 6)));
  assert.throws(() => cleanColors(d.map((c, i) => (i ? c : "red"))));
  assert.throws(() => cleanColors("#ffffff"));
  // the board's own colors: surface and edge
  assert.deepEqual(cleanBoard(["#112233", Config.BOARD_COLORS[1]]), ["#112233", null]);
  assert.throws(() => cleanBoard(["#112233"]));
});

test("names are trimmed and limited", () => {
  assert.equal(cleanName("  Maman   Bozorg "), "Maman Bozorg");
  assert.equal(cleanName("   "), null);
  assert.equal(cleanName("x".repeat(40)).length, 24);
});

test("the computer's level of a room: beginner by default, kept on edits, changed mid-game", () => {
  const base = { mode: "two", colors: 6, level: "beginner", seats: twoSeats("ai", 1) };
  assert.equal(checkSetup(base, users).engine, undefined);                       // beginner: left out
  assert.equal(checkSetup({ ...base, engine: "nonsense" }, users).engine, undefined);
  const hard = checkSetup({ ...base, engine: "hard" }, users);
  assert.equal(hard.engine, "hard");
  assert.equal(editSetup(hard, [{ ai: true }, { user: 2 }], users).setup.engine, "hard");
  assert.equal(hard.autoRetry, true);                                          // new rooms: auto second try
  const { autoRetry: _, ...old } = hard;
  assert.equal(editSetup(old, [{ ai: true }, { user: 2 }], users).setup.autoRetry, undefined);   // kept moves: as they were
  assert.equal(editSetup(old, [{ ai: true }, { user: 2 }, { user: 3 }], users).setup.autoRetry, true);
  assert.equal(withEngine(hard, "beginner").engine, undefined);
  assert.equal(withEngine(hard, "intermediate").engine, "intermediate");
  const room = new Room(hard, [], mulberry32(5));
  assert.equal(room.ais[0].w, ENGINE_LEVELS.hard);
  const n = room.events.length;
  assert.equal(room.setEngine("intermediate").engine, "intermediate");
  assert.equal(room.ais[0].w, ENGINE_LEVELS.intermediate);
  assert.equal(room.events.length, n);                                           // the game goes on as it is
  assert.equal(new Room(base.engine ? base : checkSetup(base, users), []).ais[0].w, ENGINE_LEVELS.beginner);
});

test("room passkeys: four digits; after a few wrong ones the room waits", () => {
  for (let k = 0; k < 50; k++) assert.match(newPasskey(), /^\d{4}$/);
  assert.equal(newPasskey(() => 0.0042), "0042");
  assert.equal(cleanPasskey(" 0815 "), "0815");
  for (const bad of ["815", "08151", "ab12", null, undefined]) assert.equal(cleanPasskey(bad), null);
  const gate = new PasskeyGate();
  assert.equal(gate.check("1234", "1234", 0), "ok");
  for (let k = 0; k < PASSKEY_TRIES; k++) assert.equal(gate.check("0000", "1234", 1000), "wrong");
  assert.equal(gate.check("1234", "1234", 2000), "wait");                     // even the right one, for a while
  assert.equal(gate.check("1234", "1234", 1000 + PASSKEY_WAIT_MS), "ok");
});

test("setup check: names from the users, colors and seats checked", () => {
  const su = checkSetup({ mode: "two", colors: 6, seats: twoSeats(2, "ai", 5) }, users);
  assert.deepEqual(su.players.map(p => [p.name, p.isAi, p.user]), [["user2", false, 2], ["Engine", true, null], ["user5", false, 5]]);
  assert.equal(su.level, "beginner");
  const two = checkSetup({ mode: "two", colors: 6, seats: twoSeats("ai", 2, "ai") }, users);
  assert.deepEqual(two.players.map(p => p.name), ["Engine 1", "user2", "Engine 2"]);
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

test("children pick their colors: first come first served, swaps, until a person moves", () => {
  const one = checkSetup({ mode: "one", colors: 4, seats: [{ user: 1, colors: [0] }, { user: 2, colors: [1] }, { ai: true, colors: [2] }] }, users);
  let s = pickColors(one, 0, [1]);                                  // seat 1 has not picked: they swap
  assert.deepEqual(s.players.map(p => p.colors), [[1], [0], [2]]);
  assert.throws(() => pickColors(s, 1, [1]), /color taken/);         // seat 0 picked it first
  s = pickColors(s, 1, [2]);                                        // the computer's color: swapped
  assert.deepEqual(s.players.map(p => p.colors), [[1], [2], [0]]);
  s = pickColors(s, 0, [3]);                                        // a free color: the old one is free now
  assert.deepEqual(s.players.map(p => p.colors), [[3], [2], [0]]);
  assert.throws(() => pickColors(s, 2, [1]), /no such seat/);        // not for the computer
  assert.throws(() => pickColors(s, 0, [3, 1]), /bad colors/);
  const two = checkSetup({ mode: "two", colors: 6, seats: twoSeats(1, 2, 3) }, users);
  const t2 = pickColors(two, 0, [1, 2]);                             // both colors, any two
  assert.deepEqual(t2.players.map(p => p.colors.slice().sort()), [[1, 2], [0, 4], [3, 5]]);

  const room = new Room(checkSetup({ mode: "two", colors: 6, seats: twoSeats("ai", 1, 2) }, users), [], mulberry32(4));
  assert.ok(room.colorsOpen());
  const before = room.events.slice(0, colorsKeep(room.setup, room.events));
  assert.ok(before.every(ev => ev.dice));                            // only throws before the first move
  const r2 = room.recolor(1, [0, 1]);
  assert.deepEqual(r2.setup.players[1].colors, [0, 1]);
  assert.deepEqual(r2.events.slice(0, before.length), before);
  const g = r2.table.game;
  r2.move(r2.events.length, { pick: 0 }, [g.pending.player]);         // a person moves: colors are fixed
  assert.ok(!r2.colorsOpen());
  assert.throws(() => r2.recolor(2, [2, 5]), /started/);
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

test("play again names the next game with a counter", () => {
  assert.equal(nextName("Family"), "Family (2)");
  assert.equal(nextName("Family (2)"), "Family (3)");
  assert.equal(nextName(""), "Game (2)");
  const long = nextName("x".repeat(24));
  assert.equal(long.length, 24);
  assert.ok(long.endsWith(" (2)"));
});

test("the admin can place the pieces (a test aid): the turn starts again and devices replay it", () => {
  const setup = { players: [{ name: "C", colors: [0, 2], isAi: true }, { name: "N", colors: [1, 3], isAi: false, user: 1 }],
    mode: "two", colors: 4, level: "beginner" };
  const room = new Room(setup, [], mulberry32(5));
  room.place("B: 41 42 43 44\nY: 34 y y y\nR: 4 y y y\nG: y y y y");
  const g = room.table.game;
  assert.equal(room.placeText(), "R: 4 y y y\nB: z1 z2 z3 z4\nG: y y y y\nY: 34 y y y");
  assert.equal(g.hunterEligible(1, g.state), 1);                  // blue is home: the hunter may come in
  assert.equal(fingerprint(Table.replay(setup, room.events).game), room.fingerprint());
  room.place("R2 23\nR3z 2\nG1 z1; G4 y");                       // a line per piece; z = the nest
  assert.equal(room.placeText().split("\n")[0], "R: 4 23 z2 y");
  assert.equal(room.placeText().split("\n")[2], "G: z1 y y y");
  const n = room.events.length;
  assert.throws(() => room.place("R: 4 4 y y"), /two pieces/);
  assert.throws(() => room.place("R5 3"), /no such piece/);
  assert.throws(() => room.place("R1 z5"), /no such nest field/);
  assert.throws(() => room.place("B: 41 42"), /needs 4/);
  assert.throws(() => room.place("Q: 1 y y y"), /no such color/);
  assert.equal(room.events.length, n);                             // a refused place changes nothing
});

test("admin debug: rewind N and roll dice go back to a dice turn and throw it again", () => {
  assert.deepEqual(parseDebug("Go drop -1"), { go: -1 });
  assert.deepEqual(parseDebug("Rewind 3"), { go: 3 });
  assert.deepEqual(parseDebug("drop dice 4,2, 5"), { dice: [4, 2, 5] });
  assert.deepEqual(parseDebug("Roll dice 3 6"), { dice: [3, 6] });
  assert.deepEqual(parseDebug(" reset "), { reset: true });
  assert.throws(() => parseDebug("drop dice 7,1"));
  const su = checkSetup({ mode: "two", colors: 6, seats: twoSeats(1, "ai") }, users);
  const room = new Room(su, [], mulberry32(7));
  const pick = mulberry32(8);
  for (let k = 0; k < 300 && !room.table.game.over; k++) {
    const d = room.table.game.pending;
    room.move(room.events.length, { pick: Math.floor(pick() * d.options.length) }, [0]);
  }
  const turns = diceTurns(su, room.events);
  const throws = room.events.filter(e => e.dice).length;
  // a second try belongs to the turn of the first throw
  const retries = room.events.filter((e, i) => e.dice && i > 0 && turns.every(t => t.at !== i)).length;
  assert.equal(turns.length + retries, throws);
  assert.ok(turns.length > 20);
  // go drop 0: the first throw again with the same dice
  const r0 = room.debug("go drop 0");
  assert.equal(r0.turn, 0);
  assert.deepEqual(r0.room.events.slice(0, turns[0].at + 1), room.events.slice(0, turns[0].at + 1));
  // go drop 10 and -1: the events before that turn stay; the throw has the same dice
  for (const [cmd, k] of [["rewind 10", 10], ["go drop -1", turns.length - 2]]) {
    const r = room.debug(cmd);
    assert.equal(r.turn, k);
    assert.deepEqual(r.room.events.slice(0, turns[k].at + 1), room.events.slice(0, turns[k].at + 1));
    assert.deepEqual(diceTurns(su, r.room.events).length >= k + 1, true);
  }
  // drop dice: the last turn with the given dice; the number of dice must fit
  const last = turns[turns.length - 1], n = last.dice[0].length;
  const dice = n === 3 ? [4, 2, 5] : n === 2 ? [3, 6] : [5];
  const rd = room.debug(`roll dice ${dice.join(",")}`);
  assert.deepEqual(rd.room.events[last.at], { dice });
  assert.deepEqual(rd.room.events.slice(0, last.at), room.events.slice(0, last.at));
  assert.throws(() => room.debug(`drop dice ${[1, 2, 3, 4].slice(0, n === 2 ? 3 : 2).join(",")}`), /dice/);
  assert.throws(() => room.debug("go drop 9999"), /no dice turn/);
  // reset: the game from the beginning, with the same players
  const rs = room.debug("reset");
  assert.equal(rs.turn, null);
  assert.deepEqual(rs.room.setup, su);
  assert.ok(diceTurns(su, rs.room.events).length <= 2);
  // a device rebuilds the new game from its events
  const device = Table.replay(su, rd.room.events);
  assert.equal(fingerprint(device.game), rd.room.fingerprint());
});

// ---------------------------------------------------------------- voice chat (server/voice.js)
import { cleanId, iceList, sfu, voiceCan, voiceReady } from "../server/voice.js";

test("voice: only a ticked player may talk, and only while the server-wide switch is on", () => {
  const players = [{ isAi: true }, { user: 3 }, { user: 5 }];
  assert.equal(voiceCan(players, [1], [3], true), true);
  assert.equal(voiceCan(players, [2], [3], true), false);       // not ticked
  assert.equal(voiceCan(players, [1, 2], [3], true), true);     // one of the device's seats is enough
  assert.equal(voiceCan(players, [1], [3], false), false);      // the switch is off
  assert.equal(voiceCan(players, [0], [3], true), false);       // a computer seat
  assert.equal(voiceCan(players, [], [3], true), false);
  assert.equal(voiceReady({ REALTIME_APP_ID: "a" }), false);
  assert.equal(voiceReady({ REALTIME_APP_ID: "a", REALTIME_APP_TOKEN: "t" }), true);
});

test("voice: ids from a page are short and plain; TURN answers become a list", () => {
  assert.equal(cleanId("abc-12_x"), "abc-12_x");
  assert.equal(cleanId("../x"), null);
  assert.equal(cleanId(5), null);
  assert.deepEqual(iceList({ iceServers: { urls: ["turns:t:443"], username: "u", credential: "c" } }),
    [{ urls: ["turns:t:443"], username: "u", credential: "c" }]);
  assert.deepEqual(iceList({ iceServers: [{ urls: "stun:s" }] }), [{ urls: "stun:s" }]);
  assert.equal(iceList(null)[0].urls, "stun:stun.cloudflare.com:3478");
});

test("voice: the SFU is asked with the server's token; its errors become errors", async () => {
  const calls = [];
  const fake = async (url, init) => {
    calls.push({ url, init, body: init.body && JSON.parse(init.body) });
    if (url.endsWith("/sessions/new")) return new Response(JSON.stringify({ sessionId: "S1" }));
    if (url.includes("/turn/")) return new Response(JSON.stringify({ iceServers: [{ urls: "turns:x:443" }] }));
    if (url.endsWith("/renegotiate")) return new Response(JSON.stringify({ errorCode: "bad", errorDescription: "no" }));
    return new Response(JSON.stringify({ sessionDescription: { type: "answer", sdp: "v=0" }, tracks: [] }));
  };
  const env = { REALTIME_APP_ID: "APP", REALTIME_APP_TOKEN: "TOK" };
  const api = sfu(env, fake);
  assert.equal(await api.session(), "S1");
  assert.equal(calls[0].url, "https://rtc.live.cloudflare.com/v1/apps/APP/sessions/new");
  assert.equal(calls[0].init.headers.authorization, "Bearer TOK");
  await api.push("S1", "v=0 offer", [{ mid: 0, trackName: "mic-a" }]);
  assert.deepEqual(calls[1].body, { sessionDescription: { type: "offer", sdp: "v=0 offer" }, tracks: [{ location: "local", mid: "0", trackName: "mic-a" }] });
  await api.pull("S2", [{ sessionId: "S1", trackName: "mic-a" }]);
  assert.deepEqual(calls[2].body.tracks, [{ location: "remote", sessionId: "S1", trackName: "mic-a" }]);
  await assert.rejects(api.renegotiate("S2", "v=0 answer"), /voice: no/);
  assert.equal(calls[3].init.method, "PUT");
  assert.equal((await api.ice())[0].urls, "stun:stun.cloudflare.com:3478");              // no TURN key: STUN only
  assert.equal((await sfu({ ...env, TURN_KEY_ID: "K", TURN_KEY_TOKEN: "T" }, fake).ice())[0].urls, "turns:x:443");
});

test("a page without rules follows the game from the server's frames (server/frames.js, js/view.js)", async () => {
  const { RemoteTable, frameParts } = await import("../js/view.js");
  const { fingerprint: fp } = await import("../js/table.js");
  for (const [colors, mode, seats] of [[6, "two", twoSeats(1, "ai", 2)], [4, "one", [{ user: 1, colors: [0] }, { ai: true, colors: [1] }, { user: 2, colors: [2] }]]]) {
    const setup = checkSetup({ mode, colors, seats }, users);
    const room = new Room(setup, [], mulberry32(7));
    const page = new RemoteTable(setup, room.events, JSON.parse(JSON.stringify(room.gameView())));
    const rnd = mulberry32(3);
    const same = () => {
      const g = room.table.game, v = page.game;
      assert.deepEqual(v.state.pos, g.state.pos);
      assert.deepEqual(v.state.scores, g.state.scores);
      assert.equal(v.turn, g.turn);
      assert.equal(v.over, g.over);
      assert.deepEqual(v.log.length, g.log.length);
      assert.deepEqual(v.structures(v.state), g.structures(g.state));
      if (g.pending && !g.over) {
        assert.equal(v.pending.kind, g.pending.kind);
        assert.equal(v.pending.options.length, g.pending.options.length);
        if (g.pending.kind === "play") assert.equal(v.sequences().length, g.sequences(g.pending).length);
      }
    };
    same();
    for (let k = 0; k < 400 && !room.table.game.over; k++) {
      const d = room.table.game.pending, pick = Math.floor(rnd() * d.options.length);
      const r = JSON.parse(JSON.stringify(room.move(room.events.length, { pick }, [0, 2])));
      assert.equal(r.frames.length, r.events.length);
      r.events.forEach((ev, i) => {
        const { opt, entries } = frameParts(r.frames[i]);
        if (ev.pick !== undefined) assert.ok(opt);
        if (entries) for (const e of entries) assert.ok(e.before.pos && e.after.pos && e.step.mover);
        page.apply(ev, r.frames[i]);
      });
      same();
    }
    assert.equal(fp(room.table.game), room.fingerprint());
    // replay mode: the game at a point and the frames after it agree with the live game
    const h = room.history(10, 20);
    assert.equal(h.frames.length, 10);
    const back = new RemoteTable(setup, room.events.slice(0, 10), JSON.parse(JSON.stringify(h.view)));
    room.events.slice(10, 20).forEach((ev, i) => back.apply(ev, JSON.parse(JSON.stringify(h.frames[i]))));
    assert.deepEqual(back.game.state.pos, Table.replay(setup, room.events.slice(0, 20)).game.state.pos);
    assert.ok(room.turns().length > 2);
  }
});

test("replay mode: a step forward does not throw the dice of the turn before again (js/view.js)", async () => {
  const { RemoteTable } = await import("../js/view.js");
  const setup = checkSetup({ mode: "two", colors: 6, seats: twoSeats(1, "ai", 2) }, users);
  const room = new Room(setup, [], mulberry32(5));
  for (let k = 0; k < 60 && !room.table.game.over; k++) room.move(room.events.length, { pick: 0 }, [0, 2]);
  const turns = room.turns(), [a, b, c] = turns.slice(3, 6).map(x => x.at);
  // the page jumps to a turn, then steps forward twice; each answer comes from a game built anew
  const h = room.history(a, a), page = new RemoteTable(setup, room.events.slice(0, a), JSON.parse(JSON.stringify(h.view)));
  for (const [n, m] of [[a, b], [b, c]]) {
    const step = JSON.parse(JSON.stringify(room.history(n, m)));
    room.events.slice(n, m).forEach((ev, i) => {
      const before = page.game.lastDice;
      page.apply(ev, step.frames[i]);
      // (a pick that keeps two of three dice makes a new pair: another throw for the page)
      const same = page.game.lastDice.join() === before.join();
      if (!ev.dice && same) assert.equal(page.game.lastDice, before, `event ${n + i}: the same throw stays the same array`);
      else assert.notEqual(page.game.lastDice, before, `event ${n + i}: a new throw is a new array`);
    });
  }
});

test("the admin's game rules: checked, defaults left out, kept with the room", () => {
  const r = cleanRules({ all: { general_points: 80, marshal_points: 100, walls: false, tunnel_costs: [80, 120, 160] },
    6: { color_bonus: 70 }, 4: { color_bonus: 25, corridor_points: [2, 4, 8, 12] }, 8: {} });
  assert.deepEqual(r, { all: { general_points: 80, walls: false }, 6: { color_bonus: 70 }, 8: {}, 4: { corridor_points: [2, 4, 8, 12] } });
  assert.deepEqual(rulesFor(r, 4), { general_points: 80, walls: false, corridor_points: [2, 4, 8, 12] });
  assert.equal(rulesFor(cleanRules({}), 6), null);
  assert.equal(ruleDefaults()[4].color_bonus, 25);
  const bad = [
    { all: { general_points: 100 } },                 // a marshal needs more
    { all: { walls: "no" } },
    { all: { gate_points: 1.5 } },
    { all: { gate_points: -1 } },
    { 6: { corridor_points: [1, 2, 3] } },            // one per corridor
    { 4: { tunnel_last_corridor: 4 } },               // the final corridor is never an exit
  ];
  for (const b of bad) assert.throws(() => cleanRules(b), JSON.stringify(b));
  // a room plays by the rules in its setup; the one-color game stays traditional
  const su = { ...checkSetup({ mode: "two", colors: 6, seats: twoSeats(1, "ai") }, users), rules: rulesFor(r, 6) };
  const t = new Table(su, { autoDice: true });
  assert.equal(t.game.cfg.general_points, 80);
  assert.equal(t.game.cfg.color_bonus, 70);
  assert.equal(t.game.cfg.walls, false);
  assert.equal(Config.forBoard(6, "beginner", "one", 10, { ranks: true }).ranks, false);
  assert.equal(editSetup(su, [{ user: 2 }, { ai: true }], users).setup.rules, su.rules);
});

test("the admin page has every text in every language, the game rules included", () => {
  const en = Object.keys(ADMIN_STR.en);
  for (const l of LANGS) {
    assert.ok(ADMIN_STR[l], l);
    for (const k of en) assert.ok(ADMIN_STR[l][k], `${l}: ${k}`);
    if (l === "en") continue;
    for (const r of Config.RULES) {
      assert.ok(ADMIN_STR[l]["rule_" + r.key], `${l}: rule_${r.key}`);
      assert.ok(ADMIN_STR[l]["grp_" + r.group], `${l}: grp_${r.group}`);
    }
  }
});

test("each step of a play carries the points of its captures so far (server/frames.js scoredStates)", async () => {
  const { playEntries } = await import("../server/frames.js");
  const setup = { mode: "two", colors: 6, players: [{ name: "A", colors: [0, 3], isAi: true }, { name: "B", colors: [1, 4], isAi: true }] };
  let early = 0, plays = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const room = new Room(setup, [], mulberry32(seed));
    const t = Table.replay(setup, []);
    for (const ev of room.events) {
      const g = t.game, dec = g.pending;
      const play = ev.pick !== undefined && dec.kind === "play" ? dec.options[ev.pick].payload : null;
      const e = play && play.steps ? playEntries(g, play) : null;
      const scores0 = g.state.scores.slice();
      t.apply(ev);
      if (!e || !e.length) continue;
      plays++;
      // the last step shows what the play scored: ranks and earned points as in the game after it
      assert.deepEqual(e[e.length - 1].after.kills, t.game.state.kills);
      assert.deepEqual(e[e.length - 1].after.earned, t.game.state.earned);
      if (e.length > 1 && e[0].step.captures.length && e[0].after.scores[dec.player] > scores0[dec.player]) early++;
    }
  }
  assert.ok(plays > 100);
  assert.ok(early > 0, "a capture with the first die scores at once");
});
