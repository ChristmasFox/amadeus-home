#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MACHINE="${ORBSTACK_MACHINE:-ubuntu}"
STATE_FILE="${KURISU_REMOTE_STATE_FILE:-/DATA/AppData/pubg-query-engine-v3/data/state.json.kurisu.sqlite}"
if [[ -d /Volumes/Avalon ]]; then
  DEFAULT_BACKUP_ROOT="/Volumes/Avalon/backups/agent-monorepo/kurisu"
else
  DEFAULT_BACKUP_ROOT="$REPO_ROOT/.backups/kurisu"
fi
BACKUP_ROOT="${KURISU_BACKUP_ROOT:-$DEFAULT_BACKUP_ROOT}"
APPLY=0

usage() {
  cat <<'EOF'
Usage: scripts/backup-kurisu-state.sh [--dry-run] [--apply]

Back up only the Runtime-owned Kurisu SQLite state from the canonical OrbStack
CasaOS data path. Dry-run is the default; --apply writes an external archive.
The archive contains no provider keys, bot tokens, or other secret files.

Options:
  --apply                 Create the archive after checking the remote state file.
  --dry-run               Print the plan without reading or writing state.
  --machine NAME          OrbStack machine (default: ubuntu).
  --backup-root PATH      External archive directory.
  --state-file PATH       Exact remote state path under /DATA/AppData.
EOF
}

while (($#)); do
  case "$1" in
    --apply) APPLY=1 ;;
    --dry-run) APPLY=0 ;;
    --machine)
      (($# >= 2)) || { printf '%s\n' '--machine requires a value' >&2; exit 2; }
      MACHINE="$2"
      shift
      ;;
    --backup-root)
      (($# >= 2)) || { printf '%s\n' '--backup-root requires a path' >&2; exit 2; }
      BACKUP_ROOT="$2"
      shift
      ;;
    --state-file)
      (($# >= 2)) || { printf '%s\n' '--state-file requires a path' >&2; exit 2; }
      STATE_FILE="$2"
      shift
      ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

case "$STATE_FILE" in
  /DATA/AppData/*/*.sqlite|/DATA/AppData/*/*.sqlite3) ;;
  *) printf '%s\n' 'Refusing a state path outside the bounded AppData SQLite scope.' >&2; exit 2 ;;
esac

relative_state="${STATE_FILE#/DATA/AppData/}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive_dir="$BACKUP_ROOT/$stamp"
archive="$archive_dir/kurisu-state-$stamp.tar.gz"
manifest="$archive_dir/manifest.txt"

printf 'MODE=%s\n' "$([[ $APPLY -eq 1 ]] && printf apply || printf dry-run)"
printf 'MACHINE=%s\n' "$MACHINE"
printf 'STATE_FILE=%s\n' "$STATE_FILE"
printf 'ARCHIVE=%s\n' "$archive"
printf '%s\n' 'PLAN=archive only the exact Runtime-owned Kurisu SQLite file; keep output outside Git.'

if ((APPLY == 0)); then
  exit 0
fi

command -v orb >/dev/null 2>&1 || { printf '%s\n' 'OrbStack CLI is required for apply mode.' >&2; exit 1; }
mkdir -p "$archive_dir"
chmod 700 "$archive_dir"
orb -m "$MACHINE" -u root bash -lc '
set -euo pipefail
relative="$1"
test -f "/DATA/AppData/$relative"
tar --no-same-owner --no-same-permissions -C /DATA/AppData -czf - "$relative"
' _ "$relative_state" > "$archive"
chmod 600 "$archive"
{
  printf 'created_at_utc=%s\n' "$stamp"
  printf 'repo_commit=%s\n' "$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || printf '%s' unknown)"
  printf 'machine=%s\n' "$MACHINE"
  printf 'state_file=%s\n' "$STATE_FILE"
  printf 'archive=%s\n' "$(basename "$archive")"
} > "$manifest"
chmod 600 "$manifest"
printf 'ARCHIVE_CREATED=%s\n' "$archive"
printf 'MANIFEST=%s\n' "$manifest"
