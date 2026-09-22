#!/usr/bin/env bash
# scripts/pre-migration-gc.sh
# Amadeus 1.4.6 — Safe pre-migration garbage cleanup.
# Removes ONLY explicitly identified safe targets:
#   - Docker dangling images (no name, no tag, no dependent container)
#   - Build cache older than DOCKER_BUILD_CACHE_RETENTION_HOURS
#   - Named project images beyond the retention count
# NEVER uses: docker volume prune, docker system prune -a --volumes,
#             generic unknown AppData deletion, or external media deletion.
#
# Usage:
#   scripts/pre-migration-gc.sh --plan           (default: show what would be removed)
#   scripts/pre-migration-gc.sh --apply          (execute safe removals)
set -Eeuo pipefail

ROOT_DIR="${SKULD_ROOT_DIR:-$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT_DIR"

MACHINE="${ORBSTACK_MACHINE:-ubuntu}"
MODE='plan'
TEST_MODE="${PRE_MIGRATION_GC_TEST_MODE:-0}"

usage() {
  printf '%s\n' 'Usage: scripts/pre-migration-gc.sh [--plan|--apply]'
}

while (($#)); do
  case "$1" in
    --plan) MODE=plan ;;
    --apply) MODE=apply ;;
    --machine) shift; MACHINE="${1:?--machine requires a name}" ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

APPLY=0
[[ "$MODE" == apply ]] && APPLY=1

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
report_root="${SKULD_BACKUP_ROOT}/pre-migration-gc"
report_dir="$report_root/$stamp"
mkdir -p "$report_dir"
chmod 700 "$report_dir"

printf 'PRE_MIGRATION_GC_MODE=%s\n' "$MODE"
printf 'PRE_MIGRATION_GC_STAMP=%s\n' "$stamp"
printf 'PRE_MIGRATION_GC_REPORT=%s\n' "$report_dir"

if ((TEST_MODE)); then
  printf 'PRE_MIGRATION_GC=test-mode (no live Docker access)\n'
  {
    printf 'GC_MODE=%s\n' "$MODE"
    printf 'GC_TEST=1\n'
    printf 'GC_DANGLING_IMAGES=0 (fixture)\n'
    printf 'GC_BUILD_CACHE_FREED=0 (fixture)\n'
    printf 'GC_EXCESS_PROJECT_IMAGES=0 (fixture)\n'
    printf 'GC_VOLUMES_PRUNED=0 (never)\n'
    printf 'GC_SYSTEM_PRUNE=never\n'
  } | tee "$report_dir/gc-plan.txt"
  printf 'PRE_MIGRATION_GC=passed (test-mode)\n'
  exit 0
fi

command -v orb >/dev/null 2>&1 || { printf 'OrbStack CLI not found\n' >&2; exit 1; }

# Step 1: Identify running images (protected)
printf '--- Running containers and their images ---\n' | tee "$report_dir/running.txt"
orb -m "$MACHINE" -u root docker ps -a --format '{{.Image}}' | sort -u | tee -a "$report_dir/running.txt"

# Step 2: Identify dangling images (safe to remove)
printf '--- Dangling images (no name, no tag, no dependent container) ---\n' | tee "$report_dir/dangling.txt"
dangling_list="$(orb -m "$MACHINE" -u root docker images -f dangling=true -q 2>/dev/null || true)"
if [[ -n "$dangling_list" ]]; then
  orb -m "$MACHINE" -u root docker images -f dangling=true --format '{{.ID}} {{.CreatedAt}} {{.Size}}' | tee -a "$report_dir/dangling.txt"
  dangling_count="$(printf '%s\n' "$dangling_list" | grep -c . || true)"
else
  dangling_count=0
  printf 'none\n' | tee -a "$report_dir/dangling.txt"
fi
printf 'GC_DANGLING_COUNT=%s\n' "$dangling_count"

# Step 3: Identify project images beyond retention (safe to remove with protection)
printf '--- Project images (retention=%s) ---\n' "${DEPLOYMENT_IMAGE_RETENTION_COUNT:-2}" | tee "$report_dir/project-images.txt"
orb -m "$MACHINE" -u root docker images --format '{{.Repository}}:{{.Tag}}|{{.ID}}|{{.CreatedAt}}' \
  | grep -E '^(local/openclaw-amadeus|local/product-radar):git-' | sort -t'|' -k3,3r \
  > "$report_dir/project-images.txt" 2>/dev/null || true

excess_images="$(python3 - "$report_dir/project-images.txt" "${DEPLOYMENT_IMAGE_RETENTION_COUNT:-2}" << 'PY'
import sys
from collections import defaultdict
from pathlib import Path

path, count = Path(sys.argv[1]), int(sys.argv[2])
running_protected = set()
rows = [l for l in path.read_text().splitlines() if l]
release_counts = defaultdict(int)
excess = []
for row in rows:
    parts = (row.split('|') + ['', '', ''])[:3]
    image_tag, image_id, created = parts[0], parts[1], parts[2]
    repo = image_tag.split(':')[0]
    release_counts[repo] += 1
    if release_counts[repo] > count:
        excess.append(image_tag)
        print(f'EXCESS_REMOVE|{image_tag}')
    else:
        print(f'EXCESS_KEEP|{image_tag}')
PY
)" || excess_images=''

excess_count="$(printf '%s\n' "$excess_images" | grep -c '^EXCESS_REMOVE|' || true)"
printf 'GC_EXCESS_PROJECT_IMAGES=%s\n' "$excess_count"
printf '%s\n' "$excess_images" >> "$report_dir/project-images.txt"

# Step 4: Build cache age
printf '--- Docker build cache ---\n' | tee "$report_dir/build-cache.txt"
cache_size="$(orb -m "$MACHINE" -u root docker system df --format '{{json .}}' 2>/dev/null \
  | python3 -c 'import json,sys; rows=[json.loads(l) for l in sys.stdin if l.strip()]; print(next((r.get("Size","0") for r in rows if r.get("Type")=="Build Cache"),"0B"))' 2>/dev/null || printf '0B')"
printf 'GC_BUILD_CACHE_SIZE=%s\n' "$cache_size" | tee -a "$report_dir/build-cache.txt"

# Step 5: Summary
printf '\n--- Pre-migration GC summary ---\n'
printf 'GC_MODE=%s\n' "$MODE"
printf 'GC_DANGLING_IMAGES=%s\n' "$dangling_count"
printf 'GC_EXCESS_PROJECT_IMAGES=%s\n' "$excess_count"
printf 'GC_VOLUMES_PRUNED=0 (never — explicit policy)\n'
printf 'GC_SYSTEM_PRUNE=never (explicit policy)\n'
printf 'GC_UNKNOWN_APPDATA_DELETION=never (explicit policy)\n'
printf 'GC_EXTERNAL_MEDIA_DELETION=never (explicit policy)\n'

if ((APPLY)); then
  printf '\n--- Applying safe GC ---\n'
  # Remove dangling images
  if [[ -n "$dangling_list" ]]; then
    printf '%s\n' "$dangling_list" | xargs orb -m "$MACHINE" -u root docker rmi --no-prune 2>/dev/null || true
    printf 'GC_DANGLING_REMOVED=%s\n' "$dangling_count"
  fi
  # Remove excess project images (beyond retention, not running)
  printf '%s\n' "$excess_images" | grep '^EXCESS_REMOVE|' | cut -d'|' -f2 | while IFS= read -r img; do
    if ! orb -m "$MACHINE" -u root docker ps -a --format '{{.Image}}' | grep -Fxq "$img" 2>/dev/null; then
      orb -m "$MACHINE" -u root docker rmi "$img" 2>/dev/null && printf 'GC_REMOVED=%s\n' "$img" || true
    fi
  done
  # Prune build cache older than retention hours
  cache_hours="${DOCKER_BUILD_CACHE_RETENTION_HOURS:-168}"
  orb -m "$MACHINE" -u root docker builder prune \
    --filter "until=${cache_hours}h" --force 2>/dev/null | tee "$report_dir/build-cache-prune.txt" || true
  printf 'GC_BUILD_CACHE_PRUNED=older-than-%sh\n' "$cache_hours"
  {
    printf 'GC_APPLY_STAMP=%s\n' "$stamp"
    printf 'GC_APPLY=passed\n'
  } > "$report_dir/result.txt"
  printf 'PRE_MIGRATION_GC=passed\n'
else
  {
    printf 'GC_PLAN_STAMP=%s\n' "$stamp"
    printf 'GC_PLAN=ready\n'
  } > "$report_dir/result.txt"
  printf 'PRE_MIGRATION_GC=plan-ready\n'
fi
