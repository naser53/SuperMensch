// SuperMensch online server (Cloudflare Worker).
//   Lobby     one Durable Object: users, the list of games and their results
//   GameRoom  one Durable Object per game: setup, events, the devices' WebSockets
// Pages come from server/public: / is the game (built from js/, with the room list on its first
// page), /admin the admin page. Security is light on purpose (family use): no passwords for
// players; only the admin key (secret ADMIN_KEY) renames users and makes and deletes rooms.

import { DurableObject } from "cloudflare:workers";
import { OPEN_HOURS, Room, USERS, checkSetup, claimSeats, cleanName, editSetup, isGameId, newGameId } from "./core.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS } });
// the downloaded game file (file://) asks this server too
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, x-admin-key",
  "access-control-allow-methods": "GET, POST, OPTIONS" };
const fail = (msg, status = 400) => json({ error: msg }, status);

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/play") return Response.redirect(new URL("/" + url.search, url).href, 301);   // old links
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    try { return await api(req, env, url); }
    catch (e) { return fail(String(e.message || e)); }
  },
};

async function api(req, env, url) {
  const lobby = env.LOBBY.get(env.LOBBY.idFromName("lobby"));
  const parts = url.pathname.split("/").filter(Boolean).slice(1);   // after "api"
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : null;
  const adminOk = !!env.ADMIN_KEY && req.headers.get("x-admin-key") === env.ADMIN_KEY;

  if (parts[0] === "users" && req.method === "GET") return json(await lobby.users());
  if (parts[0] === "admin") {
    if (!adminOk) return fail("wrong admin key", 403);
    if (parts[1] === "check") return json({ ok: true });
    if (parts[1] === "rename" && body) return json(await lobby.rename(body.id, body.name));
    if (parts[1] === "games") return json(await lobby.allGames());
    if (parts[1] === "edit" && body && isGameId(body.id)) {        // who plays in a room (a test aid)
      const old = await lobby.setupOf(body.id);
      if (!old) return fail("no such game", 404);
      const { setup, keep } = editSetup(old, body.seats, await lobby.users());
      await env.ROOM.get(env.ROOM.idFromName(body.id)).edit(setup, keep);
      return json(await lobby.setSetup(body.id, setup));
    }
    if (parts[1] === "delete" && body && isGameId(body.id)) {      // a test room: gone from the lists and the server
      await env.ROOM.get(env.ROOM.idFromName(body.id)).remove();
      return json(await lobby.removeGame(body.id));
    }
  }
  if (parts[0] === "games" && parts.length === 1) {
    if (req.method === "GET") {        // with the seats held right now by a connected device
      const gs = await lobby.openGames();
      await Promise.all(gs.map(async g => { g.held = Object.keys(await env.ROOM.get(env.ROOM.idFromName(g.id)).held()).map(Number); }));
      return json(gs);
    }
    if (req.method === "POST") {
      const users = await lobby.users();
      if (!adminOk) return fail("only the admin makes rooms", 403);
      const name = cleanName(body.name);
      if (!name) return fail("the game needs a name");
      const setup = checkSetup(body.setup, users);
      const id = await lobby.addGame(name, setup);
      const room = env.ROOM.get(env.ROOM.idFromName(id));
      await room.init(id, name, setup);
      return json({ id, name });
    }
  }
  if (parts[0] === "history" && req.method === "GET") return json(await lobby.history());
  if (parts[0] === "games" && isGameId(parts[1])) {
    const room = env.ROOM.get(env.ROOM.idFromName(parts[1]));
    if (parts[2] === "ws") return room.fetch(req);
    if (req.method === "GET") {
      const s = await room.snapshot();
      return s ? json(s) : fail("no such game", 404);
    }
  }
  return fail("not found", 404);
}

export class Lobby extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS games (id TEXT PRIMARY KEY, name TEXT NOT NULL,
      created INTEGER, updated INTEGER, status TEXT, setup TEXT, result TEXT)`);
    const cols = this.sql.exec(`PRAGMA table_info(users)`).toArray().map(c => c.name);
    if (!cols.includes("can_create")) this.sql.exec(`ALTER TABLE users ADD COLUMN can_create INTEGER NOT NULL DEFAULT 0`);
    if (!this.sql.exec(`SELECT COUNT(*) AS n FROM users`).one().n)
      for (let i = 1; i <= USERS; i++) this.sql.exec(`INSERT INTO users (id, name) VALUES (?, ?)`, i, `user${i}`);
  }

  users() {
    return this.sql.exec(`SELECT id, name FROM users ORDER BY id`).toArray().map(u => ({ id: u.id, name: u.name }));
  }


  rename(id, name) {
    name = cleanName(name);
    if (!name) throw new Error("empty name");
    if (!this.sql.exec(`SELECT id FROM users WHERE id = ?`, id | 0).toArray().length) throw new Error("no such user");
    if (this.sql.exec(`SELECT id FROM users WHERE name = ? AND id != ?`, name, id | 0).toArray().length) throw new Error("name taken");
    this.sql.exec(`UPDATE users SET name = ? WHERE id = ?`, name, id | 0);
    return this.users();
  }

  addGame(name, setup) {
    let id;
    do id = newGameId(); while (this.sql.exec(`SELECT id FROM games WHERE id = ?`, id).toArray().length);
    const now = Date.now();
    this.sql.exec(`INSERT INTO games (id, name, created, updated, status, setup) VALUES (?, ?, ?, ?, 'open', ?)`,
      id, name, now, now, JSON.stringify(setup));
    return id;
  }

  // a room reports activity, and the result once the game is over
  touch(id, over, result) {
    this.sql.exec(`UPDATE games SET updated = ?, status = ?, result = ? WHERE id = ?`,
      Date.now(), over ? "over" : "open", result ? JSON.stringify(result) : null, id);
  }

  openGames() {
    const since = Date.now() - OPEN_HOURS * 3600e3;
    return this.sql.exec(`SELECT id, name, created, updated, setup FROM games WHERE status = 'open' AND updated > ?
      ORDER BY updated DESC`, since).toArray().map(r => {
      const su = JSON.parse(r.setup);
      return { id: r.id, name: r.name, created: r.created, updated: r.updated, mode: su.mode, colors: su.colors,
        players: su.players.map(p => ({ name: p.name, isAi: p.isAi, user: p.user })) };
    });
  }

  allGames() {
    return this.sql.exec(`SELECT id, name, created, updated, status, setup FROM games ORDER BY updated DESC`).toArray()
      .map(g => ({ ...g, setup: JSON.parse(g.setup) }));
  }

  setupOf(id) {
    const r = this.sql.exec(`SELECT setup FROM games WHERE id = ?`, id).toArray();
    return r.length ? JSON.parse(r[0].setup) : null;
  }

  setSetup(id, setup) {
    this.sql.exec(`UPDATE games SET setup = ?, status = 'open', result = NULL, updated = ? WHERE id = ?`, JSON.stringify(setup), Date.now(), id);
    return this.allGames();
  }

  removeGame(id) {
    this.sql.exec(`DELETE FROM games WHERE id = ?`, id);
    return this.allGames();
  }

  history() {
    return this.sql.exec(`SELECT id, name, created, updated, result FROM games WHERE status = 'over'
      ORDER BY updated DESC LIMIT 200`).toArray().map(r => ({ ...r, result: JSON.parse(r.result) }));
  }
}

// WebSocket messages (JSON):
//   device -> room  { t: "hello", device, token, seats: [0, 2] }   which seats this device plays
//                   { t: "leave" }                           Exit: free this device's seats
//                   { t: "move", seq, ev: { pick } }         seq = events the device has seen
//   room -> device  { t: "state", id, name, setup, events, seats, fp, view, mine, taken }
//                   (mine: the seats this device got; taken: wanted seats another device holds)
//                   { t: "events", from, events, fp, view }  sent to every device
//                   { t: "seats", seats }                    who holds which seat
//                   { t: "refused", reason, seq }
export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this._tables();
    this.room = null;
  }

  _tables() {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY, ev TEXT NOT NULL)`);
  }

  // the admin changes who plays: the same number of seats keeps the moves, another starts again.
  // The devices are sent back to the first page (code 4001), where they pick their names again.
  async edit(setup, keep) {
    const room = this._load();
    if (!room) throw new Error("no such game");
    const events = keep ? room.events.slice() : [];
    if (!keep) this.sql.exec(`DELETE FROM events`);
    this.sql.exec(`UPDATE meta SET v = ? WHERE k = 'setup'`, JSON.stringify(setup));
    this.room = new Room(setup, events);
    this._save(keep ? events.length : 0);
    for (const ws of this.ctx.getWebSockets()) { try { ws.close(4001, "players changed"); } catch { /* closed */ } }
    await this._report();
  }

  // the admin deletes the game: close the devices' connections and forget everything
  async remove() {
    for (const ws of this.ctx.getWebSockets()) { try { ws.close(4000, "game deleted"); } catch { /* closed */ } }
    await this.ctx.storage.deleteAll();
    this.room = null;
    this._tables();
  }

  _meta(k) {
    const r = this.sql.exec(`SELECT v FROM meta WHERE k = ?`, k).toArray();
    return r.length ? JSON.parse(r[0].v) : null;
  }

  _load() {
    if (this.room) return this.room;
    const setup = this._meta("setup");
    if (!setup) return null;
    const events = this.sql.exec(`SELECT ev FROM events ORDER BY seq`).toArray().map(r => JSON.parse(r.ev));
    this.room = new Room(setup, events);
    this._save(events.length);        // a throw made while loading (should not happen, but keep the list whole)
    return this.room;
  }

  _save(from) {
    const evs = this.room.events;
    for (let i = from; i < evs.length; i++)
      this.sql.exec(`INSERT OR REPLACE INTO events (seq, ev) VALUES (?, ?)`, i, JSON.stringify(evs[i]));
  }

  async init(id, name, setup) {
    if (this._meta("setup")) throw new Error("game exists");
    this.sql.exec(`INSERT INTO meta (k, v) VALUES ('id', ?), ('name', ?), ('setup', ?)`,
      JSON.stringify(id), JSON.stringify(name), JSON.stringify(setup));
    this.room = new Room(setup, []);
    this._save(0);
    await this._report();
  }

  snapshot() {
    const room = this._load();
    if (!room) return null;
    return { id: this._meta("id"), name: this._meta("name"), setup: room.setup, events: room.events,
      seats: this._seats(), fp: room.fingerprint(), view: room.view() };
  }

  async fetch(req) {
    if (req.headers.get("upgrade") !== "websocket") return new Response("expected a WebSocket", { status: 426 });
    if (!this._load()) return new Response("no such game", { status: 404 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ device: "?", seats: [] });
    return new Response(null, { status: 101, webSocket: client });
  }

  held() { return this._seats(); }

  // seat -> device name, for every seat held by a connected device
  _seats() {
    const out = {};
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() || {};
      for (const s of a.seats || []) out[s] = a.device;
    }
    return out;
  }

  _send(ws, msg) { try { ws.send(JSON.stringify(msg)); } catch { /* closed */ } }
  _all(msg) { for (const ws of this.ctx.getWebSockets()) this._send(ws, msg); }

  async webSocketMessage(ws, data) {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    const room = this._load();
    if (msg.t === "hello") {
      const humans = room.setup.players.map((p, i) => (p.isAi ? -1 : i)).filter(i => i >= 0);
      const old = ws.deserializeAttachment() || {};
      const token = msg.token ? String(msg.token).slice(0, 64) : old.token || null;
      const device = msg.device ? String(msg.device).slice(0, 40) : old.device || "?";
      const others = this.ctx.getWebSockets().filter(o => o !== ws).map(o => ({ ws: o, ...(o.deserializeAttachment() || {}) }));
      // a seat stays with a connected device until it leaves; the same browser takes it back
      const { seats, taken } = claimSeats(Array.isArray(msg.seats) ? msg.seats : [], humans, others, token);
      for (const o of others)
        if (token && o.token === token && (o.seats || []).some(s => seats.includes(s)))
          o.ws.serializeAttachment({ device: o.device, token: o.token, seats: o.seats.filter(s => !seats.includes(s)) });
      ws.serializeAttachment({ device, token, seats });
      this._send(ws, { t: "state", ...this.snapshot(), mine: seats, taken });
      this._all({ t: "seats", seats: this._seats() });
      return;
    }
    if (msg.t === "leave") {
      ws.serializeAttachment({ device: "?", seats: [] });
      this._all({ t: "seats", seats: this._seats() });
      try { ws.close(1000, "left"); } catch { /* closed */ }
      return;
    }
    if (msg.t === "move") {
      const a = ws.deserializeAttachment() || {};
      let r;
      try { r = room.move(msg.seq, msg.ev, a.seats || []); }
      catch (e) { this._send(ws, { t: "refused", reason: String(e.message || e), seq: room.events.length }); return; }
      this._save(r.from);
      this._all({ t: "events", from: r.from, events: r.events, fp: room.fingerprint(), view: room.view() });
      await this._report();
    }
  }

  webSocketClose(ws) {
    ws.serializeAttachment({ device: "?", seats: [] });
    this._all({ t: "seats", seats: this._seats() });
  }

  async _report() {
    if (!this._meta("id")) return;
    const lobby = this.env.LOBBY.get(this.env.LOBBY.idFromName("lobby"));
    const over = this.room.table.game.over;
    await lobby.touch(this._meta("id"), over, over ? this.room.result() : null);
  }
}
