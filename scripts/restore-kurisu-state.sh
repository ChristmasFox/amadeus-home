#!/usr/bin/env bash
set -euo pipefail

MACHINE="${ORBSTACK_MACHINE:-ubuntu}"
ARCHIVE=""
APPLY=0
ALLOW_RUNNING=0
STATE_FILE="${KURISU_REMOTE_STATE_FILE:-/DATA/AppData/pubg-query-engine-v3/data/state.json.kurisu.sqlite}"

usage() {
  cat <<'EOF'
Usage: scripts/restore-kurisu-state.sh [--dry-run] [--apply] ARCHIVE.tar.gz

Preview and, only with --apply, restore the exact Kurisu SQLite state file to
OrbStack ubuntu CasaOS. Apply mode first copies the current file to a remote
timestamped rollback backup and refuses to run while the runtime is active.

Options:
  --apply                 Extract the validated state archive.
  --dry-run               Validate and print the plan (default).
  --allow-running         Explicitly allow restore while the runtime is running.
  --machine NAME          OrbStack machine (default: ubuntu).
  --state-file PATH       Exact remote state path under /DATA/AppData.
EOF
}

while (($#)); do
  case "$1" in
    --apply) APPLY=1 ;;
    --dry-run) APPLY=0 ;;
    --allow-running) ALLOW_RUNNING=1 ;;
    --machine)
      (($# >= 2)) || { printf '%s\n' '--machine requires a value' >&2; exit 2; }
      MACHINE="$2"
      shift
      ;;
    --state-file)
      (($# >= 2)) || { printf '%s\n' '--state-file requires a path' >&2; exit 2; }
      STATE_FILE="$2"
      shift
      ;;
    -h|--help) usage; exit 0 ;;
    -*) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
    *)
      [ -z "$ARCHIVE" ] || { printf '%s\n' 'Only one archive may be supplied.' >&2; exit 2; }
      ARCHIVE="$1"
      ;;
  esac
  shift
done

[ -n "$ARCHIVE" ] || { usage >&2; exit 2; }
[ -f "$ARCHIVE" ] || { printf 'Archive not found: %s\n' "$ARCHIVE" >&2; exit 1; }
case "$STATE_FILE" in
  /DATA/AppData/*/*.sqlite|/DATA/AppData/*/*.sqlite3) ;;
  *) printf '%s\n' 'Refusing a state path outside the bounded AppData SQLite scope.' >&2; exit 2 ;;
esac

relative_state="${STATE_FILE#/DATA/AppData/}"
entries="$(mktemp "${TMPDIR:-/tmp}/kurisu-restore-entries.XXXXXX")"
trap 'rm -f "$entries"' EXIT
tar -tzf "$ARCHIVE" > "$entries"
if awk '/^\// || /(^|\/)\.\.(\/|$)/ || /^-/ { bad = 1 } END { exit bad ? 0 : 1 }' "$entries"; then
  printf '%s\n' 'Archive contains an absolute, traversal, or option-like path.' >&2
  exit 1
fi
entry_count="$(wc -l < "$entries" | tr -d ' ')"
if [ "$entry_count" -ne 1 ] || ! awk -v expected="$relative_state" '$0 == expected { found = 1 } END { exit found ? 0 : 1 }' "$entries"; then
  printf '%s\n' "Archive must contain exactly $relative_state." >&2
  exit 1
fi

printf 'MODE=%s\n' "$([[ $APPLY -eq 1 ]] && printf apply || printf dry-run)"
printf 'MACHINE=%s\n' "$MACHINE"
printf 'ARCHIVE=%s\n' "$ARCHIVE"
printf 'STATE_FILE=%s\n' "$STATE_FILE"
printf 'ENTRIES=%s\n' "$entry_count"
printf '%s\n' 'PLAN=backup the current remote state, then replace only the validated Kurisu SQLite file.'

if ((APPLY == 0)); then
  printf '%s\n' 'Preview only. Add --apply after verifying the archive and stopping the runtime.'
  exit 0
fi

command -v orb >/dev/null 2>&1 || { printf '%s\n' 'OrbStack CLI is required for apply mode.' >&2; exit 1; }
if ((ALLOW_RUNNING == 0)); then
  running="$(orb -m "$MACHINE" -u root docker ps --format '{{.Names}}' 2>/dev/null || true)"
  if printf '%s\n' "$running" | awk '$1 == "pubg-query-engine-v3" { found = 1 } END { exit found ? 0 : 1 }'; then
    printf '%s\n' 'pubg-query-engine-v3 is running; stop it first or pass --allow-running explicitly.' >&2
    exit 1
  fi
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
orb -m "$MACHINE" -u root bash -lc '
set -euo pipefail
relative="$1"
state="/DATA/AppData/$relative"
archive_backup="$state.codex-backup.$2"
staging="$(mktemp -d /tmp/kurisu-state-restore.XXXXXX)"
trap "rm -rf \"$staging\"" EXIT
if [ -f "$state" ]; then
  cp -p "$state" "$archive_backup"
  printf "ROLLBACK_STATE=%s\n" "$archive_backup"
fi
tar --no-same-owner --no-same-permissions -xzf - -C "$staging"
test -f "$staging/$relative"
install -d "$(dirname "$state")"
install -m 0600 "$staging/$relative" "$state"
printf "STATE_RESTORED=%s\n" "$state"
' _ "${relative_state}" "$stamp" < "$ARCHIVE"
