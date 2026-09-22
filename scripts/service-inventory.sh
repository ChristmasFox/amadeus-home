#!/usr/bin/env bash
# scripts/service-inventory.sh
# Amadeus 1.4.7 — Service inventory: check, observe, and compare modes.
#
# Modes:
#   --check          (default) Verify tracked contract has required services.
#   --observe PATH   Write sanitized live observation to PATH (never to tracked docs).
#                    Running services missing from the tracked contract become MANUAL_BLOCKER.
#                    Contract entries missing from live runtime become WARNING (not deleted).
#   --compare PATH   Compare live observation (written to PATH) against tracked contract.
#                    Missing live services → MANUAL_BLOCKER. Extra contract entries → WARNING.
#
# NEVER overwrites:
#   docs/OPERATION_SKULD_SERVICE_INVENTORY.md
#   docs/OPERATION_SKULD_MIGRATION_MANIFEST.json
set -Eeuo pipefail

ROOT_DIR="${SKULD_ROOT_DIR:-$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT_DIR"
MACHINE="${ORBSTACK_MACHINE:-ubuntu}"
MODE='check'
OBSERVE_PATH=''
COMPARE_PATH=''
BLOCKER_COUNT=0
WARNING_COUNT=0

# Paths that must NEVER be overwritten by this script
PROTECTED_INVENTORY="$ROOT_DIR/docs/OPERATION_SKULD_SERVICE_INVENTORY.md"
PROTECTED_MANIFEST="$ROOT_DIR/docs/OPERATION_SKULD_MIGRATION_MANIFEST.json"

usage() {
  printf '%s\n' \
    'Usage: scripts/service-inventory.sh [--check]' \
    '       scripts/service-inventory.sh --observe PATH' \
    '       scripts/service-inventory.sh --compare PATH'
}

while (($#)); do
  case "$1" in
    --check)   MODE=check ;;
    --observe) shift; MODE=observe; OBSERVE_PATH="${1:?--observe requires a path}" ;;
    --compare) shift; MODE=compare; COMPARE_PATH="${1:?--compare requires a path}" ;;
    --machine) shift; MACHINE="${1:?--machine requires a name}" ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

# === Check mode ===
# Verifies that the tracked contract file mentions all required services.
check_mode() {
  local contract="$PROTECTED_INVENTORY"
  [[ -f "$contract" ]] || { printf 'service inventory document is missing\n' >&2; exit 1; }
  # Full list of expected MIGRATE services from contract
  local required_services=(
    openclaw product-radar 9router immich changedetection media-organizer-adapter
    frpc xiaoya emby qbittorrent nginxproxymanager filebrowser aria2 jellyfin alist v2raya
  )
  local missing=()
  for name in "${required_services[@]}"; do
    grep -Fiq "$name" "$contract" || missing+=("$name")
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    printf 'service inventory contract is missing: %s\n' "${missing[*]}" >&2
    exit 1
  fi
  printf 'SERVICE_INVENTORY=passed\n'
  printf 'SERVICE_INVENTORY_CONTRACT_GATE=passed\n'
}

# === Observe mode ===
# Gathers live runtime state and writes sanitized observation to OBSERVE_PATH (never to tracked docs).
# Compares against tracked contract to identify MANUAL_BLOCKERs and WARNINGs.
observe_mode() {
  # Safety: refuse to write to protected paths
  local real_observe; real_observe="$(python3 -c "import os,sys; print(os.path.realpath(sys.argv[1]))" "$OBSERVE_PATH")"
  local real_inv; real_inv="$(python3 -c "import os,sys; print(os.path.realpath(sys.argv[1]))" "$PROTECTED_INVENTORY")"
  local real_man; real_man="$(python3 -c "import os,sys; print(os.path.realpath(sys.argv[1]))" "$PROTECTED_MANIFEST")"
  if [[ "$real_observe" == "$real_inv" || "$real_observe" == "$real_man" ]]; then
    printf 'ERROR: --observe target is a protected tracked document. Use a temp or external path.\n' >&2
    exit 2
  fi

  command -v orb >/dev/null 2>&1 || { printf 'OrbStack CLI not found\n' >&2; exit 1; }

  # Gather live running containers
  local live_tmp
  live_tmp="$(mktemp "${TMPDIR:-/tmp}/skuld-live-inventory.XXXXXX")"
  trap 'rm -f "$live_tmp"' EXIT

  orb -m "$MACHINE" -u root bash -lc '
    set -Eeuo pipefail
    for name in $(docker ps --format "{{.Names}}"); do
      image=$(docker inspect --format "{{.Config.Image}}" "$name" 2>/dev/null || echo "unknown")
      compose=$(docker inspect --format "{{index .Config.Labels \"com.docker.compose.project.working_dir\"}}" "$name" 2>/dev/null || echo "")
      mounts=$(docker inspect --format "{{range .Mounts}}{{.Source}}->{{.Destination}};{{end}}" "$name" 2>/dev/null || echo "")
      printf "%s|%s|%s|%s\n" "$name" "$image" "$compose" "$mounts"
    done
  ' > "$live_tmp" 2>/dev/null || { printf 'WARNING: Could not gather live container list\n' >&2; printf '' > "$live_tmp"; }

  # MIGRATE services from tracked contract (canonical list)
  local contract_migrate=(
    openclaw product-radar 9router immich changedetection media-organizer-adapter
    frpc xiaoya emby qbittorrent nginxproxymanager filebrowser aria2 jellyfin alist v2raya
  )

  python3 - "$live_tmp" "$OBSERVE_PATH" "$PROTECTED_INVENTORY" << 'PY'
import json
import sys
from pathlib import Path
from datetime import datetime, timezone

live_file, observe_path, contract_path = map(Path, sys.argv[1:])
now = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')

# Parse live containers
live_services = {}
for line in live_file.read_text().splitlines():
    if not line.strip():
        continue
    parts = (line.split('|') + ['', '', '', ''])[:4]
    name, image, compose, mounts = parts
    live_services[name.lower()] = {
        'name': name,
        'image': image,
        'composeDir': compose or 'not-labeled',
        'mounts': mounts or 'none',
    }

# Parse contract MIGRATE services from tracked inventory
contract_text = contract_path.read_text() if contract_path.exists() else ''
# Extract service names from the table (column 1, skip header)
contract_migrate = set()
for line in contract_text.splitlines():
    if line.startswith('| ') and '| MIGRATE' in line:
        parts = [p.strip() for p in line.split('|')]
        if len(parts) > 1:
            svc = parts[1].strip().lower()
            if svc:
                contract_migrate.add(svc)

# Compare: live vs contract
live_names = set(live_services.keys())
missing_from_live = contract_migrate - live_names   # in contract but not running → WARNING
unknown_live = live_names - contract_migrate         # running but not in contract → MANUAL_BLOCKER

observations = []
manual_blockers = []
warnings = []

for name in sorted(live_names):
    svc = live_services[name]
    if name in contract_migrate:
        status = 'in-contract'
        classification = 'MIGRATE (per contract)'
    else:
        status = 'MANUAL_BLOCKER'
        classification = 'MANUAL_BLOCKER (running but not in migration contract)'
        manual_blockers.append(name)
    observations.append({**svc, 'contractStatus': status, 'classification': classification})

for name in sorted(missing_from_live):
    warnings.append(name)

result = {
    'schemaVersion': 1,
    'observedAtUtc': now,
    'note': 'Sanitized live observation — not a migration contract. '
            'MANUAL_BLOCKER = running service missing from tracked contract. '
            'WARNING = contract entry not found in live runtime.',
    'protectedDocuments': [
        'docs/OPERATION_SKULD_SERVICE_INVENTORY.md',
        'docs/OPERATION_SKULD_MIGRATION_MANIFEST.json',
    ],
    'liveServices': observations,
    'contractMigrateServices': sorted(contract_migrate),
    'manualBlockers': manual_blockers,
    'warnings': warnings,
    'SERVICE_INVENTORY_MANUAL_BLOCKERS': len(manual_blockers),
    'SERVICE_INVENTORY_WARNINGS': len(warnings),
}
Path(observe_path).parent.mkdir(parents=True, exist_ok=True)
Path(observe_path).write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n')
Path(observe_path).chmod(0o600)

print(f'SERVICE_INVENTORY_OBSERVE=passed')
print(f'SERVICE_INVENTORY_LIVE_COUNT={len(live_names)}')
print(f'SERVICE_INVENTORY_MANUAL_BLOCKERS={len(manual_blockers)}')
print(f'SERVICE_INVENTORY_WARNINGS={len(warnings)}')
if manual_blockers:
    print(f'SERVICE_INVENTORY_BLOCKERS={",".join(manual_blockers)}')
if warnings:
    print(f'SERVICE_INVENTORY_WARNING_ENTRIES={",".join(warnings)}')
PY
}

# === Compare mode ===
# Writes observation to COMPARE_PATH then compares against contract.
# MANUAL_BLOCKER if live services missing from contract; WARNING if contract entries not live.
compare_mode() {
  # Write fresh observation to compare path
  OBSERVE_PATH="$COMPARE_PATH"
  observe_mode

  # Check for blockers
  python3 - "$COMPARE_PATH" << 'PY'
import json, sys
from pathlib import Path
data = json.loads(Path(sys.argv[1]).read_text())
blockers = data.get('manualBlockers', [])
warnings_list = data.get('warnings', [])
if blockers:
    print(f'SERVICE_INVENTORY_CONTRACT_GATE=MANUAL_BLOCKER')
    print(f'MANUAL_BLOCKER_SERVICES={",".join(blockers)}')
    raise SystemExit(f'Service inventory gate BLOCKED: {len(blockers)} running service(s) missing from tracked contract.')
else:
    if warnings_list:
        print(f'SERVICE_INVENTORY_CONTRACT_GATE=WARNING (contract entries not live: {",".join(warnings_list)})')
    print(f'SERVICE_INVENTORY_CONTRACT_GATE=passed')
PY
}

case "$MODE" in
  check)   check_mode ;;
  observe) observe_mode ;;
  compare) compare_mode ;;
  *)       usage >&2; exit 2 ;;
esac
