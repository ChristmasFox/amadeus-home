#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT_DIR"
MACHINE="${ORBSTACK_MACHINE:-ubuntu}"
DATA_ROOT="${OPENCLAW_DATA_DIR:-/DATA/AppData/openclaw}"
MODE=plan
APPROVAL=''
PASSPHRASE_FILE="${SKULD_SECRET_PASSPHRASE_FILE:-}"
ARTIFACT=''
MANIFEST=''
SECRET_ARTIFACT=''
SECRET_MANIFEST=''
APPROVED_ROOTS=()

usage() {
  printf '%s\n' 'Usage: scripts/restore-openclaw-cold-snapshot.sh [--plan|--apply --approve-avalon-move TOKEN] --artifact FILE --manifest FILE --secret-artifact FILE --secret-manifest FILE --passphrase-file FILE [--approve-replace config|workspace|data|notifications]...'
}
while (($#)); do
  case "$1" in
    --plan) MODE=plan ;;
    --apply) MODE=apply ;;
    --approve-avalon-move) shift; APPROVAL="${1:?--approve-avalon-move requires a token}" ;;
    --approve-replace) shift; APPROVED_ROOTS+=("${1:?--approve-replace requires a state root}") ;;
    --artifact) shift; ARTIFACT="${1:?--artifact requires a file}" ;;
    --manifest) shift; MANIFEST="${1:?--manifest requires a file}" ;;
    --secret-artifact) shift; SECRET_ARTIFACT="${1:?--secret-artifact requires a file}" ;;
    --secret-manifest) shift; SECRET_MANIFEST="${1:?--secret-manifest requires a file}" ;;
    --passphrase-file) shift; PASSPHRASE_FILE="${1:?--passphrase-file requires a file}" ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

[[ "$MACHINE" == nyannyan ]] || { printf 'RESTORE=BLOCKED destination OrbStack machine must be nyannyan (got %s).\n' "$MACHINE"; exit 1; }
host_name="$(scutil --get ComputerName 2>/dev/null || hostname -s)"
[[ "$host_name" == Amadeus-M204 ]] || { printf 'RESTORE=BLOCKED destination host identity mismatch (%s).\n' "$host_name"; exit 1; }
[[ -n "$PASSPHRASE_FILE" && -f "$PASSPHRASE_FILE" && ! -L "$PASSPHRASE_FILE" ]] || { printf '%s\n' 'A protected passphrase file is required.' >&2; exit 2; }
pass_mode="$(stat -f '%Lp' "$PASSPHRASE_FILE" 2>/dev/null || stat -c '%a' "$PASSPHRASE_FILE")"
case "$pass_mode" in 400|440|600|640) ;; *) printf 'Passphrase file has unsafe mode %s.\n' "$pass_mode" >&2; exit 2 ;; esac
for file in "$ARTIFACT" "$MANIFEST" "$SECRET_ARTIFACT" "$SECRET_MANIFEST"; do
  [[ -n "$file" && -f "$file" && ! -L "$file" ]] || { printf '%s\n' 'Restore artifact input is missing or symlinked.' >&2; exit 2; }
done

export STORAGE_PREFLIGHT_LIB_ONLY=1
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/storage-preflight.sh"
storage_host_volume_check "$EXTERNAL_STORAGE_ROOT" "$EXTERNAL_STORAGE_VOLUME_UUID"
storage_read_sentinel "$EXTERNAL_STORAGE_ROOT" "$EXTERNAL_STORAGE_SENTINEL_ID"
((STORAGE_FAILURES == 0)) || { printf '%s\n' 'RESTORE=BLOCKED Avalon identity/sentinel check failed.'; exit 1; }
python3 - "$EXTERNAL_STORAGE_ROOT" "$ARTIFACT" "$MANIFEST" "$SECRET_ARTIFACT" "$SECRET_MANIFEST" <<'PY'
import os, sys
root = os.path.realpath(sys.argv[1])
for value in sys.argv[2:]:
    path = os.path.realpath(value)
    if os.path.commonpath((root, path)) != root:
        raise SystemExit('restore inputs must remain on verified Avalon')
PY

[[ -d "$ARTIFACT" ]] && { printf '%s\n' 'Snapshot artifact path is a directory.' >&2; exit 2; }
state="$(orb -m "$MACHINE" -u root docker inspect --format '{{.State.Status}}' openclaw 2>/dev/null || printf absent)"
[[ "$state" != running ]] || { printf '%s\n' 'RESTORE=BLOCKED destination OpenClaw is running.'; exit 1; }
running="$(orb -m "$MACHINE" -u root docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null | awk 'tolower($0) ~ /openclaw/ {n++} END {print n+0}')" || { printf '%s\n' 'RESTORE=BLOCKED destination container inventory failed.'; exit 1; }
[[ "$running" == 0 ]] || { printf '%s\n' 'RESTORE=BLOCKED an OpenClaw container is running on destination.'; exit 1; }

helper_payload="$(base64 < "$ROOT_DIR/scripts/openclaw_continuity.py" | tr -d '\r\n')"
remote_code="import base64; ns={'__name__':'__main__'}; exec(compile(base64.b64decode('${helper_payload}'), 'openclaw_continuity.py', 'exec'), ns)"
process_probe="$(orb -m "$MACHINE" -u root python3 -c "$remote_code" process-probe 2>/dev/null || true)"
[[ "$process_probe" == OPENCLAW_PROCESS_COUNT=0 ]] || { printf '%s\n' 'RESTORE=BLOCKED destination OpenClaw/Gateway process probe failed.'; exit 1; }
for file in "$ARTIFACT" "$MANIFEST" "$SECRET_ARTIFACT" "$SECRET_MANIFEST"; do
  orb -m "$MACHINE" -u root test -f "$file" || { printf 'RESTORE=BLOCKED artifact is not visible in destination guest: %s\n' "$file"; exit 1; }
done
orb -m "$MACHINE" -u root test -d "$DATA_ROOT" && orb -m "$MACHINE" -u root test ! -L "$DATA_ROOT" || { printf '%s\n' 'RESTORE=BLOCKED destination AppData root is missing or symlinked.'; exit 1; }

remote_script='set -Eeuo pipefail
remote_code="$1"; action="$2"; artifact="$3"; manifest="$4"; secret_artifact="$5"; secret_manifest="$6"; data_root="$7"; token="$8"; shift 8
private_dir="$(mktemp -d /tmp/openclaw-restore-secret.XXXXXX)"
chmod 700 "$private_dir"
passphrase="$private_dir/passphrase"
umask 077
cat > "$passphrase"
chmod 600 "$passphrase"
cleanup() { rm -f "$passphrase"; rmdir "$private_dir" 2>/dev/null || true; }
trap cleanup EXIT
cmd_args=(python3 -c "$remote_code" restore-snapshot --artifact "$artifact" --manifest "$manifest" --secret-artifact "$secret_artifact" --secret-manifest "$secret_manifest" --destination-root "$data_root" --passphrase-file "$passphrase")
if [[ "$action" == apply ]]; then
  cmd_args+=(--apply --approval-token "$token")
  cmd_args+=("$@")
fi
"${cmd_args[@]}"'

if [[ "$MODE" == plan ]]; then
  action=plan
else
  [[ "$APPROVAL" == APPROVE_AVALON_MOVE_1_4_8 ]] || { printf '%s\n' 'Apply requires exact APPROVE_AVALON_MOVE_1_4_8.' >&2; exit 2; }
  [[ "${#APPROVED_ROOTS[@]}" -eq 4 ]] || { printf '%s\n' 'Apply requires one --approve-replace for each state root.' >&2; exit 2; }
  action=apply
fi

approval_args=()
if [[ "$MODE" == apply ]]; then
  for root in "${APPROVED_ROOTS[@]}"; do approval_args+=(--approve-replace "$root"); done
fi
if [[ "$MODE" == apply ]]; then
  cat "$PASSPHRASE_FILE" | orb -m "$MACHINE" -u root bash -lc "$remote_script" restore \
    "$remote_code" "$action" "$ARTIFACT" "$MANIFEST" "$SECRET_ARTIFACT" "$SECRET_MANIFEST" "$DATA_ROOT" "$APPROVAL" "${approval_args[@]}"
else
  cat "$PASSPHRASE_FILE" | orb -m "$MACHINE" -u root bash -lc "$remote_script" restore \
    "$remote_code" "$action" "$ARTIFACT" "$MANIFEST" "$SECRET_ARTIFACT" "$SECRET_MANIFEST" "$DATA_ROOT" "$APPROVAL"
fi
