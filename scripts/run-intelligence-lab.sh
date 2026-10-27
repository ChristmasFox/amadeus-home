#!/usr/bin/env bash
# Entry point for the PUBG Intelligence Lab LaunchAgent: bind address, snapshot path and package builds are resolved
# on every start so a changed LAN address or a refreshed snapshot needs no manual step.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/Library/pnpm:/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
STATE_DIR="${INTELLIGENCE_LAB_STATE_DIR:-$HOME/Library/Application Support/Amadeus/PubgIntelligenceLab}"
CONFIG="$STATE_DIR/config.env"
# shellcheck disable=SC1090
[[ -f "$CONFIG" ]] && source "$CONFIG"

PORT="${PORT:-4179}"
BIND="${BIND:-auto}"
if [[ "$BIND" == auto ]]; then
  # The page only accepts loopback or a private LAN IPv4, so pick the first interface that has one.
  BIND=127.0.0.1
  for interface in en0 en1; do
    address="$(ipconfig getifaddr "$interface" 2>/dev/null || true)"
    if [[ "$address" =~ ^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.) ]]; then BIND="$address"; break; fi
  done
fi

SNAPSHOT="$STATE_DIR/snapshot.sqlite"
if [[ ! -s "$SNAPSHOT" ]]; then
  echo "snapshot missing: run scripts/refresh-intelligence-snapshot.sh --apply first" >&2
  exit 78
fi

cd "$ROOT"
# The server runs out of this checkout, so its node_modules must match this checkout's lockfile: a dependency change
# that was pulled but not installed used to crash-loop the service (ERR_MODULE_NOT_FOUND) and the site answered 502.
bash "$ROOT/scripts/sync-main-deps.sh" "$ROOT"
# Domain/intelligence come from @rine-kit/* on npm (prebuilt).
echo "pubg-intelligence-lab starting on http://$BIND:$PORT with snapshot $SNAPSHOT"
cd "$ROOT/apps/pubg-intelligence-lab"
# The public hostname (when configured) serves the built client, never the Vite dev server, so rebuild it on every start.
if [[ -n "${PUBG_INTELLIGENCE_PUBLIC_HOST:-}" ]]; then
  ./node_modules/.bin/vite build >/dev/null
fi
export HOST="$BIND" PORT PUBG_INTELLIGENCE_DB="$SNAPSHOT"
export PUBG_INTELLIGENCE_PUBLIC_HOST="${PUBG_INTELLIGENCE_PUBLIC_HOST:-}" PUBG_INTELLIGENCE_PUBLIC_AUTH_FILE="${PUBG_INTELLIGENCE_PUBLIC_AUTH_FILE:-}"
exec ./node_modules/.bin/tsx src/server.ts
