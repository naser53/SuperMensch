#!/usr/bin/env bash
# Voice chat on the Linux server (sudo supermensch-voice): the Cloudflare Realtime keys, as the
# Worker's secrets of the same names (README, "Voice chat"). Voice still goes through Cloudflare's
# SFU; the browser opens the microphone only over HTTPS (install.sh with DOMAIN=...).
# Asks for each key (empty: keep the one there), writes /etc/supermensch.env, restarts the game.
set -euo pipefail
ENVF=/etc/supermensch.env
[ "$(id -u)" = 0 ] || { echo "run as root (sudo)"; exit 1; }
for k in REALTIME_APP_ID REALTIME_APP_TOKEN TURN_KEY_ID TURN_KEY_TOKEN; do
  have=$(grep -q "^$k=." "$ENVF" && echo " (set; Enter keeps it)" || echo "")
  [ "${k#TURN}" != "$k" ] && opt=" optional" || opt=""
  read -r -s -p "$k$opt$have: " v </dev/tty; echo
  v=$(printf '%s' "$v" | tr -d '\r[:space:]')
  [ -n "$v" ] || continue
  sed -i "/^$k=/d" "$ENVF"
  printf '%s=%s\n' "$k" "$v" >> "$ENVF"
done
chmod 600 "$ENVF"
systemctl restart supermensch
sleep 2
port=$(sed -n 's/^PORT=//p' "$ENVF")
curl -fsS "http://127.0.0.1:${port:-80}/api/settings" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s).voice;console.log(v.ready?"voice: ready (tick the players who may talk on the admin page)":"voice: not ready, REALTIME_APP_ID and REALTIME_APP_TOKEN are needed")})'
