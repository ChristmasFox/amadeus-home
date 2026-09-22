#!/usr/bin/env bash
# scripts/test-immich-checksum-equivalence.sh
# Amadeus 1.4.6 — Tests for the Immich remote checksum equivalence fix.
# Verifies that remote_equivalence correctly fails when files differ at destination.
# Uses local fixture directories with ORBSTACK_MACHINE=fixture (no real SSH).
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/amadeus-immich-checksum.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT

export AMADEUS_HOST_PROFILE="$fixture/no-host-profile"

pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1" >&2; exit 1; }

# Provide a fake pg_restore for fixture tests (the fixture dump is not a real pg_restore archive)
fake_bin="$fixture/bin"
mkdir -p "$fake_bin"
cat > "$fake_bin/pg_restore" << 'SH'
#!/usr/bin/env bash
set -euo pipefail
# Fake pg_restore: accept --list for any file and print a fixture TOC
if [[ "${1:-}" == '--list' ]]; then
  printf '; Archive created at fixture\n; TOC Entries: 1\n1; TABLE public marker\n'
  exit 0
fi
exit 0
SH
chmod 755 "$fake_bin/pg_restore"
export PATH="$fake_bin:$PATH"

# Create source and destination directory structure
source_dir="$fixture/source"
dest_dir="$fixture/destination"
mkdir -p "$source_dir/library" "$source_dir/upload"
mkdir -p "$dest_dir/library" "$dest_dir/upload"

# Write consistent files (same content at source and destination)
printf 'photo-content-v1\n' > "$source_dir/library/photo.jpg"
printf 'video-content-v1\n' > "$source_dir/upload/video.mp4"
cp "$source_dir/library/photo.jpg" "$dest_dir/library/photo.jpg"
cp "$source_dir/upload/video.mp4" "$dest_dir/upload/video.mp4"

# Write DB backup for fixture
db_dump="$fixture/immich.dump"
printf 'fixture-db-dump\n' > "$db_dump"

# Create a fixture state file for migration reclaim tests
state_dir="$fixture/migration-state"
mkdir -p "$state_dir"
python3 - "$state_dir/state.json" "$source_dir" "$dest_dir" "$db_dump" << 'PY'
import json, sys
from pathlib import Path
state_path, source, dest, db = sys.argv[1:]
Path(state_path).write_text(json.dumps({
    'source': source,
    'destination': dest,
    'sourceReclaimPending': True,
    'sourceRetained': True,
    'dbBackupPath': db,
    'phase': 'cutover-complete',
}, indent=2) + '\n')
Path(state_path).chmod(0o600)
PY

# ------------------------------------------------------------------
# Test 1: Equivalence passes when files are identical (fixture mode)
# ------------------------------------------------------------------
out="$(ORBSTACK_MACHINE=fixture SKULD_BACKUP_ROOT="$fixture/backup" \
  IMMICH_MIGRATION_STATE_DIR="$state_dir" \
  bash "$ROOT_DIR/scripts/reclaim-immich-old-source.sh" --plan \
    --state "$state_dir/state.json" 2>/dev/null)"
printf '%s\n' "$out" | grep -Fq 'FRESH_ONE_WAY_EQUIVALENCE=passed' || \
  fail 'equivalence: identical files should pass'
printf '%s\n' "$out" | grep -Fq 'SOURCE_RECLAIM_PENDING=yes' || \
  fail 'equivalence: pending not reported'
pass 'checksum equivalence: identical files pass'

# ------------------------------------------------------------------
# Test 2: Equivalence fails when a file differs at destination (fixture mode)
# ------------------------------------------------------------------
# Corrupt the destination copy
printf 'CORRUPTED-CONTENT\n' > "$dest_dir/library/photo.jpg"

if ORBSTACK_MACHINE=fixture SKULD_BACKUP_ROOT="$fixture/backup" \
  IMMICH_MIGRATION_STATE_DIR="$state_dir" \
  bash "$ROOT_DIR/scripts/reclaim-immich-old-source.sh" --plan \
    --state "$state_dir/state.json" >/dev/null 2>/dev/null; then
  fail 'checksum equivalence: CORRUPTED file should cause equivalence failure'
fi
pass 'checksum equivalence: corrupted destination file causes failure'

# Restore the destination
cp "$source_dir/library/photo.jpg" "$dest_dir/library/photo.jpg"

# ------------------------------------------------------------------
# Test 3: Equivalence fails when a file is MISSING at destination (fixture mode)
# ------------------------------------------------------------------
rm "$dest_dir/upload/video.mp4"

if ORBSTACK_MACHINE=fixture SKULD_BACKUP_ROOT="$fixture/backup" \
  IMMICH_MIGRATION_STATE_DIR="$state_dir" \
  bash "$ROOT_DIR/scripts/reclaim-immich-old-source.sh" --plan \
    --state "$state_dir/state.json" >/dev/null 2>/dev/null; then
  fail 'checksum equivalence: MISSING file should cause equivalence failure'
fi
pass 'checksum equivalence: missing destination file causes failure'

# Restore the destination
cp "$source_dir/upload/video.mp4" "$dest_dir/upload/video.mp4"

# ------------------------------------------------------------------
# Test 4: Verify the fix is present in the source code
# ------------------------------------------------------------------
# The old code only counted lines; the new code checks for transfer lines
if grep -q "filesReported" "$ROOT_DIR/scripts/reclaim-immich-old-source.sh"; then
  fail 'checksum-fix: old filesReported key still present (fix not applied)'
fi
if ! grep -q 'filesChecked' "$ROOT_DIR/scripts/reclaim-immich-old-source.sh"; then
  fail 'checksum-fix: new filesChecked key not found'
fi
if ! grep -q 'transfer_lines' "$ROOT_DIR/scripts/reclaim-immich-old-source.sh"; then
  fail 'checksum-fix: transfer_lines detection not found'
fi
if ! grep -q 'equivalenceResult.*passed' "$ROOT_DIR/scripts/reclaim-immich-old-source.sh"; then
  fail 'checksum-fix: equivalenceResult=passed not in fixed code'
fi
pass 'checksum-fix: source code contains the zero-changes verification fix'

# ------------------------------------------------------------------
# Test 5: Verify the storage growth telemetry fix is present
# ------------------------------------------------------------------
# Old code used '${MACHINE}' (single-quoted = unexpanded)
if grep -q "'\${MACHINE}'" "$ROOT_DIR/scripts/storage-health.sh"; then
  fail 'telemetry-fix: old single-quoted ${MACHINE} still present'
fi
# New code passes machine as sys.argv
if ! grep -q 'machine, immich_root, ext_root = sys.argv' "$ROOT_DIR/scripts/storage-health.sh"; then
  fail 'telemetry-fix: new sys.argv machine argument not found'
fi
pass 'telemetry-fix: storage growth telemetry uses correct variable expansion'

printf '\nAll Immich checksum equivalence tests passed.\n'
