// The SuperMensch server on Linux (owner, 2026-11-10): the same server code as on Cloudflare
// (server/worker.js), with server/node/runtime.mjs in place of Cloudflare's runtime.
//   node server/node/main.mjs          (Node 22.13 or newer; npm run build first for the pages)
// Settings come from the environment (on the server: /etc/supermensch.env, see tools/linux/):
//   PORT (default 8080), DATA_DIR (default ./data: the SQLite files), ADMIN_KEY, and for voice
//   chat REALTIME_APP_ID, REALTIME_APP_TOKEN, TURN_KEY_ID, TURN_KEY_TOKEN (as the Worker's secrets).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

register("./hooks.mjs", import.meta.url);
const { default: worker, Lobby, GameRoom } = await import("../worker.js");
const { isGameId } = await import("../core.js");
const { Namespace, Socket, queued } = await import("./runtime.mjs");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PUBLIC = path.join(root, "server/public");
const PORT = Number(process.env.PORT) || 8080;
const DATA = path.resolve(process.env.DATA_DIR || path.join(root, "data"));

const SECRETS = ["ADMIN_KEY", "REALTIME_APP_ID", "REALTIME_APP_TOKEN", "TURN_KEY_ID", "TURN_KEY_TOKEN", "REALTIME_API"];
const env = Object.fromEntries(SECRETS.filter(k => process.env[k]).map(k => [k, process.env[k]]));
env.LOBBY = new Namespace(Lobby, path.join(DATA, "lobby"), env);
env.ROOM = new Namespace(GameRoom, path.join(DATA, "rooms"), env);

// the pages (Cloudflare's static assets): /x is x, else x.html, else x/index.html
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg", ".wav": "audio/wav", ".ttf": "font/ttf", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8" };
env.ASSETS = {
  async fetch(req) {
    let p;
    try { p = decodeURIComponent(new URL(req.url).pathname); } catch { return new Response("bad path", { status: 400 }); }
    const base = path.join(PUBLIC, path.normalize(p));
    if (!base.startsWith(PUBLIC)) return new Response("not found", { status: 404 });
    for (const f of [base, base + ".html", path.join(base, "index.html")]) {
      if (fs.existsSync(f) && fs.statSync(f).isFile())
        return new Response(fs.readFileSync(f), { headers: { "content-type": TYPES[path.extname(f)] || "application/octet-stream", "cache-control": "no-cache" } });
    }
    return new Response("not found", { status: 404 });
  },
};

const readBody = req => new Promise((ok, bad) => {
  const parts = [];
  req.on("data", c => parts.push(c)).on("end", () => ok(Buffer.concat(parts))).on("error", bad);
});

const server = http.createServer(async (req, res) => {
  try {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
    const r = await worker.fetch(new Request(`http://${req.headers.host || "localhost"}${req.url}`, { method: req.method, headers, body }), env);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(req.method === "HEAD" ? undefined : Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
    res.end("server error");
  }
});

// a device's WebSocket: /api/games/<ID>/ws (GameRoom.fetch on Cloudflare)
const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
server.on("upgrade", (req, sock, head) => {
  const m = /^\/api\/games\/([^/?]+)\/ws(?:\?|$)/.exec(req.url);
  const refuse = (code, text) => { sock.end(`HTTP/1.1 ${code} ${text}\r\nconnection: close\r\n\r\n`); };
  if (!m || !isGameId(m[1])) return refuse(404, "Not Found");
  const room = env.ROOM.object(m[1]);
  if (!room._load()) return refuse(404, "Not Found");
  wss.handleUpgrade(req, sock, head, ws => {
    const s = new Socket(ws);
    room.accept(s);
    ws.on("message", (data, binary) => queued(room, () => room.webSocketMessage(s, binary ? data : data.toString())));
    ws.on("close", (code, reason) => queued(room, async () => {
      try { await room.webSocketClose(s, code, reason.toString(), true); } finally { room.ctx.sockets.delete(s); }
    }));
    ws.on("error", e => console.error("ws", e.message));
  });
});

server.listen(PORT, () => console.log(`SuperMensch on port ${PORT}, data in ${DATA}${env.ADMIN_KEY ? "" : " (no ADMIN_KEY: the admin page stays locked)"}`));
