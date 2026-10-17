#!/usr/bin/env bash
# Refresh the read-only SQLite snapshot that the PUBG Intelligence Lab page reads.
#
# The live Lab database stays untouched: it is opened read-only inside the OrbStack machine and copied with the
# SQLite backup API, verified, streamed to the Mac and swapped in atomically. Dry-run is the default.
#
#   refresh-intelligence-snapshot.sh [--apply] [--restart]
#
# --restart kicks the LaunchAgent so the page reloads the new snapshot (only when the data changed).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/host-profile.sh
source "$ROOT/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT"

LABEL=com.amadeus.pubg-intelligence-lab
STATE_DIR="${INTELLIGENCE_LAB_STATE_DIR:-$HOME/Library/Application Support/Amadeus/PubgIntelligenceLab}"
SNAPSHOT="$STATE_DIR/snapshot.sqlite"
PREVIOUS="$STATE_DIR/snapshot.prev.sqlite"
RESULT="$STATE_DIR/refresh.json"
SOURCE="${INTELLIGENCE_LAB_SOURCE_DB:-$OPENCLAW_DATA_DIR/data/pubg.sqlite}"
APPLY=0
RESTART=0

for argument in "$@"; do
  case "$argument" in
    --apply) APPLY=1 ;;
    --restart) RESTART=1 ;;
    --dry-run) APPLY=0 ;;
    *) echo "unknown argument: $argument" >&2; exit 2 ;;
  esac
done

if (( APPLY == 0 )); then
  cat <<PLAN
INTELLIGENCE_SNAPSHOT_ACTION=refresh
INTELLIGENCE_SNAPSHOT_SOURCE=$ORBSTACK_MACHINE:$SOURCE (opened read-only, SQLite backup API)
INTELLIGENCE_SNAPSHOT_TARGET=$SNAPSHOT
INTELLIGENCE_SNAPSHOT_RESTART=$([[ $RESTART == 1 ]] && echo "kickstart $LABEL when data changed" || echo no)
Run with --apply to refresh. The live database and the archive are never written.
PLAN
  exit 0
fi

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"
LOCK="$STATE_DIR/.refresh.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  # A stale lock from a crashed run must not block the schedule forever.
  if [[ -n "$(find "$LOCK" -maxdepth 0 -mmin +30 2>/dev/null)" ]]; then rmdir "$LOCK" && mkdir "$LOCK"; else echo 'INTELLIGENCE_SNAPSHOT=busy'; exit 0; fi
fi
REMOTE_TMP="/tmp/pubg-intelligence-snapshot-$$.sqlite"
LOCAL_TMP="$STATE_DIR/.incoming-$$.sqlite"
cleanup() {
  rmdir "$LOCK" 2>/dev/null || true
  rm -f "$LOCAL_TMP" "$LOCAL_TMP-shm" "$LOCAL_TMP-wal"
  orb -m "$ORBSTACK_MACHINE" -u root rm -f "$REMOTE_TMP" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# 1. Consistent read-only copy inside the machine (never copies a live WAL database blindly).
remote_json="$(orb -m "$ORBSTACK_MACHINE" -u root python3 - "$SOURCE" "$REMOTE_TMP" <<'PY'
import hashlib, json, os, sqlite3, sys
source, target = sys.argv[1], sys.argv[2]
if not os.path.isfile(source):
    raise SystemExit(f'source database is missing: {source}')
if os.path.exists(target):
    os.unlink(target)
with sqlite3.connect(f'file:{source}?mode=ro', uri=True, timeout=30) as src, sqlite3.connect(target) as dst:
    src.backup(dst)
    if dst.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
        raise SystemExit('integrity check failed after backup')
    # The copy is read-only data: plain journal mode keeps -wal/-shm files from appearing next to it.
    dst.execute('PRAGMA journal_mode=DELETE')
os.chmod(target, 0o600)
digest = hashlib.sha256(open(target, 'rb').read()).hexdigest()
print(json.dumps({'sha256': digest, 'bytes': os.path.getsize(target)}))
PY
)"
expected_sha="$(printf '%s' "$remote_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["sha256"])')"

# 2. Stream it to the Mac and verify the transfer.
orb -m "$ORBSTACK_MACHINE" -u root cat "$REMOTE_TMP" > "$LOCAL_TMP"
chmod 600 "$LOCAL_TMP"
actual_sha="$(shasum -a 256 "$LOCAL_TMP" | cut -d' ' -f1)"
[[ "$actual_sha" == "$expected_sha" ]] || { echo 'INTELLIGENCE_SNAPSHOT=transfer_mismatch' >&2; exit 1; }

# 3. Compare with the snapshot in use; swap only when the data moved.
summary() {
  python3 - "$1" <<'PY'
import json, sqlite3, sys
db = sqlite3.connect(f'file:{sys.argv[1]}?mode=ro', uri=True)
if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
    raise SystemExit('integrity check failed')
def one(sql):
    return db.execute(sql).fetchone()[0]
print(json.dumps({
    'matches': one('select count(*) from matches'),
    'latestMatchMs': one('select coalesce(max(timestamp_ms),0) from matches'),
    'telemetryFeatures': one("select count(*) from telemetry_features where feature_version='review-features-6'"),
}))
PY
}
new_summary="$(summary "$LOCAL_TMP")"
old_summary='{}'
[[ -f "$SNAPSHOT" ]] && old_summary="$(summary "$SNAPSHOT" 2>/dev/null || echo '{}')"
now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [[ "$new_summary" == "$old_summary" ]]; then
  printf '{"at":"%s","changed":false,"summary":%s}\n' "$now" "$new_summary" > "$RESULT"
  echo "INTELLIGENCE_SNAPSHOT=unchanged $new_summary"
  exit 0
fi

[[ -f "$SNAPSHOT" ]] && mv -f "$SNAPSHOT" "$PREVIOUS"
mv -f "$LOCAL_TMP" "$SNAPSHOT"
printf '{"at":"%s","changed":true,"summary":%s,"previous":%s}\n' "$now" "$new_summary" "$old_summary" > "$RESULT"
echo "INTELLIGENCE_SNAPSHOT=updated $new_summary (was $old_summary)"

if (( RESTART == 1 )); then
  if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
    launchctl kickstart -k "gui/$(id -u)/$LABEL"
    echo "INTELLIGENCE_LAB_PAGE=restarted"
  else
    echo "INTELLIGENCE_LAB_PAGE=not_loaded"
  fi
fi
