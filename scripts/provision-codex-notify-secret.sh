#!/usr/bin/env bash
set -euo pipefail

MACHINE="${ORBSTACK_MACHINE:-ubuntu}"
CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"
HOST_SECRET_FILE="${CODEX_NOTIFY_SECRET_FILE:-$CODEX_HOME_DIR/secrets/codex-notify-secret}"
REMOTE_SECRET_FILE="${N8N_CODEX_NOTIFY_SECRET_FILE:-/DATA/AppData/n8n/secrets/codex-notify-secret}"
APPLY=0

usage() {
  cat <<'USAGE'
Usage: scripts/provision-codex-notify-secret.sh [--dry-run] [--apply]

Create (only if missing) a local Codex notify shared-secret file, copy it to
the external n8n secret location, then sync the secret and admin identities into
n8n global variables. Secret values are never printed or committed.
USAGE
}

while (($#)); do
  case "$1" in
    --dry-run) APPLY=0 ;;
    --apply) APPLY=1 ;;
    --machine)
      (($# >= 2)) || { echo '--machine requires a value.' >&2; exit 2; }
      MACHINE="$2"
      shift
      ;;
    --host-secret-file)
      (($# >= 2)) || { echo '--host-secret-file requires a path.' >&2; exit 2; }
      HOST_SECRET_FILE="$2"
      shift
      ;;
    --remote-secret-file)
      (($# >= 2)) || { echo '--remote-secret-file requires a path.' >&2; exit 2; }
      REMOTE_SECRET_FILE="$2"
      shift
      ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

printf 'MODE=%s\n' "$([[ $APPLY -eq 1 ]] && printf apply || printf dry-run)"
printf 'MACHINE=%s\n' "$MACHINE"
printf 'HOST_SECRET_FILE=%s\n' "$HOST_SECRET_FILE"
printf 'REMOTE_SECRET_FILE=%s\n' "$REMOTE_SECRET_FILE"
printf '%s\n' 'PLAN=ensure external secret files, sync n8n variables, restart n8n; secret values are never printed.'

if ((APPLY == 0)); then
  exit 0
fi

secret_dir="$(dirname "$HOST_SECRET_FILE")"
umask 077
mkdir -p "$secret_dir"
chmod 700 "$secret_dir"
if [[ ! -s "$HOST_SECRET_FILE" ]]; then
  python3 -c 'import secrets; print(secrets.token_urlsafe(48))' >"$HOST_SECRET_FILE"
fi
chmod 600 "$HOST_SECRET_FILE"

secret_b64="$(base64 < "$HOST_SECRET_FILE" | tr -d '\n')"
remote_secret_q="$(printf '%q' "$REMOTE_SECRET_FILE")"
orb -m "$MACHINE" -u root bash -lc "
  set -euo pipefail
  install -d -m 700 \"\$(dirname $remote_secret_q)\"
  echo '$secret_b64' | base64 -d >$remote_secret_q
  chmod 600 $remote_secret_q
"

CODEX_NOTIFY_SECRET_FILE="$REMOTE_SECRET_FILE" \
  ./scripts/sync-n8n-admin-identities.sh --apply --machine "$MACHINE" --secret-file "$REMOTE_SECRET_FILE"
printf '%s\n' 'Codex notify shared secret provisioned and n8n variables synchronized; secret values were not printed.'
