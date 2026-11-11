#!/usr/bin/env bash
# Voice chat on the Linux server (sudo supermensch-voice; install.sh runs it too). Nothing from
# Cloudflare (owner, 2026-11-10): the game server relays the voices itself (server/node/sfu.mjs),
# and coturn on this machine is the TURN relay for networks that block direct connections (peer to
# peer mode, and phones behind strict routers). Sets up, and may be run again at any time:
#   supermensch-turn  the game's own coturn (its own service and /etc/supermensch-turn.conf, so another
#                     app's TURN on this machine is never touched; owner, 2026-11-11: Gap runs one on
#                     the usual 3478): port 3480 (UDP and TCP; coturn also takes 3481), relay ports
#                     49160-49359/udp, with a shared secret: the game hands out short-lived passwords
#                     made from it
#   /etc/supermensch.env   VOICE_PORTS (the relay's UDP ports, 40000-40199), VOICE_IP (this
#                     server's public address), TURN_SECRET, TURN_HOST, TURN_PORT; old Cloudflare keys removed
#   the firewall (ufw, when it is on): those ports open
# The browser opens the microphone only over HTTPS (install.sh with DOMAIN=...).
set -euo pipefail
ENVF=/etc/supermensch.env
[ "$(id -u)" = 0 ] || { echo "run as root (sudo)"; exit 1; }
[ -f "$ENVF" ] || { echo "$ENVF is missing: run install.sh first"; exit 1; }
VOICE_PORTS=40000-40199
TURN_PORTS=49160-49359
TURN_PORT=3480                    # not 3478/3479: another app's TURN may have those
CONF=/etc/supermensch-turn.conf

setkey() { sed -i "/^$1=/d" "$ENVF"; printf '%s=%s\n' "$1" "$2" >> "$ENVF"; }
getkey() { sed -n "s/^$1=//p" "$ENVF" | tail -n 1; }

ip=$(curl -fsS -4 --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
host="${DOMAIN:-}"
[ -n "$host" ] || host=$(sed -n 's/^\([^ ,#{]*\)[ ,{].*$/\1/p' /etc/caddy/sites/supermensch.caddy 2>/dev/null | head -n 1)   # the game's own name
[ -n "$host" ] || host=$(sed -n 's/^\([^ ,#{]*\)[ ,{].*$/\1/p' /etc/caddy/Caddyfile 2>/dev/null | grep '\.' | head -n 1)
[ -n "$host" ] || host="$ip"
secret=$(getkey TURN_SECRET)
[ -n "$secret" ] || secret=$(head -c 24 /dev/urandom | base64 | tr -d '/+=')

echo "== coturn (TURN for $host, port $TURN_PORT)"
export DEBIAN_FRONTEND=noninteractive
command -v turnserver >/dev/null || { apt-get update -qq; apt-get install -y -qq coturn >/dev/null; }
# v3.3.0 used the package's own coturn service and /etc/turnserver.conf: stop it if it is still ours
if grep -q '^# SuperMensch' /etc/turnserver.conf 2>/dev/null; then
  systemctl disable -q --now coturn 2>/dev/null || true
  mv /etc/turnserver.conf /etc/turnserver.conf.supermensch-old
fi
cat > "$CONF" <<CONF
# SuperMensch (tools/linux/voice.sh): TURN for the voice chat; passwords from the shared secret
listening-port=$TURN_PORT
pidfile=/run/supermensch-turn/turnserver.pid
fingerprint
use-auth-secret
static-auth-secret=$secret
realm=$host
external-ip=$ip
min-port=${TURN_PORTS%-*}
max-port=${TURN_PORTS#*-}
no-tls
no-dtls
no-cli
no-multicast-peers
total-quota=200
stale-nonce=600
# never relay into private networks (this machine's own public address stays allowed)
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=::1
denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
denied-peer-ip=fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff
CONF
chmod 640 "$CONF"
getent group turnserver >/dev/null && chgrp turnserver "$CONF"
cat > /etc/systemd/system/supermensch-turn.service <<UNIT
[Unit]
Description=SuperMensch: TURN for the voice chat (coturn)
After=network.target

[Service]
User=turnserver
Group=turnserver
Type=notify
RuntimeDirectory=supermensch-turn
ExecStart=/usr/bin/turnserver -c $CONF
Restart=on-failure
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable -q supermensch-turn
systemctl restart supermensch-turn

echo "== settings ($ENVF)"
sed -i '/^REALTIME_APP_ID=/d; /^REALTIME_APP_TOKEN=/d; /^TURN_KEY_ID=/d; /^TURN_KEY_TOKEN=/d' "$ENVF"   # Cloudflare: not used here
setkey VOICE_PORTS "$VOICE_PORTS"
setkey VOICE_IP "$ip"
setkey TURN_SECRET "$secret"
setkey TURN_HOST "$host"
setkey TURN_PORT "$TURN_PORT"
chmod 600 "$ENVF"

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow "$TURN_PORT" >/dev/null
  ufw allow "${VOICE_PORTS%-*}:${VOICE_PORTS#*-}/udp" >/dev/null
  ufw allow "${TURN_PORTS%-*}:${TURN_PORTS#*-}/udp" >/dev/null
  echo "firewall: $TURN_PORT, $VOICE_PORTS/udp and $TURN_PORTS/udp open"
fi

systemctl restart supermensch
sleep 2
port=$(getkey PORT)
curl -fsS "http://127.0.0.1:${port:-80}/api/settings" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s).voice;console.log(`voice: ready, mode ${v.mode === "p2p" ? "peer to peer" : "through the server"} (the admin page picks the mode and who may talk)`)})'
