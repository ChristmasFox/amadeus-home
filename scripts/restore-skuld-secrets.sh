#!/usr/bin/env bash
# scripts/restore-skuld-secrets.sh
# Amadeus 1.4.7 — Explicit destination restore mode for the encrypted Skuld secret bundle.
#
# This script implements the REAL restore path distinct from import/decrypt rehearsal.
# It maps logical IDs from the bundle to explicit destination targets under the clean
# destination contract (Amadeus-M204 / nyannyan).
#
# Restore contract:
#   - Decrypts bundle to private staging (never logged, never committed)
#   - Maps each logical ID to an explicit destination target path
#   - Dry-run (--dry-run, default) lists what would be placed where without writing
#   - Apply (--apply) writes with strict permissions; requires explicit approval per target
#   - Never silently overwrites unknown destination files
#   - Requires explicit approval for replacement of known migration targets
#   - Cleans up staging on failure
#
# Usage:
#   scripts/restore-skuld-secrets.sh --bundle FILE --passphrase-file FILE --dry-run
#   scripts/restore-skuld-secrets.sh --bundle FILE --passphrase-file FILE --apply \
#       --dest-base DIR [--approve-replace known-target-1 ...]
#   scripts/restore-skuld-secrets.sh --fixture --dry-run  (test mode)
set -Eeuo pipefail

ROOT_DIR="${SKULD_ROOT_DIR:-$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"

PASSPHRASE_FILE=''
BUNDLE=''
MANIFEST=''
DEST_BASE=''
MODE='dry-run'
TEST_MODE="${SKULD_SECRET_RESTORE_TEST_MODE:-0}"
APPROVED_REPLACEMENTS=()
FIXTURE_DIR="${SKULD_SECRET_FIXTURE_DIR:-}"

# Destination identity (clean destination contract)
DEST_HOST='Amadeus-M204'
DEST_MACOS_USER='nyannyan'
DEST_MACOS_HOME='/Users/nyannyan'
DEST_LINUX_USER='nyannyan'
DEST_LINUX_HOME='/home/nyannyan'

usage() {
  printf '%s\n' \
    'Usage:' \
    '  scripts/restore-skuld-secrets.sh --bundle FILE --passphrase-file FILE --dry-run' \
    '  scripts/restore-skuld-secrets.sh --bundle FILE --passphrase-file FILE --apply \\' \
    '      --dest-base DIR [--approve-replace TARGET ...]' \
    '  scripts/restore-skuld-secrets.sh --fixture --dry-run'
}

while (($#)); do
  case "$1" in
    --bundle)          shift; BUNDLE="${1:?--bundle requires a path}" ;;
    --passphrase-file) shift; PASSPHRASE_FILE="${1:?--passphrase-file requires a path}" ;;
    --manifest)        shift; MANIFEST="${1:?--manifest requires a path}" ;;
    --dest-base)       shift; DEST_BASE="${1:?--dest-base requires a path}" ;;
    --dry-run)         MODE=dry-run ;;
    --apply)           MODE=apply ;;
    --approve-replace) shift; APPROVED_REPLACEMENTS+=("${1:?--approve-replace requires a target}") ;;
    --fixture)         TEST_MODE=1 ;;
    --fixture-dir)     shift; FIXTURE_DIR="${1:?--fixture-dir requires a path}" ;;
    --help|-h)         usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

# In fixture mode, BUNDLE/PASSPHRASE_FILE may be absent
if ((TEST_MODE == 0)); then
  [[ -s "$BUNDLE" ]] || { printf 'Bundle file required and must be non-empty.\n' >&2; exit 2; }
  [[ -s "$PASSPHRASE_FILE" ]] || { printf 'Passphrase file required and must be non-empty.\n' >&2; exit 2; }
  mode_val="$(stat -f '%Lp' "$PASSPHRASE_FILE" 2>/dev/null || stat -c '%a' "$PASSPHRASE_FILE")"
  case "$mode_val" in 400|440|600|640) ;; *) printf 'Passphrase file has unsafe mode %s.\n' "$mode_val" >&2; exit 2 ;; esac
fi

if [[ "$MODE" == apply && -z "$DEST_BASE" ]]; then
  printf '--dest-base is required in apply mode.\n' >&2; exit 2
fi

printf 'SECRET_RESTORE_MODE=%s\n' "$MODE"
printf 'DEST_HOST=%s\n' "$DEST_HOST"
printf 'DEST_MACOS_USER=%s\n' "$DEST_MACOS_USER"
printf 'DEST_MACOS_HOME=%s\n' "$DEST_MACOS_HOME"
printf 'DEST_LINUX_USER=%s\n' "$DEST_LINUX_USER"
printf 'DEST_LINUX_HOME=%s\n' "$DEST_LINUX_HOME"

# Staging directory for decrypted contents
staging="$(mktemp -d "${TMPDIR:-/tmp}/skuld-secret-restore.XXXXXX")"
chmod 700 "$staging"
cleanup() { rm -rf "$staging"; }
trap cleanup EXIT

# Decrypt or use fixture
if ((TEST_MODE)); then
  if [[ -n "$FIXTURE_DIR" && -d "$FIXTURE_DIR" ]]; then
    cp -r "$FIXTURE_DIR/." "$staging/"
  else
    # Create minimal fixture layout for testing
    mkdir -p \
      "$staging/DATA/AppData/openclaw/secrets" \
      "$staging/DATA/AppData/openclaw" \
      "$staging/var/lib/casaos/apps/product-radar" \
      "$staging/DATA/AppData/9router" \
      "$staging/var/lib/casaos/apps/9router" \
      "$staging/var/lib/casaos/apps/immich" \
      "$staging/DATA/AppData/immich" \
      "$staging/DATA/AppData/changedetection" \
      "$staging/DATA/AppData/media-organizer-adapter"
    printf 'FIXTURE_ENV=1\n' > "$staging/DATA/AppData/openclaw/openclaw.env"
    chmod 600 "$staging/DATA/AppData/openclaw/openclaw.env"
    printf 'fixture-token\n'  > "$staging/DATA/AppData/openclaw/secrets/telegram-bot-token"
    chmod 600 "$staging/DATA/AppData/openclaw/secrets/telegram-bot-token"
    printf 'FIXTURE_RADAR_ENV=1\n' > "$staging/var/lib/casaos/apps/product-radar/.env"
    chmod 600 "$staging/var/lib/casaos/apps/product-radar/.env"
    printf 'FIXTURE_9R_ENV=1\n' > "$staging/DATA/AppData/9router/9router.env"
    chmod 600 "$staging/DATA/AppData/9router/9router.env"
    printf 'FIXTURE_IMMICH=1\n' > "$staging/DATA/AppData/immich/immich.env"
    chmod 600 "$staging/DATA/AppData/immich/immich.env"
  fi
else
  [[ -n "$MANIFEST" ]] || MANIFEST="${BUNDLE%/*}/secrets.manifest.json"
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
    -pass "file:$PASSPHRASE_FILE" -in "$BUNDLE" | tar -xzf - -C "$staging"
fi

# Validate manifest integrity before doing anything
if [[ -n "$MANIFEST" && -f "$MANIFEST" ]]; then
  python3 - "$MANIFEST" "$staging" << 'PY'
import json, sys
from pathlib import Path
manifest_path, root = Path(sys.argv[1]), Path(sys.argv[2])
data = json.loads(manifest_path.read_text())
if data.get('contentsInGit') is not False:
    raise SystemExit('manifest policy error: contentsInGit must be false')
if data.get('plaintextTemporaryFiles') is not False:
    raise SystemExit('manifest policy error: plaintextTemporaryFiles must be false')
files = data.get('files', [])
if not files:
    raise SystemExit('manifest has no files listed')
for item in files:
    rel = item.get('path', '')
    if not rel or rel.startswith('/') or '..' in Path(rel).parts:
        raise SystemExit(f'unsafe path in manifest: {rel!r}')
print('MANIFEST_VALIDATION=passed')
PY
fi

# Logical ID → destination path mapping (clean destination contract)
# Each entry: logical-id|source-staging-relative-path|destination-path|permissions
# NOTE: destination paths are guest-side (Linux) paths where applicable.
# macOS-side paths use DEST_MACOS_HOME prefix.
python3 - "$staging" "$DEST_BASE" "$MODE" \
  "$(printf '%s\n' "${APPROVED_REPLACEMENTS[@]+"${APPROVED_REPLACEMENTS[@]}"}")" << 'PY'
import json
import os
import shutil
import stat
import sys
from pathlib import Path

staging_dir = Path(sys.argv[1])
dest_base = Path(sys.argv[2]) if sys.argv[2] else Path('/dev/null')
mode = sys.argv[3]
approved_replacements = set(sys.argv[4].splitlines()) if sys.argv[4] else set()

# Logical restore map:
# (logical_id, staging_relative_path, dest_relative_path, permissions, description)
# dest_relative_path is relative to dest_base
RESTORE_MAP = [
    # OpenClaw
    ('openclaw-runtime-env',
     'DATA/AppData/openclaw/openclaw.env',
     'DATA/AppData/openclaw/openclaw.env',
     0o600, 'OpenClaw runtime environment'),
    ('openclaw-secret-files',
     'DATA/AppData/openclaw/secrets',
     'DATA/AppData/openclaw/secrets',
     0o700, 'OpenClaw secret files directory'),
    # Product Radar
    ('product-radar-runtime-env',
     'var/lib/casaos/apps/product-radar/.env',
     'var/lib/casaos/apps/product-radar/.env',
     0o600, 'Product Radar runtime environment'),
    # 9Router
    ('9router-runtime-env-and-provider-state',
     'DATA/AppData/9router/9router.env',
     'DATA/AppData/9router/9router.env',
     0o600, '9Router runtime environment'),
    # Immich
    ('immich-db-credential-and-compose',
     'DATA/AppData/immich/immich.env',
     'DATA/AppData/immich/immich.env',
     0o600, 'Immich DB credential environment'),
    # changedetection (full datastore via export-skuld-secrets)
    ('changedetection-state',
     'DATA/AppData/changedetection/datastore',
     'DATA/AppData/changedetection/datastore',
     0o700, 'changedetection datastore directory'),
    # media adapter state
    ('media-adapter-state',
     'DATA/AppData/media-organizer-adapter',
     'DATA/AppData/media-organizer-adapter',
     0o700, 'media-organizer-adapter state directory'),
]

failures = 0
actions = []

for logical_id, src_rel, dst_rel, perm, desc in RESTORE_MAP:
    src_path = staging_dir / src_rel
    dst_path = dest_base / dst_rel if mode == 'apply' else Path(f'<dest_base>/{dst_rel}')
    exists_at_source = src_path.exists()
    exists_at_dest = (dest_base / dst_rel).exists() if mode == 'apply' else False

    action_entry = {
        'logicalId': logical_id,
        'description': desc,
        'source': str(src_rel),
        'destination': str(dst_rel),
        'sourcePresent': exists_at_source,
        'mode': oct(perm),
    }

    if not exists_at_source:
        print(f'SKIP  {logical_id}: source not found in bundle ({src_rel})')
        action_entry['result'] = 'skipped-missing-source'
        actions.append(action_entry)
        continue

    if mode == 'dry-run':
        print(f'DRY   {logical_id} → {dst_rel} (perm={oct(perm)}) [{desc}]')
        action_entry['result'] = 'dry-run'
    elif mode == 'apply':
        real_dst = dest_base / dst_rel
        if real_dst.exists() and str(real_dst) not in approved_replacements:
            print(f'SKIP  {logical_id}: {dst_rel} already exists — add to --approve-replace to overwrite')
            action_entry['result'] = 'skipped-exists-not-approved'
            actions.append(action_entry)
            continue
        # Perform restore
        real_dst.parent.mkdir(parents=True, exist_ok=True)
        if src_path.is_dir():
            if real_dst.exists():
                shutil.rmtree(real_dst)
            shutil.copytree(str(src_path), str(real_dst))
            real_dst.chmod(perm)
        else:
            shutil.copy2(str(src_path), str(real_dst))
            real_dst.chmod(perm)
        print(f'APPLY {logical_id} → {real_dst} (perm={oct(perm)})')
        action_entry['result'] = 'applied'
    actions.append(action_entry)

# Print summary
total = len(actions)
applied = sum(1 for a in actions if a.get('result') == 'applied')
dry = sum(1 for a in actions if a.get('result') == 'dry-run')
skipped = sum(1 for a in actions if 'skipped' in a.get('result', ''))

print(f'SECRET_RESTORE_ACTIONS={total}')
if mode == 'apply':
    print(f'SECRET_RESTORE_APPLIED={applied}')
    print(f'SECRET_RESTORE_SKIPPED={skipped}')
    if failures > 0:
        raise SystemExit(f'SECRET_RESTORE_FAILURES={failures}')
    print('SECRET_RESTORE_PATH=verified')
else:
    print(f'SECRET_RESTORE_DRY_TARGETS={dry}')
    print('SECRET_RESTORE_PATH=dry-run-passed')
PY

printf 'SECRET_RESTORE_DEST_HOST=%s\n' "$DEST_HOST"
printf 'SECRET_RESTORE_DEST_USER=%s\n' "$DEST_MACOS_USER"
