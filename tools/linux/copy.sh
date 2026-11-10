#!/usr/bin/env bash
# Copy every room, user and setting from the Cloudflare server to this one (sudo supermensch-copy).
# This server's rooms list is replaced by the copy. Asks for the Cloudflare admin key.
set -euo pipefail
FROM="${1:-https://supermensch-dev.ndaneshi.workers.dev}"
set -a; . /etc/supermensch.env; set +a
read -r -s -p "Admin key of $FROM: " FROM_KEY </dev/tty; echo
FROM_KEY=$(printf '%s' "$FROM_KEY" | tr -d '\r')
# the keys travel in an HTTP header, which takes English letters, digits and signs only
ok() { LC_ALL=C; [[ "$1" =~ ^[[:print:]]+$ ]]; }
ok "$ADMIN_KEY" || { echo "this server's ADMIN_KEY in /etc/supermensch.env has letters an HTTP header cannot carry (Persian, spaces at the ends?): set one of English letters and digits, then: sudo systemctl restart supermensch"; exit 1; }
ok "$FROM_KEY" || { echo "that key has letters an HTTP header cannot carry"; exit 1; }
FROM_KEY="$FROM_KEY" TO_KEY="$ADMIN_KEY" node /opt/supermensch/app/tools/linux/copy-games.mjs "$FROM" "http://127.0.0.1:${PORT:-80}"
