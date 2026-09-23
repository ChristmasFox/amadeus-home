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
AVALON_APPROVAL=''

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
    '      --approve-avalon-move APPROVE_AVALON_MOVE_1_4_8 --dest-base DIR [--approve-replace TARGET ...]' \
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
    --approve-avalon-move) shift; AVALON_APPROVAL="${1:?--approve-avalon-move requires a token}" ;;
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
  mode_val="$(stat -c '%a' "$PASSPHRASE_FILE" 2>/dev/null || stat -f '%Lp' "$PASSPHRASE_FILE")"
  case "$mode_val" in 400|440|600|640) ;; *) printf 'Passphrase file has unsafe mode %s.\n' "$mode_val" >&2; exit 2 ;; esac
fi

if [[ "$MODE" == apply && -z "$DEST_BASE" ]]; then
  printf '--dest-base is required in apply mode.\n' >&2; exit 2
fi
if [[ "$MODE" == apply && "$AVALON_APPROVAL" != 'APPROVE_AVALON_MOVE_1_4_8' ]]; then
  printf '%s\n' 'Apply requires the exact APPROVE_AVALON_MOVE_1_4_8 token.' >&2; exit 2
fi
if [[ "$MODE" == apply ]]; then
  [[ -d "$DEST_BASE" && ! -L "$DEST_BASE" ]] || { printf '%s\n' 'Destination base must be an existing real directory.' >&2; exit 2; }
  if ((TEST_MODE)); then
    destination_real="$(cd -- "$DEST_BASE" && pwd -P)"
    temporary_real="$(cd -- "${TMPDIR:-/tmp}" && pwd -P)"
    [[ "$destination_real" == "$temporary_real"/* ]] || { printf '%s\n' 'Fixture restore destination must be below TMPDIR.' >&2; exit 2; }
  fi
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
      "$staging/DATA/AppData/openclaw/config/credentials/whatsapp/secondary" \
      "$staging/var/lib/casaos/apps/product-radar" \
      "$staging/DATA/AppData/9router" \
      "$staging/var/lib/casaos/apps/9router" \
      "$staging/var/lib/casaos/apps/immich" \
      "$staging/DATA/AppData/immich" \
      "$staging/DATA/AppData/changedetection" \
      "$staging/DATA/AppData/media-organizer-adapter"
    chmod 0751 "$staging/DATA/AppData/openclaw/config/credentials"
    chmod 0710 "$staging/DATA/AppData/openclaw/config/credentials/whatsapp"
    printf 'FIXTURE_ENV=1\n' > "$staging/DATA/AppData/openclaw/openclaw.env"
    chmod 600 "$staging/DATA/AppData/openclaw/openclaw.env"
    printf 'fixture-token\n'  > "$staging/DATA/AppData/openclaw/secrets/telegram-bot-token"
    chmod 600 "$staging/DATA/AppData/openclaw/secrets/telegram-bot-token"
    printf 'fixture-whatsapp-state\n' > "$staging/DATA/AppData/openclaw/config/credentials/whatsapp/secondary/creds.json"
    chmod 600 "$staging/DATA/AppData/openclaw/config/credentials/whatsapp/secondary/creds.json"
    printf 'FIXTURE_RADAR_ENV=1\n' > "$staging/var/lib/casaos/apps/product-radar/.env"
    chmod 600 "$staging/var/lib/casaos/apps/product-radar/.env"
    printf 'FIXTURE_9R_ENV=1\n' > "$staging/DATA/AppData/9router/9router.env"
    chmod 600 "$staging/DATA/AppData/9router/9router.env"
    printf 'FIXTURE_IMMICH=1\n' > "$staging/DATA/AppData/immich/immich.env"
    chmod 600 "$staging/DATA/AppData/immich/immich.env"
  fi
else
  [[ -n "$MANIFEST" ]] || MANIFEST="${BUNDLE%/*}/secrets.manifest.json"
  python3 "$ROOT_DIR/scripts/skuld_secret_bundle_auth.py" verify \
    --artifact "$BUNDLE" --manifest "$MANIFEST" --passphrase-file "$PASSPHRASE_FILE"
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
    -pass "file:$PASSPHRASE_FILE" -in "$BUNDLE" | tar -xzf - -C "$staging"
fi

# Validate manifest integrity before doing anything
if [[ -n "$MANIFEST" && -f "$MANIFEST" ]]; then
  python3 - "$MANIFEST" "$staging" << 'PY'
import hashlib, json, stat, sys
from pathlib import Path
manifest_path, root = Path(sys.argv[1]), Path(sys.argv[2])
data = json.loads(manifest_path.read_text())
if data.get('contentsInGit') is not False:
    raise SystemExit('manifest policy error: contentsInGit must be false')
if data.get('plaintextTemporaryFiles') is not True:
    raise SystemExit('manifest policy error: plaintextTemporaryFiles must be true')
if data.get('plaintextTemporaryFilesRemovedOnExit') is not True:
    raise SystemExit('manifest policy error: temporary plaintext cleanup must be guaranteed')
if data.get('temporaryStagingPermissions') != '0700':
    raise SystemExit('manifest policy error: temporary staging must use mode 0700')
if data.get('restorePolicy') != 'decrypt-to-private-staging-validate-metadata-and-normalize-openclaw-credentials-to-1000:1000':
    raise SystemExit('manifest policy error: restore policy is not the current verified policy')
files = data.get('files', [])
if not files:
    raise SystemExit('manifest has no files listed')
for item in files:
    rel = item.get('path', '')
    path_hash = item.get('pathSha256')
    if isinstance(path_hash, str):
        if item.get('pathScope') != 'openclaw-runtime-credentials' or len(path_hash) != 64:
            raise SystemExit('invalid opaque OpenClaw credential path metadata')
        matches = [p for p in root.rglob('*') if stat.S_ISREG(p.lstat().st_mode) and hashlib.sha256(p.relative_to(root).as_posix().encode()).hexdigest() == path_hash]
        if len(matches) != 1:
            raise SystemExit('opaque credential path is missing or ambiguous')
        path = matches[0]
    else:
        if not rel or rel.startswith('/') or '..' in Path(rel).parts:
            raise SystemExit(f'unsafe path in manifest: {rel!r}')
        path = root / rel
        try:
            if not stat.S_ISREG(path.lstat().st_mode):
                raise SystemExit('manifest entry is not a regular file')
        except FileNotFoundError as exc:
            raise SystemExit('manifest file is missing') from exc
    info = path.lstat()
    if stat.S_IMODE(info.st_mode) != int(str(item.get('mode', '0')), 8) or info.st_size != int(item.get('size', -1)):
        raise SystemExit('manifest file metadata mismatch')
print('MANIFEST_VALIDATION=passed')
PY
fi

# Logical ID → destination path mapping (clean destination contract)
# Each entry: logical-id|source-staging-relative-path|destination-path|permissions
# NOTE: destination paths are guest-side (Linux) paths where applicable.
# macOS-side paths use DEST_MACOS_HOME prefix.
python3 - "$staging" "$DEST_BASE" "$MODE" \
  "$(printf '%s\n' "${APPROVED_REPLACEMENTS[@]+"${APPROVED_REPLACEMENTS[@]}"}")" "$TEST_MODE" "$ROOT_DIR" << 'PY'
import json
import os
import shutil
import stat
import sys
import uuid
from pathlib import Path

staging_dir = Path(sys.argv[1])
dest_base = Path(sys.argv[2]) if sys.argv[2] else Path('/dev/null')
mode = sys.argv[3]
approved_replacements = {os.path.normpath(value) for value in sys.argv[4].splitlines()} if sys.argv[4] else set()
fixture_mode = sys.argv[5] == '1'
sys.path.insert(0, str(Path(sys.argv[6]) / 'scripts'))
from openclaw_credentials_owner import normalize_runtime_tree

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
    ('whatsapp-runtime-state',
     'DATA/AppData/openclaw/config/credentials',
     'DATA/AppData/openclaw/config/credentials',
     None, 'OpenClaw channel credential state (preserve source modes)'),
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
    exists_at_dest = ((dest_base / dst_rel).exists() or (dest_base / dst_rel).is_symlink()) if mode == 'apply' else False

    action_entry = {
        'logicalId': logical_id,
        'description': desc,
        'source': str(src_rel),
        'destination': str(dst_rel),
        'sourcePresent': exists_at_source,
        'mode': oct(perm) if perm is not None else 'preserve-source',
    }

    if not exists_at_source:
        print(f'SKIP  {logical_id}: source not found in bundle ({src_rel})')
        action_entry['result'] = 'skipped-missing-source'
        actions.append(action_entry)
        continue

    if mode == 'dry-run':
        permission = oct(perm) if perm is not None else 'preserve-source'
        print(f'DRY   {logical_id} → {dst_rel} (perm={permission}) [{desc}]')
        action_entry['result'] = 'dry-run'
    elif mode == 'apply':
        real_dst = dest_base / dst_rel
        path_parts = Path(dst_rel).parts
        parent = dest_base
        parent_is_symlink = dest_base.is_symlink()
        for component in path_parts[:-1]:
            parent = parent / component
            parent_is_symlink = parent_is_symlink or parent.is_symlink()
        if parent_is_symlink or real_dst.is_symlink():
            print(f'BLOCK {logical_id}: symlinked destination path refused')
            failures += 1
            action_entry['result'] = 'blocked-symlink'
            actions.append(action_entry)
            continue
        if exists_at_dest and str(real_dst) not in approved_replacements:
            print(f'SKIP  {logical_id}: {dst_rel} already exists — add to --approve-replace to overwrite')
            action_entry['result'] = 'skipped-exists-not-approved'
            actions.append(action_entry)
            continue
        real_dst.parent.mkdir(parents=True, exist_ok=True)
        backup_path = None
        if exists_at_dest:
            backup_base = dest_base / '.operation-skuld-secret-restore-backups'
            if backup_base.is_symlink():
                print(f'BLOCK {logical_id}: symlinked rollback root refused')
                failures += 1
                action_entry['result'] = 'blocked-symlink'
                actions.append(action_entry)
                continue
            backup_root = backup_base / uuid.uuid4().hex
            backup_target = backup_root / dst_rel
            backup_base.mkdir(mode=0o700, exist_ok=True)
            backup_base.chmod(0o700)
            backup_root.mkdir(mode=0o700)
            backup_target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            os.rename(real_dst, backup_target)
            backup_path = backup_target
            print(f'SECRET_RESTORE_BACKUP={backup_target}')
        prepared_path = real_dst.with_name(f'.{real_dst.name}.restore-{uuid.uuid4().hex}')
        try:
            if src_path.is_dir():
                shutil.copytree(str(src_path), str(prepared_path), symlinks=True)
                if perm is not None:
                    prepared_path.chmod(perm)
                if logical_id == 'whatsapp-runtime-state' and not fixture_mode:
                    if os.geteuid() != 0:
                        raise PermissionError('OpenClaw credential restore must run as guest root')
                    entries = normalize_runtime_tree(prepared_path)
                    print(f'OPENCLAW_CREDENTIAL_OWNER_NORMALIZED=1000:1000 entries={entries}')
            else:
                shutil.copy2(str(src_path), str(prepared_path), follow_symlinks=False)
                prepared_path.chmod(perm, follow_symlinks=False)
            os.rename(prepared_path, real_dst)
        except BaseException:
            if prepared_path.is_dir() and not prepared_path.is_symlink():
                shutil.rmtree(prepared_path)
            elif prepared_path.exists() or prepared_path.is_symlink():
                prepared_path.unlink()
            if backup_path is not None and backup_path.exists() and not (real_dst.exists() or real_dst.is_symlink()):
                os.rename(backup_path, real_dst)
            raise
        permission = oct(perm) if perm is not None else 'preserve-source'
        print(f'APPLY {logical_id} → {real_dst} (perm={permission})')
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
