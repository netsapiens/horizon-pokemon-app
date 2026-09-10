#!/usr/bin/env bash
#
# Build and install the app on a Horizon portal host.
#
# The build happens on the target rather than the workstation, so a machine
# without Node can still publish: this pushes source, runs npm
# install/build/verify there, and swaps the built dist/ into the web root. It
# does NOT register the app or deploy a version — those are one-time API calls,
# and INSTALL.md sections 2 and 3 have them.
#
# Only for self-hosting on a portal host (INSTALL.md appendix A). The normal
# path is GitHub Pages, where CI publishes on push and this script is unused.
#
# Usage:
#   TARGET=ubuntu@portal.example.com ./deploy.sh
#   TARGET=... SSH_KEY=~/.ssh/id_portal ./deploy.sh
#   TARGET=... SSH_OPTS='-o ProxyJump=bastion' ./deploy.sh   # replaces -i entirely
#
# Every setting is an environment variable so this stays honest about what it
# is doing rather than hiding a hostname in a flag.
set -euo pipefail

TARGET="${TARGET:-}"
if [ -z "$TARGET" ]; then
  echo "TARGET is required, e.g. TARGET=ubuntu@portal.example.com $0" >&2
  exit 2
fi

# An explicit SSH_OPTS wins outright; SSH_KEY is the shorthand for the common
# case, and says so rather than failing three commands later if it is not
# readable. With neither, ssh falls back to your agent and ssh config.
SSH_KEY="${SSH_KEY:-}"
if [ -z "${SSH_OPTS:-}" ]; then
  if [ -n "$SSH_KEY" ] && [ -r "$SSH_KEY" ]; then
    SSH_OPTS="-i $SSH_KEY"
  else
    [ -n "$SSH_KEY" ] && echo "note: $SSH_KEY not readable — falling back to your ssh-agent/config" >&2
    SSH_OPTS=""
  fi
fi

REMOTE_SRC="${REMOTE_SRC:-horizon-pokemon-app}"          # relative to remote $HOME
WEB_DIR="${WEB_DIR:-/var/www/html/horizon-pokemon}"
PORTAL_URL="${PORTAL_URL:-https://${TARGET#*@}}"

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck disable=SC2086
SSH=(ssh $SSH_OPTS)

echo "==> Pushing source to $TARGET:~/$REMOTE_SRC"
rsync -az --delete \
  --exclude node_modules --exclude dist --exclude .git \
  -e "ssh $SSH_OPTS" \
  "$SRC_DIR/" "$TARGET:$REMOTE_SRC/"

echo "==> Building on $TARGET"
"${SSH[@]}" "$TARGET" bash -euo pipefail -s <<REMOTE
cd "\$HOME/$REMOTE_SRC"
node --version
npm install --no-audit --no-fund
npm run build

# The platform runs these same checks on submission; a failure here is a
# rejected bundle there, so it is worth seeing before the files move.
if npm run --silent verify; then
  echo "verify: passed"
else
  echo "verify: FAILED or unavailable — see the output above" >&2
fi

# dist/*.map ships with the JS on purpose: the verifier reads the original
# source through the maps and rejects a bundle it cannot attribute findings to.
test -f dist/remoteEntry.js
ls dist/*.map >/dev/null

echo "==> Installing to $WEB_DIR"
sudo rm -rf "$WEB_DIR"
sudo cp -r dist "$WEB_DIR"
sudo chown -R www-data:www-data "$WEB_DIR"
REMOTE

echo "==> Checking the published entry point"
code=$("${SSH[@]}" "$TARGET" \
  "curl -sk -o /dev/null -w '%{http_code}' $PORTAL_URL/horizon-pokemon/remoteEntry.js")
echo "remoteEntry.js -> HTTP $code"

if [ "$code" != "200" ]; then
  echo "Not served yet. Check the Apache cache stanza in INSTALL.md section 3." >&2
  exit 1
fi

cat <<'NEXT'

Files are in place. Still one-time, per instance (INSTALL.md):

  - Apache: exempt remoteEntry.js from the 1-year JS expiry (appendix A), or
    browsers never see an update.
  - Register the app, with THIS host's remote entry URL (section 2).
    webpack_module must be exactly `horizonPokemon`.
  - Deploy the bundle (section 3) — an app with no verified version renders
    nowhere.

Then hard-refresh the portal: Apps -> Pokemon (/apps/pokemon).
NEXT
