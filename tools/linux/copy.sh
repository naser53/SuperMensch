#!/usr/bin/env bash
# Copy every room, user and setting from the Cloudflare server to this one (sudo supermensch-copy).
# This server's rooms list is replaced by the copy. Asks for the Cloudflare admin key.
set -euo pipefail
FROM="${1:-https://supermensch-dev.ndaneshi.workers.dev}"
set -a; . /etc/supermensch.env; set +a
read -r -s -p "Admin key of $FROM: " FROM_KEY </dev/tty; echo
FROM_KEY="$FROM_KEY" TO_KEY="$ADMIN_KEY" node /opt/supermensch/app/tools/linux/copy-games.mjs "$FROM" "http://127.0.0.1:${PORT:-80}"
