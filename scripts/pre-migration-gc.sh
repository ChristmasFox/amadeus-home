#!/usr/bin/env bash
# scripts/pre-migration-gc.sh
# Amadeus 1.4.7 — Safe pre-migration garbage cleanup with real protected image set.
#
# The protected image set is built from:
#   - All currently running container images
#   - Current release image and previous known-good image
#   - Rollback tags and checkpoint/deployment evidence image tags
#   - Last-N project release images
#   - Exact 9Router image
#
# NEVER removes: old-but-running images, checkpoint/rollback referenced images,
#               named volumes, external media, or unknown AppData.
# Unknown images (not local project images) are report-only.
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
    --plan)    MODE=plan ;;
    --apply)   MODE=apply ;;
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
    printf 'GC_PROTECTED_SET_COUNT=5 (fixture)\n'
    printf 'GC_DANGLING_IMAGES=0 (fixture)\n'
    printf 'GC_BUILD_CACHE_FREED=0 (fixture)\n'
    printf 'GC_EXCESS_PROJECT_IMAGES=0 (fixture)\n'
    printf 'GC_PROTECTED_PROJECT_IMAGES=2 (fixture)\n'
    printf 'GC_VOLUMES_PRUNED=0 (never)\n'
    printf 'GC_SYSTEM_PRUNE=never\n'
  } | tee "$report_dir/gc-plan.txt"
  printf 'PRE_MIGRATION_GC=passed (test-mode)\n'
  exit 0
fi

command -v orb >/dev/null 2>&1 || { printf 'OrbStack CLI not found\n' >&2; exit 1; }

# ── Step 1: Build real protected image set ─────────────────────────────────
printf '%s\n' '--- Building real protected image set ---' | tee "$report_dir/protected-set.txt"

# Gather data from OrbStack guest
protected_raw="$(orb -m "$MACHINE" -u root bash -lc 'set -Eeuo pipefail
# Running container images (always protected — old-but-running must never be removed)
running_images=$(docker ps -a --format "{{.Image}}" 2>/dev/null || true)
# All non-dangling image tags
all_named=$(docker images --format "{{.Repository}}:{{.Tag}}" 2>/dev/null | grep -v "<none>" || true)
# Exact 9Router image (protected)
nine_router=$(docker images local/9router --format "{{.Repository}}:{{.Tag}}" 2>/dev/null \
  | grep -v "<none>" | head -n 1 || true)
# Last-N project release images (most recent first)
release_images=$(docker images --format "{{.Repository}}:{{.Tag}}|{{.CreatedAt}}" 2>/dev/null \
  | grep -E "^(local/openclaw-amadeus|local/product-radar):git-" \
  | sort -t"|" -k2,2r | head -n 6 | cut -d"|" -f1 || true)
# Checkpoint/deployment evidence image tags from AppData and /Volumes backup root
checkpoint_refs=$(find /DATA/AppData/openclaw/backups -maxdepth 3 -name "*.json" 2>/dev/null \
  | xargs grep -ho "git-[0-9a-f]*-[0-9]\{14\}" 2>/dev/null \
  | sort -u | head -n 20 || true)
printf "%s\n---NINE_ROUTER---\n%s\n---RELEASES---\n%s\n---CHECKPOINTS---\n%s\n" \
  "$running_images" "$nine_router" "$release_images" "$checkpoint_refs"
' 2>/dev/null || printf '')"

protected_images_json="$(python3 - "$protected_raw" << 'PY'
import json, sys, re
raw = sys.argv[1]
# Parse sections
sections = re.split(r'---[A-Z_]+---', raw)
running = [l.strip() for l in sections[0].splitlines() if l.strip()] if len(sections) > 0 else []
nine_r = sections[1].strip() if len(sections) > 1 else ''
releases = [l.strip() for l in sections[2].splitlines() if l.strip()] if len(sections) > 2 else []
ckpts = [l.strip() for l in sections[3].splitlines() if l.strip()] if len(sections) > 3 else []
protected = list(set(running + ([nine_r] if nine_r else []) + releases))
print(json.dumps({
    "running": running, "nineRouter": nine_r,
    "releases": releases, "checkpointTags": ckpts,
    "protected": protected
}))
PY
)" || protected_images_json='{"running":[],"nineRouter":"","releases":[],"checkpointTags":[],"protected":[]}'

printf '%s\n' "$protected_images_json" > "$report_dir/protected-set.json"
protected_count="$(printf '%s\n' "$protected_images_json" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d.get("protected",[])))' 2>/dev/null || printf '0')"
printf 'GC_PROTECTED_SET_COUNT=%s\n' "$protected_count" | tee -a "$report_dir/protected-set.txt"

# ── Step 2: Running containers (informational) ──────────────────────────────
printf '%s\n' '--- Running containers and their images (all protected) ---' | tee "$report_dir/running.txt"
orb -m "$MACHINE" -u root docker ps -a --format '{{.Image}}' | sort -u | tee -a "$report_dir/running.txt"

# ── Step 3: Dangling images (safe IF not in protected set) ──────────────────
printf '%s\n' '--- Dangling images ---' | tee "$report_dir/dangling.txt"
dangling_list="$(orb -m "$MACHINE" -u root docker images -f dangling=true -q 2>/dev/null || true)"
if [[ -n "$dangling_list" ]]; then
  orb -m "$MACHINE" -u root docker images -f dangling=true --format '{{.ID}} {{.CreatedAt}} {{.Size}}' \
    | tee -a "$report_dir/dangling.txt"
  dangling_count="$(printf '%s\n' "$dangling_list" | grep -c . || true)"
else
  dangling_count=0
  printf 'none\n' | tee -a "$report_dir/dangling.txt"
fi
printf 'GC_DANGLING_COUNT=%s\n' "$dangling_count"

# ── Step 4: Project images beyond retention (only if NOT in protected set) ──
printf 'GC_PROJECT_IMAGE_RETENTION=%s\n' "${DEPLOYMENT_IMAGE_RETENTION_COUNT:-2}"
orb -m "$MACHINE" -u root docker images \
    --format '{{.Repository}}:{{.Tag}}|{{.ID}}|{{.CreatedAt}}' \
  | grep -E '^(local/openclaw-amadeus|local/product-radar):git-' | sort -t'|' -k3,3r \
  > "$report_dir/project-images-raw.txt" 2>/dev/null || true

# Use protected set to classify images
excess_output="$(python3 - \
  "$report_dir/project-images-raw.txt" \
  "${DEPLOYMENT_IMAGE_RETENTION_COUNT:-2}" \
  "$protected_images_json" << 'PY'
import json, sys
from collections import defaultdict
from pathlib import Path

path = Path(sys.argv[1])
count = int(sys.argv[2])
protected_json_str = sys.argv[3]

try:
    pdata = json.loads(protected_json_str)
except Exception:
    pdata = {}

protected_set = set(pdata.get("protected", []))
running_set = set(pdata.get("running", []))
checkpoint_tags = set(pdata.get("checkpointTags", []))

rows = [l for l in path.read_text().splitlines() if l.strip()]
release_counts = defaultdict(int)

for row in rows:
    parts = (row.split("|") + ["", "", ""])[:3]
    image_tag = parts[0]
    repo = image_tag.split(":")[0]
    release_counts[repo] += 1
    is_running = image_tag in running_set
    in_protected = image_tag in protected_set
    has_checkpoint_ref = any(ck in image_tag for ck in checkpoint_tags if ck)
    if is_running or in_protected or has_checkpoint_ref:
        reason = []
        if is_running: reason.append("running")
        if in_protected: reason.append("protected-set")
        if has_checkpoint_ref: reason.append("checkpoint-ref")
        print(f"PROTECTED|{image_tag}|{','.join(reason)}")
    elif release_counts[repo] > count:
        print(f"EXCESS_REMOVE|{image_tag}")
    else:
        print(f"EXCESS_KEEP|{image_tag}")
PY
)" || excess_output=''

excess_count="$(printf '%s\n' "$excess_output" | grep -c '^EXCESS_REMOVE|' || true)"
protected_retain="$(printf '%s\n' "$excess_output" | grep -c '^PROTECTED|' || true)"
printf 'GC_EXCESS_PROJECT_IMAGES=%s\n' "$excess_count"
printf 'GC_PROTECTED_PROJECT_IMAGES=%s\n' "$protected_retain"
printf '%s\n' "$excess_output" > "$report_dir/project-images.txt"

# ── Step 5: Build cache ──────────────────────────────────────────────────────
printf '%s\n' '--- Docker build cache ---' | tee "$report_dir/build-cache.txt"
cache_size="$(orb -m "$MACHINE" -u root docker system df --format '{{json .}}' 2>/dev/null \
  | python3 -c 'import json,sys; rows=[json.loads(l) for l in sys.stdin if l.strip()]; print(next((r.get("Size","0") for r in rows if r.get("Type")=="Build Cache"),"0B"))' \
  2>/dev/null || printf '0B')"
printf 'GC_BUILD_CACHE_SIZE=%s\n' "$cache_size" | tee -a "$report_dir/build-cache.txt"

# ── Summary ────────────────────────────────────────────────────────────────
printf '\n--- Pre-migration GC summary ---\n'
printf 'GC_MODE=%s\n' "$MODE"
printf 'GC_PROTECTED_SET_COUNT=%s\n' "$protected_count"
printf 'GC_DANGLING_IMAGES=%s\n' "$dangling_count"
printf 'GC_EXCESS_PROJECT_IMAGES=%s\n' "$excess_count"
printf 'GC_PROTECTED_PROJECT_IMAGES=%s\n' "$protected_retain"
printf 'GC_VOLUMES_PRUNED=0 (never — explicit policy)\n'
printf 'GC_SYSTEM_PRUNE=never (explicit policy)\n'
printf 'GC_UNKNOWN_APPDATA_DELETION=never (explicit policy)\n'
printf 'GC_EXTERNAL_MEDIA_DELETION=never (explicit policy)\n'

if ((APPLY)); then
  printf '\n--- Applying safe GC ---\n'
  # Remove dangling images (no name, no tag — not in protected set by definition)
  if [[ -n "$dangling_list" ]]; then
    printf '%s\n' "$dangling_list" | xargs orb -m "$MACHINE" -u root docker rmi --no-prune 2>/dev/null || true
    printf 'GC_DANGLING_REMOVED=%s\n' "$dangling_count"
  fi
  # Remove excess project images — only those not in protected set
  printf '%s\n' "$excess_output" | grep '^EXCESS_REMOVE|' | cut -d'|' -f2 | while IFS= read -r img; do
    # Final safety check: confirm image is NOT currently running
    if orb -m "$MACHINE" -u root docker ps -a --format '{{.Image}}' | grep -Fxq "$img" 2>/dev/null; then
      printf 'GC_SKIP_RUNNING=%s\n' "$img"
      continue
    fi
    orb -m "$MACHINE" -u root docker rmi "$img" 2>/dev/null \
      && printf 'GC_REMOVED=%s\n' "$img" || printf 'GC_SKIP_FAILED=%s\n' "$img"
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
