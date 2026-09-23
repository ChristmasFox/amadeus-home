#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT_DIR"
MACHINE="${ORBSTACK_MACHINE:-ubuntu}"
DATA_ROOT="${OPENCLAW_DATA_DIR:-/DATA/AppData/openclaw}"
OUTPUT_DIR="$SKULD_BACKUP_ROOT/openclaw-cold"
MODE=plan
APPROVAL=''
PASSPHRASE_FILE="${SKULD_SECRET_PASSPHRASE_FILE:-}"
SECRET_ARTIFACT=''
SECRET_MANIFEST=''

usage() {
  printf '%s\n' 'Usage: scripts/openclaw-cold-snapshot.sh [--plan|--apply] [--approve-source-freeze TOKEN] --passphrase-file FILE --secret-artifact FILE --secret-manifest FILE [OUTPUT_DIR]'
}
while (($#)); do
  case "$1" in
    --plan) MODE=plan ;;
    --apply) MODE=apply ;;
    --approve-source-freeze) shift; APPROVAL="${1:?--approve-source-freeze requires a token}" ;;
    --passphrase-file) shift; PASSPHRASE_FILE="${1:?--passphrase-file requires a path}" ;;
    --secret-artifact) shift; SECRET_ARTIFACT="${1:?--secret-artifact requires a path}" ;;
    --secret-manifest) shift; SECRET_MANIFEST="${1:?--secret-manifest requires a path}" ;;
    --help|-h) usage; exit 0 ;;
    --*) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
    *) OUTPUT_DIR="$1" ;;
  esac
  shift
done

BLOCKERS=0
block() { printf 'BLOCKED  %s\n' "$1"; BLOCKERS=$((BLOCKERS + 1)); }
PASS=1
[[ "$(<"$ROOT_DIR/VERSION")" == 1.4.8 ]] || { block 'repository VERSION is not 1.4.8'; PASS=0; }
[[ "$(git -C "$ROOT_DIR" branch --show-current)" == main ]] || { block 'repository branch is not main'; PASS=0; }
[[ -z "$(git -C "$ROOT_DIR" status --porcelain)" ]] || { block 'repository worktree is not clean'; PASS=0; }
head="$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || true)"
remote_head="$(git -C "$ROOT_DIR" rev-parse origin/main 2>/dev/null || true)"
[[ -n "$head" && "$head" == "$remote_head" ]] || { block 'HEAD does not equal origin/main'; PASS=0; }
command -v orb >/dev/null 2>&1 || { block 'OrbStack CLI is unavailable'; PASS=0; }

remote_helper() {
  local helper_payload remote_code
  helper_payload="$(base64 < "$ROOT_DIR/scripts/openclaw_continuity.py" | tr -d '\r\n')"
  remote_code="import base64; ns={'__name__':'__main__'}; exec(compile(base64.b64decode('${helper_payload}'), 'openclaw_continuity.py', 'exec'), ns)"
  orb -m "$MACHINE" -u root python3 -c "$remote_code" "$@"
}

container_state='unknown'
if command -v orb >/dev/null 2>&1; then
  container_state="$(orb -m "$MACHINE" -u root docker inspect --format '{{.State.Status}}' openclaw 2>/dev/null || true)"
fi
if [[ "$container_state" != exited && "$container_state" != created ]]; then
  block 'source OpenClaw container is not confirmed stopped'
else
  printf 'PASS  source OpenClaw container state=%s\n' "$container_state"
fi
if command -v orb >/dev/null 2>&1; then
  running_containers="$(orb -m "$MACHINE" -u root docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null | awk 'tolower($0) ~ /openclaw/ {n++; print "active"} END {if (n==0) print "none"}')" || running_containers=unknown
  [[ "$running_containers" == none ]] || { block 'another OpenClaw container is active or container inventory is unavailable'; PASS=0; }
  process_probe="$(remote_helper process-probe 2>/dev/null || true)"
  [[ "$process_probe" == OPENCLAW_PROCESS_COUNT=0 ]] || { block 'an OpenClaw/Gateway process is active or process probe failed'; PASS=0; }
fi

if [[ "$MODE" == plan ]]; then
  printf 'COLD_SNAPSHOT=%s\n' "$([[ $BLOCKERS -eq 0 ]] && printf PLAN || printf BLOCKED)"
  exit 0
fi

[[ "$APPROVAL" == APPROVE_SOURCE_FREEZE_1_4_8 ]] || { printf '%s\n' 'Apply requires exact APPROVE_SOURCE_FREEZE_1_4_8.' >&2; exit 2; }
((PASS == 1 && BLOCKERS == 0)) || { printf '%s\n' 'COLD_SNAPSHOT=BLOCKED'; exit 1; }
[[ -n "$PASSPHRASE_FILE" && -s "$PASSPHRASE_FILE" ]] || { printf '%s\n' 'A non-empty passphrase file is required.' >&2; exit 2; }
[[ -f "$SECRET_ARTIFACT" && -f "$SECRET_MANIFEST" ]] || { printf '%s\n' 'A verified separate secret bundle and manifest are required.' >&2; exit 2; }
python3 "$ROOT_DIR/scripts/skuld_secret_bundle_auth.py" verify --artifact "$SECRET_ARTIFACT" --manifest "$SECRET_MANIFEST" --passphrase-file "$PASSPHRASE_FILE" >/dev/null

[[ -d "$EXTERNAL_STORAGE_ROOT" && ! -L "$EXTERNAL_STORAGE_ROOT" ]] || { printf '%s\n' 'COLD_SNAPSHOT=BLOCKED Avalon mount path is absent or symlinked.'; exit 1; }
export STORAGE_PREFLIGHT_LIB_ONLY=1
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/storage-preflight.sh"
storage_host_volume_check "$EXTERNAL_STORAGE_ROOT" "$EXTERNAL_STORAGE_VOLUME_UUID"
storage_read_sentinel "$EXTERNAL_STORAGE_ROOT" "$EXTERNAL_STORAGE_SENTINEL_ID"
((STORAGE_FAILURES == 0)) || { printf '%s\n' 'COLD_SNAPSHOT=BLOCKED Avalon identity/sentinel check failed.'; exit 1; }
python3 - "$EXTERNAL_STORAGE_ROOT" "$OUTPUT_DIR" <<'PY'
import os, sys
root, output = map(os.path.realpath, sys.argv[1:])
if os.path.commonpath((root, output)) != root:
    raise SystemExit('snapshot output must remain under verified Avalon')
PY

pass_mode="$(stat -f '%Lp' "$PASSPHRASE_FILE" 2>/dev/null || stat -c '%a' "$PASSPHRASE_FILE")"
case "$pass_mode" in 400|440|600|640) ;; *) printf 'Passphrase file has unsafe mode %s.\n' "$pass_mode" >&2; exit 2 ;; esac
image="$(orb -m "$MACHINE" -u root docker inspect --format '{{.Config.Image}}' openclaw 2>/dev/null)"
[[ -n "$image" ]] || { printf '%s\n' 'COLD_SNAPSHOT=BLOCKED source image identity is unavailable.'; exit 1; }
host_name="$(scutil --get ComputerName 2>/dev/null || hostname -s)"
git_commit="$head"
umask 077
stage="$(mktemp -d "${TMPDIR:-/tmp}/openclaw-cold-snapshot.XXXXXX")"
chmod 700 "$stage"
cleanup() { rm -rf "$stage"; }
trap cleanup EXIT
metadata="$stage/metadata.json"
before="$stage/inventory-before.json"
after="$stage/inventory-after.json"
python3 - "$metadata" "$host_name" "$MACHINE" "$git_commit" "$image" <<'PY'
import json, sys
from pathlib import Path
target, host, machine, commit, image = sys.argv[1:]
Path(target).write_text(json.dumps({
    'sourceHost': host,
    'sourceMachine': machine,
    'amadeusVersion': '1.4.8',
    'gitCommit': commit,
    'openclawImage': image,
}, separators=(',', ':')))
PY
remote_helper inventory "$DATA_ROOT" --private-credential-fingerprints --private-state-fingerprints > "$before"
chmod 600 "$before" "$metadata"

# Tar streams directly from the stopped guest into AES-256-CBC. No plaintext archive is staged.
snapshot_result="$(orb -m "$MACHINE" -u root tar --exclude=config/credentials -czf - -C "$DATA_ROOT" config workspace data notifications \
  | python3 "$ROOT_DIR/scripts/openclaw_continuity.py" snapshot-stream \
      --inventory-file "$before" --metadata-file "$metadata" --output-dir "$OUTPUT_DIR" \
      --passphrase-file "$PASSPHRASE_FILE" --secret-artifact "$SECRET_ARTIFACT" --secret-manifest "$SECRET_MANIFEST" \
      --approve-source-freeze "$APPROVAL")"
printf '%s\n' "$snapshot_result"
snapshot_manifest="$(printf '%s\n' "$snapshot_result" | sed -n 's/^COLD_SNAPSHOT_MANIFEST=//p')"
[[ -n "$snapshot_manifest" && -f "$snapshot_manifest" ]] || { printf '%s\n' 'COLD_SNAPSHOT=BLOCKED manifest output is unavailable.'; exit 1; }
python3 - "$snapshot_manifest" <<'PY'
import json, sys
from pathlib import Path
m = json.loads(Path(sys.argv[1]).read_text())
w, s, db = m['workspace'], m['state'], m['sqlite']
sessions = m['sessionState']
print(f"SOURCE_MEMORY_MD_SHA256={w['memoryMdSha256']}")
print(f"SOURCE_MEMORY_TREE_SHA256={w['memoryTreeSha256']}")
print(f"SOURCE_WORKSPACE_FILE_COUNT={w['fileCount']}")
print(f"SOURCE_WORKSPACE_BYTES={w['totalBytes']}")
print(f"SOURCE_IDENTITY_DB_SHA256={db['identityDbSha256']}")
print(f"SOURCE_IDENTITY_DB_INTEGRITY={db['identityDbIntegrity']}")
print(f"SOURCE_PUBG_DB_INTEGRITY={db['pubgDbIntegrity']}")
print(f"SOURCE_OPENCLAW_STATE_FILE_COUNT={s['fileCount']}")
print(f"SOURCE_OPENCLAW_STATE_BYTES={s['totalBytes']}")
print(f"SOURCE_SESSION_AND_JSONL_FILE_COUNT={sessions['sessionAndJsonlFileCount']}")
print(f"SOURCE_TRANSCRIPT_FILE_COUNT={sessions['transcriptFileCount']}")
PY

remote_helper inventory "$DATA_ROOT" --private-credential-fingerprints --private-state-fingerprints > "$after"
python3 - "$before" "$after" <<'PY'
import json, sys
from pathlib import Path
left, right = (json.loads(Path(p).read_text()) for p in sys.argv[1:])
keys = ('workspace', 'state', 'credentials', 'sessionState', 'sqlite', '_privateCredentialFingerprints', '_privateStateFingerprints')
if any(left[k] != right[k] for k in keys):
    raise SystemExit('source stopped-state inventory changed during snapshot')
PY
printf 'COLD_SNAPSHOT=verified\nSOURCE_OPENCLAW_STOPPED=YES\n'
