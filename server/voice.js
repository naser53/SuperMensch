// Voice chat (v3.0.0): the server side, with no Cloudflare runtime parts (tested in
// tests/server.test.mjs).
//
// Every device sends its microphone once to Cloudflare Realtime SFU, which passes it on to the
// other devices of the room (a relay, so it also works where direct calls between people are
// blocked). Cloudflare TURN over TLS on port 443 is offered too, when it is set up, for networks
// that only let ordinary HTTPS through. The SFU's app token never leaves the server: the game
// page asks /api/games/<ID>/voice/<op>, the room checks the device, and this file talks to
// Cloudflare.
//
// Secrets (wrangler secret put, or GitHub secrets deployed by server.yml):
//   REALTIME_APP_ID, REALTIME_APP_TOKEN   Realtime SFU application (needed for voice at all)
//   TURN_KEY_ID, TURN_KEY_TOKEN           Realtime TURN key (optional: better reach through filters)
//   REALTIME_API                          (tests only) another address for the SFU API
//
// Who may talk (owner, 2026-11-04): the admin ticks "voice" per player and has one switch for the
// whole server. A device may send its microphone when the switch is on and one of its seats
// belongs to a ticked player. Every device in the room hears the others.

export const SFU_BASE = "https://rtc.live.cloudflare.com/v1";
const STUN = [{ urls: "stun:stun.cloudflare.com:3478" }];

// the SFU can be used: both of its secrets are there
export const voiceReady = env => !!(env && env.REALTIME_APP_ID && env.REALTIME_APP_TOKEN);

// may a device with these seats send its microphone?  players: the room's setup.players;
// allowed: the user ids the admin ticked; on: the server-wide switch
export function voiceCan(players, seats, allowed, on) {
  if (!on || !Array.isArray(seats)) return false;
  const ok = new Set((allowed || []).map(Number));
  return seats.some(s => players[s] && !players[s].isAi && ok.has(Number(players[s].user)));
}

// the TURN answer comes in two shapes (an object or a list); always give a list for RTCPeerConnection
export function iceList(answer) {
  const s = answer && answer.iceServers;
  const list = Array.isArray(s) ? s : s ? [s] : [];
  return list.length ? list : STUN;
}

// the SFU's answer: an error code becomes an error
async function answer(r) {
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.errorCode) throw new Error("voice: " + (d.errorDescription || d.errorCode || r.status));
  return d;
}

// Cloudflare Realtime, used by the room. fetchFn can be replaced in tests.
export function sfu(env, fetchFn = fetch) {
  const app = `${env.REALTIME_API || SFU_BASE}/apps/${env.REALTIME_APP_ID}`;
  const call = (method, path, body) => fetchFn(app + path, {
    method, headers: { authorization: `Bearer ${env.REALTIME_APP_TOKEN}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body) }).then(answer);
  return {
    // ICE servers for the page: TURN (relay over UDP, TCP and TLS 443) when its key is set, else STUN
    async ice() {
      if (!env.TURN_KEY_ID || !env.TURN_KEY_TOKEN) return STUN;
      try {
        const r = await fetchFn(`${SFU_BASE}/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
          method: "POST", headers: { authorization: `Bearer ${env.TURN_KEY_TOKEN}`, "content-type": "application/json" },
          body: JSON.stringify({ ttl: 6 * 3600 }) });
        if (!r.ok) return STUN;
        return iceList(await r.json());
      } catch { return STUN; }
    },
    session: () => call("POST", "/sessions/new").then(d => d.sessionId),
    // send this device's microphone: the page's offer, the answer back
    push: (sid, sdp, tracks) => call("POST", `/sessions/${sid}/tracks/new`, {
      sessionDescription: { type: "offer", sdp },
      tracks: tracks.map(t => ({ location: "local", mid: String(t.mid), trackName: String(t.trackName) })) }),
    // hear other devices: the SFU sends an offer the page answers (renegotiate)
    pull: (sid, tracks) => call("POST", `/sessions/${sid}/tracks/new`, {
      tracks: tracks.map(t => ({ location: "remote", sessionId: String(t.sessionId), trackName: String(t.trackName) })) }),
    renegotiate: (sid, sdp) => call("PUT", `/sessions/${sid}/renegotiate`, { sessionDescription: { type: "answer", sdp } }),
    // stop a microphone on the SFU (the admin took the right away, or the device left)
    close: (sid, mids) => call("PUT", `/sessions/${sid}/tracks/close`, { tracks: mids.map(mid => ({ mid: String(mid) })), force: true }),
  };
}

// a session id or track name from a page: short and plain
export const cleanId = v => (typeof v === "string" && /^[\w-]{1,128}$/.test(v) ? v : null);
