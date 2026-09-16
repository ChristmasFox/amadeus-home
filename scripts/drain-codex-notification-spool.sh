#!/usr/bin/env bash
set -euo pipefail

CODEX_HOME_DIR="${CODEX_HOME:-${HOME:-/tmp}/.codex}"
SPOOL_DIR="${CODEX_NOTIFY_SPOOL_DIR:-$CODEX_HOME_DIR/spool/kurisu-notifications}"
WEBHOOK_URL="${CODEX_NOTIFY_URL:-http://127.0.0.1:5310/kurisu/notifications/events}"
SECRET_FILE="${CODEX_NOTIFY_SECRET_FILE:-$CODEX_HOME_DIR/secrets/codex-notify-secret}"
APPLY=0

usage() {
  cat <<'USAGE'
Usage: scripts/drain-codex-notification-spool.sh [--dry-run] [--apply]

Replay only the local, Git-compatible Codex notification spool into the
runtime-owned notification ingress. Successful files are moved to a local
processed directory so the operation is recoverable; default is dry-run.
USAGE
}

while (($#)); do
  case "$1" in
    --dry-run) APPLY=0 ;;
    --apply) APPLY=1 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

printf 'MODE=%s\n' "$([[ $APPLY -eq 1 ]] && printf apply || printf dry-run)"
printf 'SPOOL_DIR=%s\n' "$SPOOL_DIR"

if [[ ! -d "$SPOOL_DIR" ]]; then
  echo 'SPOOL_COUNT=0'
  exit 0
fi

secret="${CODEX_NOTIFY_SECRET:-}"
if [[ -z "$secret" && -r "$SECRET_FILE" ]]; then
  IFS= read -r secret <"$SECRET_FILE" || true
fi
secret="${secret//$'\r'/}"
if ((APPLY == 1)) && [[ -z "$secret" ]]; then
  echo 'Cannot apply spool drain without a notification secret.' >&2
  exit 1
fi

processed_dir="$SPOOL_DIR/processed"
count=0
sent=0
for file in "$SPOOL_DIR"/*.json; do
  [[ -f "$file" ]] || continue
  count=$((count + 1))
  if ((APPLY == 0)); then
    printf 'PENDING=%s\n' "$(basename "$file")"
    continue
  fi
  if /usr/bin/curl --fail --silent --show-error --output /dev/null --connect-timeout 2 --max-time 5 \
    -H 'content-type: application/json' -H "X-Kurisu-Notification-Secret: $secret" \
    --data-binary @"$file" "$WEBHOOK_URL"; then
    mkdir -p "$processed_dir"
    chmod 700 "$processed_dir" 2>/dev/null || true
    mv -f "$file" "$processed_dir/$(basename "$file")"
    sent=$((sent + 1))
  else
    echo "Notification spool delivery failed: $(basename "$file")" >&2
  fi
done
printf 'SPOOL_COUNT=%s\n' "$count"
printf 'SENT_COUNT=%s\n' "$sent"
