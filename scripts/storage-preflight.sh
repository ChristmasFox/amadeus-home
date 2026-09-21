#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${SKULD_ROOT_DIR:-$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT_DIR"

STORAGE_PREFLIGHT_LIB_ONLY="${STORAGE_PREFLIGHT_LIB_ONLY:-0}"
STORAGE_TEST_MODE="${STORAGE_PREFLIGHT_TEST_MODE:-0}"
STORAGE_FAILURES=0
STORAGE_WARNINGS=0

storage_pass() { printf 'PASS  %s\n' "$1"; }
storage_warn() { printf 'WARN  %s\n' "$1"; STORAGE_WARNINGS=$((STORAGE_WARNINGS + 1)); }
storage_fail() { printf 'FAIL  %s\n' "$1"; STORAGE_FAILURES=$((STORAGE_FAILURES + 1)); }

storage_existing_parent() {
  local path="$1"
  while [[ ! -e "$path" && "$path" != / ]]; do path="$(dirname -- "$path")"; done
  printf '%s\n' "$path"
}

storage_host_volume_check() {
  local root="$1" expected_uuid="$2" info actual_uuid mounted device root_device
  [[ -d "$root" ]] || { storage_fail "external storage root is not mounted: $root"; return; }
  [[ -n "$expected_uuid" ]] || { storage_fail 'EXTERNAL_STORAGE_VOLUME_UUID is empty; refusing path-only identity'; return; }
  if ((STORAGE_TEST_MODE)); then
    actual_uuid="${STORAGE_TEST_ACTUAL_VOLUME_UUID:-}"
    [[ "$actual_uuid" == "$expected_uuid" ]] && storage_pass 'external volume UUID matches fixture' || storage_fail 'external volume UUID mismatch'
    return
  fi
  command -v diskutil >/dev/null 2>&1 || { storage_fail 'diskutil is unavailable; cannot verify external volume identity'; return; }
  info="$(diskutil info "$root" 2>/dev/null || true)"
  mounted="$(printf '%s\n' "$info" | awk -F: '/Mounted:/ {gsub(/^[[:space:]]+/, "", $2); print $2; exit}')"
  actual_uuid="$(printf '%s\n' "$info" | awk -F: '/Volume UUID:/ {gsub(/^[[:space:]]+/, "", $2); print $2; exit}')"
  [[ "$mounted" == Yes ]] || storage_fail "external volume is not reported as mounted: $root"
  [[ "$actual_uuid" == "$expected_uuid" ]] || storage_fail "external volume UUID mismatch: expected $expected_uuid"
  device="$(df -P "$root" | tail -n 1 | awk '{print $1}')"
  root_device="$(df -P / | tail -n 1 | awk '{print $1}')"
  [[ -n "$device" && "$device" != "$root_device" ]] || storage_fail 'external path resolves to the internal root filesystem'
  [[ "$actual_uuid" == "$expected_uuid" ]] && storage_pass 'external volume is mounted with the expected identity'
}

storage_read_sentinel() {
  local root="$1" expected_id="$2" sentinel
  sentinel="$root/.amadeus-storage.json"
  [[ -f "$sentinel" ]] || { storage_fail "storage sentinel is missing: $sentinel"; return; }
  python3 - "$sentinel" "$expected_id" <<'PY'
import json
import sys
from pathlib import Path

path, expected = sys.argv[1:]
value = json.loads(Path(path).read_text(encoding='utf-8'))
if value.get('schemaVersion') != 1 or value.get('storageId') != expected:
    raise SystemExit(1)
if value.get('purpose') != 'amadeus-homelab-storage':
    raise SystemExit(1)
PY
  storage_pass 'external storage sentinel matches the configured identity'
}

storage_init_sentinel() {
  local root="$1" storage_id="$2" sentinel temporary
  sentinel="$root/.amadeus-storage.json"
  [[ -d "$root" ]] || { storage_fail "cannot initialize sentinel on missing root: $root"; return; }
  if [[ -e "$sentinel" ]]; then
    storage_read_sentinel "$root" "$storage_id"
    return
  fi
  temporary="$(mktemp "$root/.amadeus-storage.XXXXXX")"
  chmod 644 "$temporary"
  python3 - "$temporary" "$storage_id" <<'PY'
import json
import sys
from pathlib import Path

target, storage_id = sys.argv[1:]
Path(target).write_text(json.dumps({
    'schemaVersion': 1,
    'storageId': storage_id,
    'purpose': 'amadeus-homelab-storage',
}, indent=2) + '\n', encoding='utf-8')
PY
  mv -n "$temporary" "$sentinel" 2>/dev/null || { rm -f "$temporary"; storage_fail 'sentinel creation raced with another writer'; return; }
  storage_pass 'external storage sentinel initialized'
}

storage_stats() {
  local source="$1" destination="$2" machine="${ORBSTACK_MACHINE:-ubuntu}" output
  if ((STORAGE_TEST_MODE)); then
    python3 - "$source" "$destination" <<'PY'
import os
import sys
from pathlib import Path

source, destination = map(Path, sys.argv[1:])
def stats(path: Path):
    files = 0
    bytes_total = 0
    zero = set()
    if path.exists():
        for item in path.rglob('*'):
            if item.is_file() and not item.is_symlink():
                files += 1
                size = item.stat().st_size
                bytes_total += size
                if size == 0:
                    zero.add(str(item.relative_to(path)))
    return files, bytes_total, zero
sf, sb, sz = stats(source)
df, db, dz = stats(destination)
parent = destination
while not parent.exists() and parent != parent.parent:
    parent = parent.parent
free_override = os.environ.get('STORAGE_TEST_DESTINATION_FREE_BYTES')
free = int(free_override) if free_override else os.statvfs(parent).f_bavail * os.statvfs(parent).f_frsize
source_device = os.environ.get('STORAGE_TEST_SOURCE_DEVICE', str(source.stat().st_dev)) if source.exists() else os.environ.get('STORAGE_TEST_SOURCE_DEVICE', 'missing')
destination_device = os.environ.get('STORAGE_TEST_DESTINATION_DEVICE', str(parent.stat().st_dev))
print(f'SOURCE_FILES={sf}')
print(f'SOURCE_BYTES={sb}')
print(f'DESTINATION_FILES={df}')
print(f'DESTINATION_BYTES={db}')
print(f'DESTINATION_FREE_BYTES={free}')
print(f'SOURCE_DEVICE={source_device}')
print(f'DESTINATION_DEVICE={destination_device}')
print('SOURCE_ZERO=' + '\x1f'.join(sorted(sz)))
print('DESTINATION_ZERO=' + '\x1f'.join(sorted(dz)))
PY
    return
  fi
  command -v orb >/dev/null 2>&1 || { storage_fail 'OrbStack CLI is unavailable for guest filesystem verification'; return 1; }
  output="$(orb -m "$machine" -u root python3 - "$source" "$destination" <<'PY'
import os
import sys
from pathlib import Path

source, destination = map(Path, sys.argv[1:])
if not source.is_dir():
    raise SystemExit('source media root is not a directory')
def stats(path: Path):
    files = 0
    bytes_total = 0
    zero = set()
    if path.exists():
        for item in path.rglob('*'):
            if item.is_file() and not item.is_symlink():
                files += 1
                size = item.stat().st_size
                bytes_total += size
                if size == 0:
                    zero.add(str(item.relative_to(path)))
    return files, bytes_total, zero
sf, sb, sz = stats(source)
df, db, dz = stats(destination)
parent = destination
while not parent.exists() and parent != parent.parent:
    parent = parent.parent
free = os.statvfs(parent)
print(f'SOURCE_FILES={sf}')
print(f'SOURCE_BYTES={sb}')
print(f'DESTINATION_FILES={df}')
print(f'DESTINATION_BYTES={db}')
print(f'DESTINATION_FREE_BYTES={free.f_bavail * free.f_frsize}')
print(f'SOURCE_DEVICE={source.stat().st_dev}')
print(f'DESTINATION_DEVICE={parent.stat().st_dev}')
print('SOURCE_ZERO=' + '\x1f'.join(sorted(sz)))
print('DESTINATION_ZERO=' + '\x1f'.join(sorted(dz)))
PY
)" || { storage_fail 'guest filesystem statistics failed'; return 1; }
  printf '%s\n' "$output"
}

storage_preflight() {
  local source="${1:-${IMMICH_SOURCE_ROOT:-/DATA/Gallery/immich}}"
  local destination="${2:-$IMMICH_MEDIA_ROOT}"
  local allow_existing="${3:-0}"
  local parent stats source_bytes destination_free source_device destination_device
  storage_host_volume_check "$EXTERNAL_STORAGE_ROOT" "$EXTERNAL_STORAGE_VOLUME_UUID"
  if ((STORAGE_FAILURES == 0)); then
    storage_read_sentinel "$EXTERNAL_STORAGE_ROOT" "$EXTERNAL_STORAGE_SENTINEL_ID"
  fi
  [[ -e "$destination" && -L "$destination" ]] && storage_fail 'Immich destination is a symlink; refusing an ambiguous mount target'
  parent="$(storage_existing_parent "$destination")"
  [[ -d "$parent" && -r "$parent" && -w "$parent" ]] || storage_fail "Immich destination parent is not readable/writable: $parent"
  if [[ -e "$destination" && ! -d "$destination" ]]; then
    storage_fail 'Immich destination exists but is not a directory'
  fi
  [[ -d "$source" ]] || storage_fail "Immich source is not a readable directory: $source"
  if [[ -d "$destination" ]] && [[ -n "$(find "$destination" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]] && ((allow_existing == 0)) && [[ "${STORAGE_ALLOW_RESUMABLE_DEST:-0}" != 1 ]]; then
    storage_fail 'Immich destination is non-empty and is not an approved resumable checkpoint'
  fi
  stats="$(storage_stats "$source" "$destination" 2>/dev/null || true)"
  [[ -n "$stats" ]] || { storage_fail 'could not inspect the Immich source/destination filesystem'; return; }
  printf '%s\n' "$stats"
  source_bytes="$(printf '%s\n' "$stats" | awk -F= '$1 == "SOURCE_BYTES" {print $2}')"
  destination_free="$(printf '%s\n' "$stats" | awk -F= '$1 == "DESTINATION_FREE_BYTES" {print $2}')"
  source_device="$(printf '%s\n' "$stats" | awk -F= '$1 == "SOURCE_DEVICE" {print $2}')"
  destination_device="$(printf '%s\n' "$stats" | awk -F= '$1 == "DESTINATION_DEVICE" {print $2}')"
  [[ "$source_device" != "$destination_device" ]] || storage_fail 'Immich source and destination resolve to the same filesystem'
  if [[ "$destination_free" =~ ^[0-9]+$ && "$source_bytes" =~ ^[0-9]+$ ]]; then
    (( destination_free >= source_bytes + STORAGE_SAFETY_MARGIN_BYTES )) && storage_pass 'external free space covers source bytes plus safety margin' || storage_fail 'external free space is insufficient for a copy-first migration'
  else
    storage_fail 'filesystem free-space statistics are unknown'
  fi
  if [[ "${STORAGE_PREFLIGHT_NO_WRITE_TEST:-0}" != 1 ]]; then
    local probe
    probe="$(mktemp "$parent/.amadeus-storage-write-test.XXXXXX")" || { storage_fail 'external destination is not writable'; return; }
    rm -f "$probe"
    storage_pass 'external destination write probe succeeded'
  fi
  ((STORAGE_FAILURES == 0)) && storage_pass 'storage preflight passed'
}

run_storage_preflight() {
  local mode='check' init=0 source='' destination=''
  while (($#)); do
    case "$1" in
      --init-sentinel) init=1 ;;
      --allow-existing) export STORAGE_ALLOW_RESUMABLE_DEST=1 ;;
      --source) shift; source="${1:?--source requires a path}" ;;
      --destination) shift; destination="${1:?--destination requires a path}" ;;
      --status|--plan|--check) mode="${1#--}" ;;
      --help|-h)
        printf '%s\n' 'Usage: scripts/storage-preflight.sh [--plan|--status|--check] [--init-sentinel] [--allow-existing] [--source PATH] [--destination PATH]'
        return 0
        ;;
      *) printf 'Unknown option: %s\n' "$1" >&2; return 2 ;;
    esac
    shift
  done
  : "$mode"
  if ((init)); then storage_init_sentinel "$EXTERNAL_STORAGE_ROOT" "$EXTERNAL_STORAGE_SENTINEL_ID"; fi
  storage_preflight "$source" "$destination" "${STORAGE_ALLOW_RESUMABLE_DEST:-0}"
  printf 'STORAGE_PREFLIGHT=%s\n' "$((STORAGE_FAILURES == 0 ? 0 : 1))"
  printf 'STORAGE_WARNINGS=%s\n' "$STORAGE_WARNINGS"
  return "$((STORAGE_FAILURES == 0 ? 0 : 1))"
}

if [[ "$STORAGE_PREFLIGHT_LIB_ONLY" != 1 ]]; then
  run_storage_preflight "$@"
fi
