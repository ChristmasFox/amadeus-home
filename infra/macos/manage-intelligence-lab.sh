#!/bin/bash
# Install, inspect or stop the two LaunchAgents of the PUBG Intelligence Lab page:
#   com.amadeus.pubg-intelligence-lab          keeps the page running
#   com.amadeus.pubg-intelligence-lab-refresh  hourly, refreshes the read-only snapshot and restarts the page on change
# Dry-run is the default; --apply installs, --stop --apply unloads. No source, data or Lab runtime is modified.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TARGET="gui/$(id -u)"
SERVER_LABEL=com.amadeus.pubg-intelligence-lab
REFRESH_LABEL=com.amadeus.pubg-intelligence-lab-refresh
AGENTS_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/Library/Logs/Amadeus/PubgIntelligenceLab"
STATE_DIR="$HOME/Library/Application Support/Amadeus/PubgIntelligenceLab"
ACTION=--dry-run
APPLY=0

for argument in "$@"; do
  case "$argument" in
    --apply) APPLY=1 ;;
    --dry-run) ACTION=--dry-run ;;
    --status|--stop) ACTION="$argument" ;;
    *) echo "unknown argument: $argument" >&2; exit 2 ;;
  esac
done

loaded() { launchctl print "$TARGET/$1" >/dev/null 2>&1 && echo loaded || echo not_loaded; }

if [[ "$ACTION" == --status ]]; then
  echo "INTELLIGENCE_LAB_SERVER=$(loaded "$SERVER_LABEL")"
  echo "INTELLIGENCE_LAB_REFRESH=$(loaded "$REFRESH_LABEL")"
  [[ -f "$STATE_DIR/refresh.json" ]] && echo "INTELLIGENCE_LAB_LAST_REFRESH=$(cat "$STATE_DIR/refresh.json")"
  for interface in en0 en1; do
    address="$(ipconfig getifaddr "$interface" 2>/dev/null || true)"
    [[ -z "$address" ]] || curl -sS --max-time 3 -o /dev/null -w "INTELLIGENCE_LAB_HTTP_$interface=%{http_code}\n" "http://$address:4179/api/bootstrap" || true
  done
  exit 0
fi

if [[ "$ACTION" == --stop ]]; then
  (( APPLY == 1 )) || { echo '--stop changes LaunchAgents; pass --stop --apply' >&2; exit 2; }
  launchctl bootout "$TARGET/$REFRESH_LABEL" 2>/dev/null || true
  launchctl bootout "$TARGET/$SERVER_LABEL" 2>/dev/null || true
  echo 'INTELLIGENCE_LAB_STOPPED=yes'
  exit 0
fi

if (( APPLY == 0 )); then
  cat <<PLAN
INTELLIGENCE_LAB_ACTION=install_or_update
INTELLIGENCE_LAB_SERVER_AGENT=$AGENTS_DIR/$SERVER_LABEL.plist (KeepAlive, port 4179, LAN bind chosen at each start)
INTELLIGENCE_LAB_REFRESH_AGENT=$AGENTS_DIR/$REFRESH_LABEL.plist (hourly at minute 20)
INTELLIGENCE_LAB_STATE=$STATE_DIR (snapshot, config.env, refresh.json)
INTELLIGENCE_LAB_LOGS=$LOG_DIR
INTELLIGENCE_LAB_SOURCE=read-only SQLite backup of the live Lab database; the live database is never written
Run with --apply to install and start.
PLAN
  exit 0
fi

mkdir -p "$AGENTS_DIR" "$LOG_DIR" "$STATE_DIR"
chmod 700 "$STATE_DIR"
if [[ ! -s "$STATE_DIR/snapshot.sqlite" ]]; then
  "$ROOT/scripts/refresh-intelligence-snapshot.sh" --apply
fi
if [[ ! -f "$STATE_DIR/config.env" ]]; then
  cat > "$STATE_DIR/config.env" <<'CONFIG'
# PORT: page port. BIND: auto picks the first private LAN IPv4 (en0, en1) at every start; set 127.0.0.1 for loopback only.
PORT=4179
BIND=auto
# Optional public hostname served behind the VPS proxy with a password login. Both lines are required together; the
# auth file is a mode-0600 scrypt verifier kept outside Git (the Image Lab verifier can be reused for one shared password).
# PUBG_INTELLIGENCE_PUBLIC_HOST=pubg.example.com
# PUBG_INTELLIGENCE_PUBLIC_AUTH_FILE=$HOME/Library/Application Support/Amadeus/secrets/qwen-image-lab-auth.json
CONFIG
fi

for label in "$SERVER_LABEL" "$REFRESH_LABEL"; do
  sed -e "s#__ROOT__#$ROOT#g" -e "s#__LOG__#$LOG_DIR#g" "$ROOT/infra/macos/$label.plist.example" > "$AGENTS_DIR/$label.plist"
  plutil -lint "$AGENTS_DIR/$label.plist" >/dev/null
  launchctl bootout "$TARGET/$label" 2>/dev/null || true
  launchctl bootstrap "$TARGET" "$AGENTS_DIR/$label.plist"
done
echo 'INTELLIGENCE_LAB_INSTALLED=yes'
"$0" --status
