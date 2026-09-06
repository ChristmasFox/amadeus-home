#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MACHINE="${ORBSTACK_MACHINE:-ubuntu}"
DB_FILE="${N8N_DB_FILE:-/DATA/AppData/n8n/database.sqlite}"
TABLE_ID="${CODEX_IDEMPOTENCY_TABLE_ID:-codex-completion-idempotency-20260906}"
TABLE_NAME="${CODEX_IDEMPOTENCY_TABLE_NAME:-codex_completion_events}"
CONTAINER="${N8N_CONTAINER:-n8n}"
APPLY=0

usage() {
  cat <<'USAGE'
Usage: scripts/create-n8n-codex-idempotency-table.sh [--dry-run] [--apply]

Create the external n8n Data Table used to claim threadId+turnId completion
keys. It creates a unique eventKey index and never stores message content or
secrets. The default is a dry-run.
USAGE
}

while (($#)); do
  case "$1" in
    --dry-run) APPLY=0 ;;
    --apply) APPLY=1 ;;
    --machine)
      (($# >= 2)) || { echo '--machine requires a value.' >&2; exit 2; }
      MACHINE="$2"; shift ;;
    --db-file)
      (($# >= 2)) || { echo '--db-file requires a path.' >&2; exit 2; }
      DB_FILE="$2"; shift ;;
    --table-id)
      (($# >= 2)) || { echo '--table-id requires a value.' >&2; exit 2; }
      TABLE_ID="$2"; shift ;;
    --table-name)
      (($# >= 2)) || { echo '--table-name requires a value.' >&2; exit 2; }
      TABLE_NAME="$2"; shift ;;
    --container)
      (($# >= 2)) || { echo '--container requires a value.' >&2; exit 2; }
      CONTAINER="$2"; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

printf 'MODE=%s\n' "$([[ $APPLY -eq 1 ]] && printf apply || printf dry-run)"
printf 'MACHINE=%s\n' "$MACHINE"
printf 'DB_FILE=%s\n' "$DB_FILE"
printf 'TABLE_ID=%s\n' "$TABLE_ID"
printf 'TABLE_NAME=%s\n' "$TABLE_NAME"
printf '%s\n' 'PLAN=create external n8n Data Table with unique eventKey, backup SQLite DB, restart n8n, verify schema.'

if ((APPLY == 0)); then
  exit 0
fi

encoded="$(base64 < "$ROOT_DIR/scripts/create-n8n-codex-idempotency-table.py" | tr -d '\n')"
remote_db="$(printf '%q' "$DB_FILE")"
remote_table_id="$(printf '%q' "$TABLE_ID")"
remote_table_name="$(printf '%q' "$TABLE_NAME")"
orb -m "$MACHINE" -u root bash -lc "
  set -euo pipefail
  test -f $remote_db
  echo '$encoded' | base64 -d >/tmp/create-n8n-codex-idempotency-table.py
  python3 /tmp/create-n8n-codex-idempotency-table.py $remote_db $remote_table_id $remote_table_name \"\$(date +%Y%m%d-%H%M%S)\"
"
orb -m "$MACHINE" -u root docker restart "$CONTAINER" >/dev/null
printf '%s\n' 'n8n restarted after idempotency table provisioning; no payload values were printed.'
