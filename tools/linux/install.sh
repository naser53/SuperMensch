#!/usr/bin/env bash
# Install (or repair) the SuperMensch server on an Ubuntu machine (owner, 2026-11-10: the game runs
# on Cloudflare and on the owner's Linux server, from the same code). Run as root:
#   curl -fsSL https://raw.githubusercontent.com/naser53/SuperMensch/main/tools/linux/install.sh | sudo bash
# With a domain (its A records, the name and www, point at this server): HTTPS through Caddy, which
# gets and renews the certificate by itself; the game then listens on 127.0.0.1:8080 behind it:
#   curl -fsSL .../install.sh | sudo DOMAIN=wiengame.com bash
# What it sets up:
#   /opt/supermensch/app          the code (a clone of main), built with npm run build
#   /var/lib/supermensch          the games (SQLite files); kept on reinstall
#   /etc/supermensch.env          PORT, DATA_DIR, ADMIN_KEY (and voice keys, if added later)
#   supermensch.service           the server (server/node/main.mjs) on port 80, restarted on failure
#   caddy (with DOMAIN)           HTTPS for DOMAIN and www.DOMAIN, passed on to the game
#   supermensch-update.timer      every 2 minutes: a new commit on main is pulled, built and started
#   supermensch-update, supermensch-copy, supermensch-voice   commands (update now; copy the games
#                                 from Cloudflare; the voice chat keys)
set -euo pipefail

REPO="${REPO:-https://github.com/naser53/SuperMensch.git}"
BRANCH="${BRANCH:-main}"
NODE_VERSION="22.23.4"            # Node 22.13 or newer has node:sqlite
APP=/opt/supermensch/app
DATA=/var/lib/supermensch
ENVF=/etc/supermensch.env
SVC=supermensch
DOMAIN="${DOMAIN:-}"
if [ -n "$DOMAIN" ]; then PORT=8080; HOST=127.0.0.1; else PORT=80; HOST=; fi

[ "$(id -u)" = 0 ] || { echo "run as root (sudo)"; exit 1; }
say() { printf '\n== %s\n' "$*"; }

say "packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl ca-certificates xz-utils >/dev/null

say "Node.js"
need_node=1
if command -v node >/dev/null; then
  v=$(node -p 'process.versions.node')
  node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' && need_node=0
  echo "found node $v"
fi
if [ "$need_node" = 1 ]; then
  case "$(uname -m)" in x86_64) arch=x64 ;; aarch64|arm64) arch=arm64 ;; *) echo "unknown machine $(uname -m)"; exit 1 ;; esac
  tmp=$(mktemp -d)
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-$arch.tar.xz" -o "$tmp/node.tar.xz"
  rm -rf /opt/node && mkdir -p /opt/node && tar -xJf "$tmp/node.tar.xz" -C /opt/node --strip-components=1
  rm -rf "$tmp"
  ln -sf /opt/node/bin/node /usr/local/bin/node
  ln -sf /opt/node/bin/npm /usr/local/bin/npm
  ln -sf /opt/node/bin/npx /usr/local/bin/npx
  echo "installed node $(/usr/local/bin/node -v)"
fi
NODE=$(command -v node)

say "user and folders"
id "$SVC" >/dev/null 2>&1 || useradd --system --home /opt/supermensch --shell /usr/sbin/nologin "$SVC"
mkdir -p /opt/supermensch "$DATA"
chown "$SVC:$SVC" /opt/supermensch "$DATA"
chmod 750 "$DATA"

say "code"
if [ -d "$APP/.git" ]; then
  runuser -u "$SVC" -- git -C "$APP" fetch -q origin "$BRANCH"
  runuser -u "$SVC" -- git -C "$APP" reset -q --hard "origin/$BRANCH"
else
  runuser -u "$SVC" -- git clone -q --branch "$BRANCH" "$REPO" "$APP"
fi
cd "$APP"
runuser -u "$SVC" -- env HOME=/opt/supermensch npm ci --no-audit --no-fund --loglevel=error
runuser -u "$SVC" -- env HOME=/opt/supermensch npm run build

say "settings ($ENVF)"
if [ ! -f "$ENVF" ]; then
  key="${ADMIN_KEY:-}"
  if [ -z "$key" ] && [ -r /dev/tty ]; then
    read -r -s -p "Admin key for this server (empty: make one): " key </dev/tty || true; echo
  fi
  [ -n "$key" ] || { key=$(head -c 18 /dev/urandom | base64 | tr -d '/+=' ); echo "admin key made: $key  (keep it; it is in $ENVF)"; }
  umask 077
  printf 'PORT=%s\nHOST=%s\nDATA_DIR=%s\nADMIN_KEY=%s\n' "$PORT" "$HOST" "$DATA" "$key" > "$ENVF"
  umask 022
else
  # kept; only where the game listens follows DOMAIN (behind Caddy or on port 80 itself)
  grep -q '^HOST=' "$ENVF" || echo "HOST=" >> "$ENVF"
  sed -i "s/^PORT=.*/PORT=$PORT/; s/^HOST=.*/HOST=$HOST/" "$ENVF"
  echo "kept (port $PORT)"
fi

say "service"
cat > /etc/systemd/system/$SVC.service <<UNIT
[Unit]
Description=SuperMensch game server
After=network-online.target
Wants=network-online.target

[Service]
User=$SVC
WorkingDirectory=$APP
EnvironmentFile=$ENVF
ExecStart=$NODE --disable-warning=ExperimentalWarning server/node/main.mjs
Restart=always
RestartSec=2
AmbientCapabilities=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=$DATA

[Install]
WantedBy=multi-user.target
UNIT

install -m 755 "$APP/tools/linux/update.sh" /usr/local/bin/supermensch-update
install -m 755 "$APP/tools/linux/copy.sh" /usr/local/bin/supermensch-copy
install -m 755 "$APP/tools/linux/voice.sh" /usr/local/bin/supermensch-voice
cat > /etc/systemd/system/$SVC-update.service <<UNIT
[Unit]
Description=SuperMensch: take a new version from $BRANCH

[Service]
Type=oneshot
ExecStart=/usr/local/bin/supermensch-update
UNIT
cat > /etc/systemd/system/$SVC-update.timer <<UNIT
[Unit]
Description=SuperMensch: look for a new version every 2 minutes

[Timer]
OnBootSec=1min
OnUnitActiveSec=2min

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable -q --now $SVC.service $SVC-update.timer
systemctl restart $SVC.service

if [ -n "$DOMAIN" ]; then
  say "HTTPS for $DOMAIN (Caddy)"
  apt-get install -y -qq caddy >/dev/null
  cat > /etc/caddy/Caddyfile <<CADDY
# SuperMensch (tools/linux/install.sh): HTTPS for the domain, passed on to the game
$DOMAIN, www.$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:$PORT
}
CADDY
  systemctl enable -q caddy
  systemctl restart caddy
fi

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null && echo "firewall: port 80 open"
  [ -n "$DOMAIN" ] && ufw allow 443/tcp >/dev/null && echo "firewall: port 443 open"
fi

sleep 2
ip=$(curl -fsS -4 --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
if ! curl -fsS --max-time 5 "http://127.0.0.1:$PORT/api/users" >/dev/null; then
  say "the server did not answer; see: journalctl -u $SVC -n 50"
  exit 1
fi
if [ -z "$DOMAIN" ]; then
  say "ready: http://$ip/   (admin page: http://$ip/admin)"
  exit 0
fi
for name in "$DOMAIN" "www.$DOMAIN"; do
  got=$(getent ahostsv4 "$name" | awk 'NR==1{print $1}')
  [ "$got" = "$ip" ] || echo "note: $name points to '${got:-nothing}', not $ip: set its A record to $ip (HTTPS starts once it does)"
done
for i in $(seq 1 30); do
  curl -fsS --max-time 5 "https://$DOMAIN/api/users" >/dev/null 2>&1 && { say "ready: https://$DOMAIN/   (admin page: https://$DOMAIN/admin)"; exit 0; }
  sleep 2
done
say "the game runs; HTTPS for $DOMAIN is not ready yet (Caddy keeps trying: journalctl -u caddy -n 30)"
