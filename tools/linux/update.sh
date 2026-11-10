#!/usr/bin/env bash
# Take a new version of SuperMensch from main, if there is one: pull, build, restart.
# Run by supermensch-update.timer every 2 minutes (and by hand: sudo supermensch-update).
set -euo pipefail
APP=/opt/supermensch/app SVC=supermensch BRANCH="${BRANCH:-main}"
as() { runuser -u "$SVC" -- env HOME=/opt/supermensch "$@"; }
cd "$APP"
as git fetch -q origin "$BRANCH"
[ "$(as git rev-parse HEAD)" = "$(as git rev-parse "origin/$BRANCH")" ] && exit 0
old=$(as git rev-parse --short HEAD)
as git reset -q --hard "origin/$BRANCH"
as npm ci --no-audit --no-fund --loglevel=error
as npm run build
# a newer install script may set up more: the commands themselves are kept current here
install -m 755 tools/linux/update.sh /usr/local/bin/supermensch-update
install -m 755 tools/linux/copy.sh /usr/local/bin/supermensch-copy
systemctl restart "$SVC"
echo "updated $old -> $(as git rev-parse --short HEAD) ($(node -p 'require("./package.json").version'))"
