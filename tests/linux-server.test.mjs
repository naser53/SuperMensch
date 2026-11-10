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
