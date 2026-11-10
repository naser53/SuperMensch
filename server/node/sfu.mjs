// The server's own voice relay on Linux (owner, 2026-11-10: the VPS needs nothing from Cloudflare).
// A small SFU (selective forwarding unit) inside the game server, built on werift (WebRTC in plain
// JavaScript): every device sends its microphone here once, and the relay forwards it to the
// devices that listen. It answers the same calls as Cloudflare Realtime SFU (server/voice.js, sfu()),
// so the room and the game page are the same for both:
//   session()                          a new session (one RTCPeerConnection here)
//   push(sid, sdp, [{mid, trackName}])  the page's offer with its microphone -> our answer
//   pull(sid, [{sessionId, trackName}]) forward those microphones -> our offer (renegotiate)
//   renegotiate(sid, sdp)               the page's answer to that offer
//   close(sid, [mid])                   stop a microphone
//   ice()                               ICE servers for the page (TURN on this server, when set up)
// Settings (/etc/supermensch.env): VOICE_PORTS (UDP ports, default 40000-40199), VOICE_IP (the
// public address, when the server only sees a private one), TURN_SECRET and TURN_HOST (coturn on
// this server, tools/linux/install.sh).
import crypto from "node:crypto";
import { MediaStreamTrack, RTCPeerConnection, RTCRtpCodecParameters } from "werift";

const IDLE_MS = 60_000;          // a session that never connects, or lost its connection, goes
const OPUS = () => new RTCRtpCodecParameters({ mimeType: "audio/opus", clockRate: 48000, channels: 2, payloadType: 111 });

// TURN credentials for coturn's "use-auth-secret": user "<expiry>:sm", password HMAC-SHA1(secret, user)
export function turnServers(secret, host, ttl = 6 * 3600, now = Date.now()) {
  if (!secret || !host) return [{ urls: host ? `stun:${host}:3478` : "stun:stun.l.google.com:19302" }];
  const username = `${Math.floor(now / 1000) + ttl}:sm`;
  const credential = crypto.createHmac("sha1", secret).update(username).digest("base64");
  return [
    { urls: `stun:${host}:3478` },
    { urls: [`turn:${host}:3478?transport=udp`, `turn:${host}:3478?transport=tcp`], username, credential },
  ];
}

export function localSfu(opts = {}) {
  const ports = String(opts.ports || "40000-40199").split("-").map(Number);
  const config = {
    codecs: { audio: [OPUS()], video: [] },
    icePortRange: ports.length === 2 && ports[0] > 0 && ports[1] >= ports[0] ? ports : undefined,
    iceAdditionalHostAddresses: opts.ip ? [opts.ip] : undefined,
    iceUseDefaultStunServer: false,
  };
  const sessions = new Map();     // sid -> { pc, tracks: Map(trackName -> MediaStreamTrack), outs: Map(mid -> { stop }), timer }
  const live = new Map();         // "sid/trackName" -> incoming MediaStreamTrack

  const get = sid => {
    const s = sessions.get(sid);
    if (!s) throw new Error("voice: no such session");
    return s;
  };
  const drop = sid => {
    const s = sessions.get(sid);
    if (!s) return;
    sessions.delete(sid);
    clearTimeout(s.timer);
    for (const o of s.outs.values()) o.stop();
    for (const name of s.tracks.keys()) live.delete(`${sid}/${name}`);
    s.pc.close().catch(() => {});
  };
  // a session waits IDLE_MS for its connection, and again whenever it loses it
  const idle = s => { clearTimeout(s.timer); s.timer = setTimeout(() => drop(s.sid), IDLE_MS); s.timer.unref?.(); };

  return {
    sessions,
    async ice() { return turnServers(opts.turnSecret, opts.turnHost); },

    async session() {
      const sid = crypto.randomUUID().replace(/-/g, "");
      const pc = new RTCPeerConnection(config);
      const s = { sid, pc, tracks: new Map(), outs: new Map(), wanted: new Map(), timer: 0 };
      pc.connectionStateChange.subscribe(st => {
        if (st === "connected") clearTimeout(s.timer);
        else if (st === "disconnected" || st === "failed") idle(s);
        else if (st === "closed") drop(sid);
      });
      // an incoming microphone: its track name comes from the push of its mid
      pc.ontrack = ({ track, transceiver }) => {
        const name = s.wanted.get(String(transceiver.mid));
        if (!name) return;
        s.tracks.set(name, track);
        live.set(`${sid}/${name}`, track);
      };
      sessions.set(sid, s);
      idle(s);
      return sid;
    },

    async push(sid, sdp, tracks) {
      const s = get(sid);
      for (const t of tracks) s.wanted.set(String(t.mid), String(t.trackName));
      await s.pc.setRemoteDescription({ type: "offer", sdp });
      await s.pc.setLocalDescription(await s.pc.createAnswer());
      return { sessionDescription: { type: "answer", sdp: s.pc.localDescription.sdp } };
    },

    async pull(sid, tracks) {
      const s = get(sid), out = [];
      for (const t of tracks) {
        const from = live.get(`${t.sessionId}/${t.trackName}`);
        if (!from) { out.push({ sessionId: t.sessionId, trackName: t.trackName, errorCode: "not_found" }); continue; }
        const fwd = new MediaStreamTrack({ kind: "audio" });
        const tr = s.pc.addTransceiver(fwd, { direction: "sendonly" });
        const { unSubscribe } = from.onReceiveRtp.subscribe(rtp => fwd.writeRtp(rtp));
        const entry = { tr, from, stop: () => { unSubscribe(); fwd.stop(); } };
        out.push({ entry, sessionId: t.sessionId, trackName: t.trackName });
      }
      await s.pc.setLocalDescription(await s.pc.createOffer());
      const list = out.map(o => {
        if (!o.entry) return o;
        s.outs.set(String(o.entry.tr.mid), o.entry);
        return { mid: String(o.entry.tr.mid), sessionId: o.sessionId, trackName: o.trackName };
      });
      return { tracks: list, requiresImmediateRenegotiation: true, sessionDescription: { type: "offer", sdp: s.pc.localDescription.sdp } };
    },

    async renegotiate(sid, sdp) {
      await get(sid).pc.setRemoteDescription({ type: "answer", sdp });
      return {};
    },

    // a microphone stops: forget its track and stop forwarding it everywhere
    async close(sid, mids) {
      const s = sessions.get(sid);
      if (!s) return {};
      for (const mid of mids) {
        const name = s.wanted.get(String(mid));
        if (!name) continue;
        const key = `${sid}/${name}`;
        const track = live.get(key);
        live.delete(key);
        s.tracks.delete(name);
        if (track) for (const o of sessions.values()) for (const [m, e] of o.outs) if (e.from === track) { e.stop(); o.outs.delete(m); }
      }
      if (!s.outs.size) drop(sid);
      return {};
    },
  };
}
