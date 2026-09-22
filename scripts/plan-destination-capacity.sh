#!/usr/bin/env bash
# scripts/plan-destination-capacity.sh
# Amadeus 1.4.6 — Destination capacity planning for 512 GB Mac mini SSD.
# Estimates destination storage requirements based on current source usage.
# Outputs fit/warning/blocker judgment.
# This is PLAN-ONLY: no SSH to destination.
#
# Usage:
#   scripts/plan-destination-capacity.sh [--fixture] [--output-dir DIR]
set -Eeuo pipefail

ROOT_DIR="${SKULD_ROOT_DIR:-$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT_DIR"

MACHINE="${ORBSTACK_MACHINE:-ubuntu}"
FIXTURE_MODE="${DESTINATION_CAPACITY_TEST_MODE:-0}"
OUTPUT_DIR=''
# Destination 512 GB SSD in bytes (usable ~480 GB after partition overhead)
DEST_SSD_BYTES="${DEST_SSD_BYTES:-515396075520}"
# macOS + OrbStack overhead estimate: ~40 GB
MACOS_OVERHEAD_BYTES="${MACOS_OVERHEAD_BYTES:-42949672960}"
# OrbStack dynamic disk image: allow up to 120 GB for guest filesystem
ORBSTACK_GUEST_BYTES="${ORBSTACK_GUEST_BYTES:-128849018880}"
# Avalon (8TB): NOT on destination SSD (physical external disk)
# Warn if: remaining < 30 GB; blocker if: remaining < 10 GB

usage() {
  printf '%s\n' 'Usage: scripts/plan-destination-capacity.sh [--fixture] [--output-dir DIR]'
}

while (($#)); do
  case "$1" in
    --fixture) FIXTURE_MODE=1 ;;
    --output-dir) shift; OUTPUT_DIR="${1:?--output-dir requires a path}" ;;
    --machine) shift; MACHINE="${1:?--machine requires a name}" ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

# Gather source usage measurements
if ((FIXTURE_MODE)); then
  # Fixture values for testing (in bytes)
  source_docker_bytes="${FIXTURE_DOCKER_BYTES:-32212254720}"   # 30 GB
  source_appdata_bytes="${FIXTURE_APPDATA_BYTES:-5368709120}"  # 5 GB
  source_pnpm_bytes="${FIXTURE_PNPM_BYTES:-2147483648}"        # 2 GB
  source_macos_apps_bytes="${FIXTURE_MACOS_APPS_BYTES:-1073741824}" # 1 GB
  avalon_note="Avalon (8TB external): NOT on destination SSD — physical move only"
else
  command -v orb >/dev/null 2>&1 || { printf 'OrbStack CLI not found\n' >&2; exit 1; }

  printf 'Measuring source storage usage...\n' >&2

  # Docker (guest filesystem)
  source_docker_bytes="$(orb -m "$MACHINE" -u root bash -lc \
    'du -sx --block-size=1 /var/lib/docker 2>/dev/null | awk "{print \$1}"; true' 2>/dev/null || printf '0')"

  # AppData (guest)
  source_appdata_bytes="$(orb -m "$MACHINE" -u root bash -lc \
    'du -sx --block-size=1 /DATA/AppData 2>/dev/null | awk "{print \$1}"; true' 2>/dev/null || printf '0')"

  # macOS monorepo + pnpm
  source_pnpm_bytes="$(du -sx --block-size=1 "${HOME}/.local/share/pnpm" 2>/dev/null | awk '{print $1}' || printf '0')"
  source_macos_apps_bytes="$(du -sx --block-size=1 \
    "${HOME}/agent-monorepo" \
    "${HOME}/Library/Caches/pnpm" \
    "/usr/local/lib/node_modules" 2>/dev/null | awk '{sum += $1} END {print sum}' || printf '0')"

  avalon_note="Avalon (8TB external): NOT on destination SSD — physical move only. No SSD capacity consumed."
fi

python3 - \
  "$DEST_SSD_BYTES" "$MACOS_OVERHEAD_BYTES" "$ORBSTACK_GUEST_BYTES" \
  "$source_docker_bytes" "$source_appdata_bytes" "$source_pnpm_bytes" "$source_macos_apps_bytes" \
  "$avalon_note" << 'PY'
import json
import sys

dest_ssd, macos_overhead, guest_budget = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
src_docker, src_appdata, src_pnpm, src_macos_apps = int(sys.argv[4]), int(sys.argv[5]), int(sys.argv[6]), int(sys.argv[7])
avalon_note = sys.argv[8]

def gb(b): return round(b / 1024**3, 2)

# Estimate destination requirements
req_macos = macos_overhead                       # macOS + system
req_orbstack = guest_budget                      # OrbStack dynamic disk (Docker+AppData are inside)
req_docker = src_docker                          # Docker images/layers (same or smaller on clean install)
req_appdata = src_appdata                        # AppData (same)
req_pnpm = src_pnpm                              # pnpm store
req_macos_apps = src_macos_apps                  # monorepo + node
req_buffer = 32 * 1024**3                        # 30 GB free buffer

total_required = req_macos + req_orbstack + req_pnpm + req_macos_apps + req_buffer
remaining = dest_ssd - total_required

WARN_THRESHOLD = 30 * 1024**3   # 30 GB
BLOCKER_THRESHOLD = 10 * 1024**3  # 10 GB

if remaining < BLOCKER_THRESHOLD:
    judgment = 'BLOCKER'
elif remaining < WARN_THRESHOLD:
    judgment = 'WARNING'
else:
    judgment = 'FIT'

print(f'# Destination Capacity Plan — Amadeus 1.4.6')
print(f'')
print(f'Destination SSD:           {gb(dest_ssd):.1f} GB (512 GB nominal)')
print(f'')
print(f'## Estimated requirements')
print(f'  macOS + system:          {gb(req_macos):.1f} GB')
print(f'  OrbStack dynamic disk:   {gb(req_orbstack):.1f} GB (Docker images + AppData inside)')
print(f'    └─ Docker images:      {gb(req_docker):.1f} GB (from source measurement)')
print(f'    └─ AppData:            {gb(req_appdata):.1f} GB (from source measurement)')
print(f'  pnpm store:              {gb(req_pnpm):.1f} GB')
print(f'  monorepo + node:         {gb(req_macos_apps):.1f} GB')
print(f'  free buffer (target):    {gb(req_buffer):.1f} GB')
print(f'  ─────────────────────────────────────────')
print(f'  TOTAL REQUIRED:          {gb(total_required):.1f} GB')
print(f'  REMAINING:               {gb(remaining):.1f} GB')
print(f'')
print(f'## Avalon (8TB external disk)')
print(f'  {avalon_note}')
print(f'  Immich media ({gb(src_docker):.1f} GB measured as docker): Avalon is physically moved.')
print(f'  Avalon does NOT count against destination SSD.')
print(f'')
print(f'## Judgment')
print(f'DESTINATION_CAPACITY_JUDGMENT={judgment}')
if judgment == 'BLOCKER':
    print(f'  ❌ BLOCKER: Remaining space ({gb(remaining):.1f} GB) is below hard minimum ({gb(BLOCKER_THRESHOLD):.1f} GB).')
    print(f'  Operation Skuld cutover cannot proceed until capacity is resolved.')
elif judgment == 'WARNING':
    print(f'  ⚠️  WARNING: Remaining space ({gb(remaining):.1f} GB) is below warning threshold ({gb(WARN_THRESHOLD):.1f} GB).')
    print(f'  Cutover can proceed with operator acknowledgement of reduced headroom.')
else:
    print(f'  ✅ FIT: Remaining space ({gb(remaining):.1f} GB) exceeds warning threshold ({gb(WARN_THRESHOLD):.1f} GB).')
    print(f'  Destination SSD has sufficient headroom for Operation Skuld.')
print(f'')
print(f'DESTINATION_CAPACITY_PLAN=ready')
PY