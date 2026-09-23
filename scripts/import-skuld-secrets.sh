#!/usr/bin/env bash
set -Eeuo pipefail

PASSPHRASE_FILE=''
BUNDLE=''
MANIFEST=''
EXPECTED_MANIFEST=''
ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
while (($#)); do
  case "$1" in
    --passphrase-file) shift; PASSPHRASE_FILE="${1:?--passphrase-file requires a path}" ;;
    --bundle) shift; BUNDLE="${1:?--bundle requires a path}" ;;
    --manifest) shift; MANIFEST="${1:?--manifest requires a path}" ;;
    --expected-manifest) shift; EXPECTED_MANIFEST="${1:?--expected-manifest requires a path}" ;;
    --help|-h) printf '%s\n' 'Usage: scripts/import-skuld-secrets.sh --bundle FILE --passphrase-file FILE [--manifest FILE]'; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done
[[ -s "$BUNDLE" && -s "$PASSPHRASE_FILE" ]] || { printf '%s\n' 'Encrypted bundle and passphrase file are required.' >&2; exit 2; }
[[ -n "$MANIFEST" ]] || MANIFEST="${BUNDLE%/*}/secrets.manifest.json"
[[ -n "$EXPECTED_MANIFEST" ]] || EXPECTED_MANIFEST="$ROOT_DIR/docs/OPERATION_SKULD_MIGRATION_MANIFEST.json"
[[ -s "$MANIFEST" ]] || { printf '%s\n' 'Secret bundle manifest is required.' >&2; exit 2; }
mode="$(stat -f '%Lp' "$PASSPHRASE_FILE" 2>/dev/null || stat -c '%a' "$PASSPHRASE_FILE")"
case "$mode" in 400|440|600|640) ;; *) printf 'Passphrase file has unsafe mode %s.\n' "$mode" >&2; exit 2 ;; esac
python3 "$ROOT_DIR/scripts/skuld_secret_bundle_auth.py" verify \
  --artifact "$BUNDLE" --manifest "$MANIFEST" --passphrase-file "$PASSPHRASE_FILE"
staging="$(mktemp -d "${TMPDIR:-/tmp}/skuld-secret-restore.XXXXXX")"
chmod 700 "$staging"
cleanup() { rm -rf "$staging"; }
trap cleanup EXIT
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$PASSPHRASE_FILE" -in "$BUNDLE" | tar -xzf - -C "$staging"
python3 - "$MANIFEST" "$staging" "$EXPECTED_MANIFEST" <<'PY'
import hashlib
import json
import os
import stat
import sys
from pathlib import Path
manifest_path, root, expected_path = map(Path, sys.argv[1:])
data = json.loads(manifest_path.read_text())
expected = json.loads(expected_path.read_text()) if expected_path.is_file() else {}
expected_ids = {item.get('id') for item in expected.get('secretInventory', []) if item.get('required', True)}
actual_ids = set(data.get('logicalIds', []))
if sorted(x for x in expected_ids if x and x not in actual_ids):
    raise SystemExit('secret bundle logical-id coverage is incomplete')
if (
    data.get('contentsInGit') is not False
    or data.get('plaintextTemporaryFiles') is not True
    or data.get('plaintextTemporaryFilesRemovedOnExit') is not True
    or data.get('temporaryStagingPermissions') != '0700'
    or data.get('restorePolicy') != 'decrypt-to-private-staging-validate-metadata-and-normalize-openclaw-credentials-to-1000:1000'
):
    raise SystemExit('secret manifest policy invalid')
files = data.get('files')
if not isinstance(files, list) or not files:
    raise SystemExit('secret manifest has no file metadata')
for item in files:
    rel = item.get('path')
    path_hash = item.get('pathSha256')
    if isinstance(path_hash, str):
        if item.get('pathScope') != 'openclaw-runtime-credentials' or len(path_hash) != 64:
            raise SystemExit('invalid opaque credential path metadata')
        matches = []
        for candidate in root.rglob('*'):
            try:
                info = candidate.lstat()
            except FileNotFoundError:
                continue
            if stat.S_ISREG(info.st_mode) and hashlib.sha256(candidate.relative_to(root).as_posix().encode()).hexdigest() == path_hash:
                matches.append(candidate)
        if len(matches) != 1:
            raise SystemExit('opaque credential path is missing or ambiguous in encrypted artifact')
        path = matches[0]
    else:
        if not isinstance(rel, str) or rel.startswith('/') or '..' in Path(rel).parts:
            raise SystemExit('unsafe secret restore path')
        path = root / rel
        try:
            if not stat.S_ISREG(path.lstat().st_mode):
                raise SystemExit('secret bundle entry is not a regular file')
        except FileNotFoundError as exc:
            raise SystemExit('secret bundle file missing from encrypted artifact') from exc
    expected_mode = int(str(item.get('mode', '0')), 8)
    info = path.lstat()
    if stat.S_IMODE(info.st_mode) != expected_mode or info.st_size != int(item.get('size', -1)):
        raise SystemExit('secret bundle file mode mismatch')
print('SECRET_RESTORE_FILES_VALID=passed')
PY
printf '%s\n' 'SECRET_RESTORE_REHEARSAL=passed'
