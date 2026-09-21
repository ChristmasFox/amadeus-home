#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${SKULD_ROOT_DIR:-$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT_DIR"
MACHINE="${ORBSTACK_MACHINE:-ubuntu}"
OUTPUT="${ROOT_DIR}/docs/OPERATION_SKULD_SERVICE_INVENTORY.md"
MODE='check'

while (($#)); do
  case "$1" in
    --write) MODE=write; shift; OUTPUT="${1:?--write requires a path}" ;;
    --check) MODE=check ;;
    --help|-h) printf '%s\n' 'Usage: scripts/service-inventory.sh [--check|--write PATH]'; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

required='OpenClaw Product-Radar 9Router Immich changedetection media-organizer-adapter'
if [[ "$MODE" == check ]]; then
  [[ -f "$OUTPUT" ]] || { printf '%s\n' 'service inventory document is missing' >&2; exit 1; }
  for name in $required; do grep -Fiq "$name" "$OUTPUT" || { printf 'service inventory lacks %s\n' "$name" >&2; exit 1; }; done
  printf '%s\n' 'SERVICE_INVENTORY=passed'
  exit 0
fi

command -v orb >/dev/null 2>&1 || { printf '%s\n' 'OrbStack CLI not found' >&2; exit 1; }
inventory_tmp="$(mktemp "${TMPDIR:-/tmp}/skuld-service-inventory.XXXXXX")"
trap 'rm -f "$inventory_tmp"' EXIT
orb -m "$MACHINE" -u root bash -lc '
  set -Eeuo pipefail
  printf "%s\n" "SERVICE|IMAGE|COMPOSE_DIR|MOUNTS"
  for name in $(docker ps --format "{{.Names}}"); do
    docker inspect --format "{{.Name}}|{{.Config.Image}}|{{index .Config.Labels \"com.docker.compose.project.working_dir\"}}|{{range .Mounts}}{{.Source}} -> {{.Destination}};{{end}}" "$name" | sed "s#^/##"
  done
' >"$inventory_tmp"

python3 - "$inventory_tmp" "$OUTPUT" <<'PY'
import sys
from pathlib import Path

source, target = map(Path, sys.argv[1:])
rows = [line.rstrip('\n').split('|', 3) for line in source.read_text().splitlines()[1:] if line.strip()]
out = [
    '# Operation Skuld service inventory',
    '',
    'Generated from the current running CasaOS containers. This document is sanitized: it records paths, image references, and restore classification, never environment values or credential contents.',
    '',
    '| Service | Image | Compose directory | Persistent mounts observed | Classification |',
    '| --- | --- | --- | --- | --- |',
]
for name, image, compose_dir, mounts in rows:
    lower = name.lower()
    if lower == 'openclaw':
        classification = 'ACTIVE / protected runtime'
    elif lower == 'product-radar':
        classification = 'ACTIVE / protected SQLite + outbox'
    elif lower == '9router':
        classification = 'ACTIVE / exact image + protected data'
    elif lower.startswith('immich-'):
        classification = 'ACTIVE / protected database or media boundary'
    elif lower == 'changedetection':
        classification = 'COMPATIBILITY / protected datastore'
    elif lower == 'media-organizer-adapter':
        classification = 'ACTIVE / registered state'
    else:
        classification = 'ACTIVE external service / manual restore path'
    out.append(f'| {name} | `{image}` | `{compose_dir or "not labeled"}` | `{mounts or "none reported"}` | {classification} |')
out.extend([
    '',
    '## Protected credential/state coverage',
    '',
    '- OpenClaw: external env, channel tokens, owner target, PUBG/VPS/NAS/KOOK credentials and SQLite/outbox.',
    '- Product Radar: runtime env, SQLite and shared owner outbox.',
    '- 9Router: runtime credential names are external; `/DATA/AppData/9router/data` is encrypted protected state; exact image export is retained.',
    '- Immich: database credential source and PostgreSQL AppData are protected; media is a verified external volume; Redis/model cache are classified separately.',
    '- changedetection and media adapter state remain in the migration boundary while active.',
    '- Other running CasaOS services are discovered above and require their own manual or service-specific restore path; generic GC never deletes them.',
    '',
    'Secret values are intentionally absent from this inventory.',
    '',
])
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text('\n'.join(out), encoding='utf-8')
PY
printf 'SERVICE_INVENTORY_WRITTEN=%s\n' "$OUTPUT"
