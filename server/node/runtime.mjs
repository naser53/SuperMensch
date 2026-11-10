// The part of Cloudflare's runtime that server/worker.js uses, for the Linux server (owner,
// 2026-11-10: the game runs on Cloudflare and on the owner's Linux server, from the same code).
//   Namespace  a Durable Object binding (env.LOBBY, env.ROOM): one object per name, made when first
//              asked for, each with its own SQLite file (node:sqlite) under the data folder
//   Socket     a device's WebSocket as a Durable Object sees it (attachments, send, close)
// Objects live in this one process, so a call to another object is a plain call.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const sqlValue = v => (typeof v === "boolean" ? (v ? 1 : 0) : v === undefined ? null : v);

// ctx.storage.sql of a Durable Object
class Sql {
  constructor(storage) { this.storage = storage; }
  exec(query, ...params) {
    const rows = this.storage.db.prepare(query).all(...params.map(sqlValue)).map(r => ({ ...r }));
    return {
      toArray: () => rows,
      one: () => { if (rows.length !== 1) throw new Error(`expected one row, got ${rows.length}`); return rows[0]; },
      [Symbol.iterator]: () => rows[Symbol.iterator](),
    };
  }
}

class Storage {
  constructor(file) {
    this.file = file;
    this.open();
    this.sql = new Sql(this);
  }
  open() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.db = new DatabaseSync(this.file);
    this.db.exec("PRAGMA journal_mode = WAL");
  }
  // the object forgets everything (a deleted game): its file goes
  async deleteAll() {
    this.db.close();
    for (const f of [this.file, this.file + "-wal", this.file + "-shm"]) fs.rmSync(f, { force: true });
    this.open();
  }
}

// a device's WebSocket (the "ws" package) as Cloudflare hands it to a Durable Object
export class Socket {
  constructor(ws) { this.ws = ws; this.att = null; }
  send(data) {
    if (this.ws.readyState !== 1) throw new Error("WebSocket is closed");
    this.ws.send(data);
  }
  close(code, reason) { this.ws.close(code, reason); }
  serializeAttachment(a) { this.att = a === undefined ? null : structuredClone(a); }
  deserializeAttachment() { return this.att === null ? null : structuredClone(this.att); }
}

class Ctx {
  constructor(storage) { this.storage = storage; this.sockets = new Set(); }
  acceptWebSocket(ws) { this.sockets.add(ws); }
  getWebSockets() { return [...this.sockets]; }
}

export class Namespace {
  // cls: the Durable Object class; dir: its folder under the data folder; env: the Worker's env
  constructor(cls, dir, env) { this.cls = cls; this.dir = dir; this.env = env; this.objects = new Map(); }
  idFromName(name) { return String(name); }

  // the object itself (made on first use)
  object(id) {
    let o = this.objects.get(id);
    if (!o) {
      const safe = id.replace(/[^A-Za-z0-9_-]/g, "_");
      o = new this.cls(new Ctx(new Storage(path.join(this.dir, safe + ".sqlite"))), this.env);
      o._queue = Promise.resolve();
      this.objects.set(id, o);
    }
    return o;
  }

  // a stub: every method call returns a promise, as a call to a Durable Object does
  get(id) {
    const obj = () => this.object(id);
    return new Proxy({}, {
      get: (_, k) => (k === "then" ? undefined : async (...args) => {
        const o = obj();
        if (typeof o[k] !== "function") throw new Error(`no method ${String(k)}`);
        return o[k](...args);
      }),
    });
  }
}

// One WebSocket event at a time per object, in order (as Cloudflare delivers them).
export function queued(obj, fn) {
  const p = obj._queue.then(fn, fn);
  obj._queue = p.catch(e => console.error(e));
  return p;
}
