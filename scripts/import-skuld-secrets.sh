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
staging="$(mktemp -d "${TMPDIR:-/tmp}/skuld-secret-restore.XXXXXX")"
chmod 700 "$staging"
cleanup() { rm -rf "$staging"; }
trap cleanup EXIT
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$PASSPHRASE_FILE" -in "$BUNDLE" | tar -xzf - -C "$staging"
python3 - "$MANIFEST" "$staging" "$EXPECTED_MANIFEST" <<'PY'
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
if data.get('contentsInGit') is not False or data.get('plaintextTemporaryFiles') is not False:
    raise SystemExit('secret manifest policy invalid')
files = data.get('files')
if not isinstance(files, list) or not files:
    raise SystemExit('secret manifest has no file metadata')
for item in files:
    rel = item.get('path')
    if not isinstance(rel, str) or rel.startswith('/') or '..' in Path(rel).parts:
        raise SystemExit('unsafe secret restore path')
    path = root / rel
    if not path.is_file():
        raise SystemExit('secret bundle file missing from encrypted artifact')
    expected_mode = int(str(item.get('mode', '0')), 8)
    if stat.S_IMODE(path.stat().st_mode) != expected_mode:
        raise SystemExit('secret bundle file mode mismatch')
print('SECRET_RESTORE_FILES_VALID=passed')
PY
printf '%s\n' 'SECRET_RESTORE_REHEARSAL=passed'
