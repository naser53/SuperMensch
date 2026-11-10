// The Linux server (server/node/): the Worker's code on Node, with SQLite files and WebSockets.
// Starts it on a free port with an empty data folder.   npm test
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";

const KEY = "test-key";
const H = { "content-type": "application/json", "x-admin-key": KEY };

async function start(dataDir) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const p = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "server/node/main.mjs"],
    { env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ADMIN_KEY: KEY }, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  p.stdout.on("data", d => (log += d)); p.stderr.on("data", d => (log += d));
  for (let i = 0; i < 100 && !log.includes("on port"); i++) await new Promise(r => setTimeout(r, 50));
  assert.ok(log.includes("on port"), log);
  return { base: `http://localhost:${port}`, port, stop: () => new Promise(r => { p.on("exit", r); p.kill(); }) };
}

const hello = (port, id, passkey) => new Promise((ok, bad) => {
  const ws = new WebSocket(`ws://localhost:${port}/api/games/${id}/ws`);
  ws.on("open", () => ws.send(JSON.stringify({ t: "hello", device: "test", token: "t1", seats: [0], passkey })));
  ws.on("message", d => { const m = JSON.parse(d); if (m.t === "state") { ws.close(); ok(m); } });
  ws.on("error", bad);
  setTimeout(() => bad(new Error("no state")), 5000);
});

test("the Linux server serves the pages, makes rooms, plays over a WebSocket and keeps the games", async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "sm-"));
  let s = await start(data);
  try {
    if (fs.existsSync("server/public/index.html")) assert.equal((await fetch(s.base + "/")).status, 200);   // after npm run build
    assert.equal((await fetch(s.base + "/admin")).status, 200);
    assert.equal((await fetch(s.base + "/%2e%2e/package.json")).status, 404);
    assert.equal((await (await fetch(s.base + "/api/users")).json()).length > 0, true);
    const mk = await (await fetch(s.base + "/api/games", { method: "POST", headers: H,
      body: JSON.stringify({ name: "T", setup: { mode: "two", colors: 4, seats: [{ user: 1, colors: [1, 3] }, { ai: true, colors: [0, 2] }] } }) })).json();
    assert.ok(mk.id);
    const all = await (await fetch(s.base + "/api/admin/games", { method: "POST", headers: H, body: "{}" })).json();
    const pk = all.find(g => g.id === mk.id).passkey;
    const st = await hello(s.port, mk.id, pk);
    assert.deepEqual(st.mine, [0]);
    assert.ok(st.game && st.game.pending);
    const dump = await (await fetch(s.base + "/api/admin/export", { method: "POST", headers: H, body: "{}" })).json();
    assert.ok(dump.rooms[mk.id].meta.length);
    await s.stop();
    s = await start(data);                                // the games stay after a restart
    const g = await (await fetch(`${s.base}/api/games/${mk.id}`)).json();
    assert.equal(g.name, "T");
    // a copy into an empty server gives the same game
    const data2 = fs.mkdtempSync(path.join(os.tmpdir(), "sm-"));
    const s2 = await start(data2);
    try {
      const r = await (await fetch(s2.base + "/api/admin/import", { method: "POST", headers: H, body: JSON.stringify(dump) })).json();
      assert.equal(r.rooms, 1);
      const g2 = await (await fetch(`${s2.base}/api/games/${mk.id}`)).json();
      assert.equal(g2.fp, g.fp);
      assert.equal((await (await fetch(s2.base + "/api/games")).json()).length, 1);
    } finally { await s2.stop(); }
  } finally { await s.stop(); }
});

// voice on the Linux server: its own relay and peer to peer, nothing from Cloudflare (owner, 2026-11-10)
import { localSfu, turnServers } from "../server/node/sfu.mjs";
import crypto from "node:crypto";

test("voice on the Linux server: TURN passwords from the shared secret; the own relay answers like an SFU", async () => {
  const t = turnServers("S3CRET", "example.org", 3600, 1_000_000_000_000);
  assert.equal(t[1].username, "1000003600:sm");
  assert.equal(t[1].credential, crypto.createHmac("sha1", "S3CRET").update("1000003600:sm").digest("base64"));
  assert.deepEqual(t[1].urls, ["turn:example.org:3478?transport=udp", "turn:example.org:3478?transport=tcp"]);
  assert.equal(turnServers(null, null)[0].urls.startsWith("stun:"), true);
  const sfu = localSfu({ ip: "127.0.0.1" });
  const sid = await sfu.session();
  assert.match(sid, /^\w{32}$/);
  await assert.rejects(sfu.push("nope", "v=0", []), /no such session/);
  const r = await sfu.pull(sid, [{ sessionId: "x", trackName: "mic-x" }]);     // nothing there to hear
  assert.equal(r.tracks[0].errorCode, "not_found");
  await sfu.close(sid, []);
  assert.equal(sfu.sessions.size, 0);
});

const open = (port, id, passkey, token, seats) => new Promise((ok, bad) => {
  const ws = new WebSocket(`ws://localhost:${port}/api/games/${id}/ws`);
  const got = [];
  ws.on("open", () => ws.send(JSON.stringify({ t: "hello", device: token, token, seats, passkey })));
  ws.on("message", d => { const m = JSON.parse(d); got.push(m); if (m.t === "state") ok({ ws, got, state: m }); });
  ws.on("error", bad);
});

test("voice on the Linux server: the admin picks the mode; peer to peer, offers and answers go between the devices", async () => {
  const s = await start(fs.mkdtempSync(path.join(os.tmpdir(), "sm-")));
  try {
    const post = async (p, b) => (await fetch(`${s.base}/api/${p}`, { method: "POST", headers: H, body: JSON.stringify(b) })).json();
    const set = await (await fetch(s.base + "/api/settings")).json();
    assert.equal(set.voice.relay, true);                       // the own relay, with no keys at all
    assert.equal(set.voice.mode, "relay");
    assert.equal((await post("admin/voicemode", { mode: "p2p" })).voice.mode, "p2p");
    await post("admin/uservoice", { id: 1, on: true });
    const mk = await post("games", { name: "V", setup: { mode: "two", colors: 4, seats: [{ user: 1, colors: [1, 3] }, { user: 2, colors: [0, 2] }] } });
    const pk = (await post("admin/games", {})).find(g => g.id === mk.id).passkey;
    const a = await open(s.port, mk.id, pk, "ta", [0]), b = await open(s.port, mk.id, pk, "tb", [1]);
    assert.deepEqual(a.state.voice, { on: true, can: true, mode: "p2p" });
    assert.equal(b.state.voice.can, false);                    // user 2 is not ticked: hears only
    const voice = (token, op, x = {}) => fetch(`${s.base}/api/games/${mk.id}/voice`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op, token, ...x }) }).then(r => r.json());
    const { sessionId: ma } = await voice("ta", "session");
    assert.deepEqual(await voice("ta", "push", { sid: ma, mid: "0", track: "mic-a" }), {});
    const { sessionId: lb } = await voice("tb", "session");
    assert.match((await voice("tb", "push", { sid: lb, mid: "0", track: "mic-b" })).error, /not allowed/);
    const wait = (c, t) => new Promise(ok => { const i = setInterval(() => { const m = c.got.find(x => x.t === t); if (m) { clearInterval(i); ok(m); } }, 20); });
    b.ws.send(JSON.stringify({ t: "rtc", from: lb, to: ma, desc: { type: "offer", sdp: "v=0 offer" } }));
    assert.deepEqual(await wait(a, "rtc"), { t: "rtc", from: lb, to: ma, desc: { type: "offer", sdp: "v=0 offer" } });
    a.ws.send(JSON.stringify({ t: "rtc", from: ma, to: lb, desc: { type: "answer", sdp: "v=0 answer" } }));
    assert.equal((await wait(b, "rtc")).desc.sdp, "v=0 answer");
    a.ws.close(); b.ws.close();
  } finally { await s.stop(); }
});
