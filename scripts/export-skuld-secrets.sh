#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${SKULD_ROOT_DIR:-$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT_DIR"
MACHINE="${ORBSTACK_MACHINE:-ubuntu}"
TEST_MODE="${SKULD_SECRET_TEST_MODE:-0}"
APPLY=0
PASSPHRASE_FILE=''
OUTPUT_DIR="${SKULD_BACKUP_ROOT:-${TMPDIR:-/tmp}/operation-skuld}"
SOURCE_DIR=''
SOURCE_FREEZE_APPROVAL=''

usage() { printf '%s\n' 'Usage: scripts/export-skuld-secrets.sh [--apply --approve-source-freeze APPROVE_SOURCE_FREEZE_1_4_8] --passphrase-file FILE [--output-dir DIR]'; }
while (($#)); do
  case "$1" in
    --apply) APPLY=1 ;;
    --passphrase-file) shift; PASSPHRASE_FILE="${1:?--passphrase-file requires a path}" ;;
    --output-dir) shift; OUTPUT_DIR="${1:?--output-dir requires a path}" ;;
    --approve-source-freeze) shift; SOURCE_FREEZE_APPROVAL="${1:?--approve-source-freeze requires a token}" ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done
[[ -n "$PASSPHRASE_FILE" && -s "$PASSPHRASE_FILE" ]] || { printf '%s\n' 'A non-empty passphrase file is required.' >&2; exit 2; }
mode="$(stat -f '%Lp' "$PASSPHRASE_FILE" 2>/dev/null || stat -c '%a' "$PASSPHRASE_FILE")"
case "$mode" in 400|440|600|640) ;; *) printf 'Passphrase file has unsafe mode %s.\n' "$mode" >&2; exit 2 ;; esac

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
bundle_dir="$OUTPUT_DIR/secrets-$stamp"
bundle="$bundle_dir/secrets.tar.enc"
manifest="$bundle_dir/secrets.manifest.json"
printf 'SECRET_BUNDLE_PLAN=%s\n' "$bundle_dir"
if ((APPLY == 0)); then exit 0; fi

if ((TEST_MODE == 0)); then
  [[ "$SOURCE_FREEZE_APPROVAL" == 'APPROVE_SOURCE_FREEZE_1_4_8' ]] || { printf '%s\n' 'Secret export apply requires exact APPROVE_SOURCE_FREEZE_1_4_8.' >&2; exit 2; }
  source_container_state="$(orb -m "$MACHINE" -u root docker inspect --format '{{.State.Status}}' openclaw 2>/dev/null || true)"
  [[ "$source_container_state" == exited || "$source_container_state" == created ]] || { printf '%s\n' 'SECRET_BUNDLE=BLOCKED source OpenClaw is not stopped.' >&2; exit 1; }
  running_openclaw="$(orb -m "$MACHINE" -u root docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null | awk 'tolower($0) ~ /openclaw/ {print "active"; exit}')"
  [[ -z "$running_openclaw" ]] || { printf '%s\n' 'SECRET_BUNDLE=BLOCKED another OpenClaw container is running.' >&2; exit 1; }
  STORAGE_PREFLIGHT_LIB_ONLY=1 source "$ROOT_DIR/scripts/storage-preflight.sh"
  storage_host_volume_check "$EXTERNAL_STORAGE_ROOT" "$EXTERNAL_STORAGE_VOLUME_UUID"
  ((STORAGE_FAILURES == 0)) || { printf '%s\n' 'SECRET_BUNDLE=BLOCKED Avalon identity check failed.' >&2; exit 1; }
  storage_read_sentinel "$EXTERNAL_STORAGE_ROOT" "$EXTERNAL_STORAGE_SENTINEL_ID"
  ((STORAGE_FAILURES == 0)) || { printf '%s\n' 'SECRET_BUNDLE=BLOCKED Avalon sentinel check failed.' >&2; exit 1; }
  python3 - "$EXTERNAL_STORAGE_ROOT" "$OUTPUT_DIR" <<'PY'
import os, sys
root, output = map(os.path.realpath, sys.argv[1:])
parent = output
while not os.path.exists(parent) and parent != os.path.dirname(parent): parent = os.path.dirname(parent)
if os.path.commonpath((root, parent)) != root:
    raise SystemExit('secret bundle output is outside verified external storage')
PY
fi

if ((TEST_MODE)); then
  SOURCE_DIR="${SKULD_SECRET_SOURCE_DIR:?SKULD_SECRET_SOURCE_DIR is required in test mode}"
else
  SOURCE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/skuld-secret-source.XXXXXX")"
  chmod 700 "$SOURCE_DIR"
  cleanup_source() { rm -rf "$SOURCE_DIR"; }
  trap cleanup_source EXIT
  mkdir -p "$SOURCE_DIR/openclaw/secrets" "$SOURCE_DIR/9router" "$SOURCE_DIR/immich" "$SOURCE_DIR/changedetection" "$SOURCE_DIR/media-adapter"
  # Stream/copy only into a temporary local staging tree. Values never enter Git or output.
  orb -m "$MACHINE" -u root bash -lc 'set -Eeuo pipefail; test -d /DATA/AppData/openclaw/config/credentials/whatsapp; test -n "$(find /DATA/AppData/openclaw/config/credentials/whatsapp -type f -print -quit)"; tar --ignore-failed-read -czf - \
    /DATA/AppData/openclaw/openclaw.env \
    /DATA/AppData/openclaw/secrets \
    /DATA/AppData/openclaw/config/credentials \
    /var/lib/casaos/apps/product-radar/.env \
    /var/lib/casaos/apps/9router/docker-compose.yml \
    /DATA/AppData/9router/9router.env \
    /var/lib/casaos/apps/immich/docker-compose.yml \
    /DATA/AppData/immich/immich.env \
    /DATA/AppData/9router/data \
    /DATA/AppData/changedetection/datastore \
    /DATA/AppData/media-organizer-adapter' | tar -xzf - -C "$SOURCE_DIR"
fi

WHATSAPP_CREDENTIALS="$SOURCE_DIR/DATA/AppData/openclaw/config/credentials/whatsapp"
[[ -d "$WHATSAPP_CREDENTIALS" ]] || { printf '%s\n' 'Required OpenClaw WhatsApp credential state is missing.' >&2; exit 1; }
find "$WHATSAPP_CREDENTIALS" -type f -print -quit | grep -q . || { printf '%s\n' 'Required OpenClaw WhatsApp credential state is empty.' >&2; exit 1; }

mkdir -p "$bundle_dir"
chmod 700 "$bundle_dir"
manifest_tmp="$(mktemp "$bundle_dir/.manifest.XXXXXX")"
cleanup_manifest() { rm -f "$manifest_tmp"; [[ "$TEST_MODE" == 1 ]] || rm -rf "$SOURCE_DIR"; }
trap cleanup_manifest EXIT
python3 - "$manifest_tmp" "$SOURCE_DIR" "$ROOT_DIR/docs/OPERATION_SKULD_MIGRATION_MANIFEST.json" <<'PY'
import hashlib
import json
import os
import sys
from pathlib import Path
out, root, source_manifest = map(Path, sys.argv[1:])
files = []
for path in sorted(p for p in root.rglob('*') if p.is_file()):
    rel = path.relative_to(root).as_posix()
    item = {'mode': format(path.stat().st_mode & 0o777, '04o'), 'size': path.stat().st_size}
    if rel.startswith('DATA/AppData/openclaw/config/credentials/'):
        if path.is_symlink():
            raise SystemExit('OpenClaw credential bundle refuses symlinked files')
        item['pathSha256'] = hashlib.sha256(rel.encode()).hexdigest()
        item['pathScope'] = 'openclaw-runtime-credentials'
    else:
        item['path'] = rel
    files.append(item)
source = json.loads(source_manifest.read_text())
logical_ids = sorted({item['id'] for item in source.get('secretInventory', []) if item.get('required', True)})
logical_ids += ['openclaw-runtime-env', 'openclaw-secret-files', 'openclaw-runtime-credentials', 'product-radar-runtime-env', '9router-runtime-env-and-provider-state', 'immich-db-credential-and-compose', 'changedetection-state', 'media-adapter-state']
logical_ids = sorted(set(logical_ids))
out.write_text(json.dumps({
    'schemaVersion': 2,
    'encryptedArtifact': 'secrets.tar.enc',
    'logicalIds': logical_ids,
    'files': files,
    'contentsInGit': False,
    'plaintextTemporaryFiles': True,
    'plaintextTemporaryFilesRemovedOnExit': True,
    'temporaryStagingPermissions': '0700',
    'restorePolicy': 'decrypt-to-private-staging-validate-metadata-and-normalize-openclaw-credentials-to-1000:1000',
}, indent=2) + '\n')
PY
mv "$manifest_tmp" "$manifest"
chmod 600 "$manifest"
# GNU/BSD tar both accept a relative source directory and do not print member data.
tar -C "$SOURCE_DIR" -czf - . | openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 -md sha256 -pass "file:$PASSPHRASE_FILE" -out "$bundle"
chmod 600 "$bundle"
python3 "$ROOT_DIR/scripts/skuld_secret_bundle_auth.py" seal \
  --artifact "$bundle" --manifest "$manifest" --passphrase-file "$PASSPHRASE_FILE"
shasum -a 256 "$bundle" | awk '{print $1 "  " $2}' > "$bundle.sha256"
chmod 600 "$bundle.sha256"
bundle_sha256="$(awk '{print $1}' "$bundle.sha256")"
printf 'SECRET_BUNDLE=%s\nSECRET_MANIFEST=%s\nSECRET_BUNDLE_SHA256=%s\n' "$bundle" "$manifest" "$bundle_sha256"
