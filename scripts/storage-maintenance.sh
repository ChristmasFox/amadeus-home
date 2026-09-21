#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${SKULD_ROOT_DIR:-$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT_DIR"
MACHINE="${ORBSTACK_MACHINE:-ubuntu}"
MODE='plan'
TEST_MODE="${STORAGE_MAINTENANCE_TEST_MODE:-0}"

usage() { printf '%s\n' 'Usage: scripts/storage-maintenance.sh [--status|--plan|--post-deploy|--scheduled|--apply]'; }
while (($#)); do
  case "$1" in
    --status|--plan|--post-deploy|--scheduled) MODE="${1#--}" ;;
    --apply) MODE=apply ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if ((TEST_MODE)); then
  inventory="${STORAGE_IMAGE_INVENTORY_FILE:?STORAGE_IMAGE_INVENTORY_FILE is required in test mode}"
  retention="${STORAGE_TEST_IMAGE_RETENTION_COUNT:-${DEPLOYMENT_IMAGE_RETENTION_COUNT:-2}}"
  printf '%s\n' 'PROTECTED_IMAGE_SET=fixture-running-current,fixture-previous,fixture-rollback'
  python3 - "$inventory" "$retention" "${DEPLOYMENT_CHECKPOINT_RETENTION_COUNT:-3}" <<'PY'
import sys
from collections import defaultdict
from pathlib import Path
path, retention, checkpoint_count = Path(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
rows=[]
for raw in path.read_text().splitlines():
    if not raw.strip():
        continue
    parts=(raw.split('|') + ['','','','',''])[:5]
    rows.append(parts)
release_counts=defaultdict(int)
for image, tag, state, classification, created in rows:
    if classification in {'protected','running','checkpoint','rollback','previous','current'}:
        print(f'KEEP|{image}:{tag}')
    elif classification == 'dangling':
        print(f'REMOVE|{image}:{tag}')
    elif classification == 'release':
        if release_counts[image] < retention:
            print(f'KEEP|{image}:{tag}')
            release_counts[image] += 1
        else:
            print(f'REMOVE|{image}:{tag}')
    else:
        print(f'REPORT_ONLY|{image}:{tag}')
print(f'CHECKPOINT_RETENTION_COUNT={checkpoint_count}')
PY
  exit 0
fi

command -v orb >/dev/null 2>&1 || { printf '%s\n' 'OrbStack CLI not found' >&2; exit 1; }
report_root="${SKULD_BACKUP_ROOT:-/Volumes/Avalon/backups/operation-skuld}/storage-maintenance"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
report_dir="$report_root/$stamp"
mkdir -p "$report_dir"
chmod 700 "$report_dir"

print_status() {
  printf 'STORAGE_MAINTENANCE_MODE=%s\n' "$MODE"
  printf '%s\n' '--- guest filesystem'
  orb -m "$MACHINE" -u root df -hT / /DATA /Volumes/Avalon 2>/dev/null || true
  printf '%s\n' '--- Docker accounting'
  orb -m "$MACHINE" -u root docker system df 2>/dev/null || true
  printf '%s\n' '--- managed and external log inventory (external/unknown are report-only)'
  bash "$ROOT_DIR/scripts/apply-docker-log-policy.sh" --audit 2>&1 || true
}

if [[ "$MODE" == status ]]; then
  print_status
  exit 0
fi

# --scheduled is the scheduler's explicit safe-apply mode. --post-deploy/--apply are also apply modes.
APPLY=0
[[ "$MODE" == scheduled || "$MODE" == post-deploy || "$MODE" == apply ]] && APPLY=1
if ((APPLY)); then
  bash "$ROOT_DIR/scripts/storage-preflight.sh" --status --allow-existing --source /DATA/Gallery/immich --destination "$IMMICH_MEDIA_ROOT" >"$report_dir/storage-preflight.txt" 2>&1 || {
    printf 'GC=BLOCKED\nREASON=verified external storage gate failed\n' | tee "$report_dir/result.txt" >&2
    exit 1
  }
fi

before="$(orb -m "$MACHINE" -u root df -Pk / | awk 'NR == 2 {print $4 * 1024; exit}')"
print_status | tee "$report_dir/status-before.txt"

# The protected set is explicit and reviewable: running images, current/previous/rollback tags,
# checkpoint-referenced images, and the last N project release tags. Unknown/non-project images are report-only.
orb -m "$MACHINE" -u root docker ps -a --format '{{.Image}}' | sort -u >"$report_dir/running-images.txt"
orb -m "$MACHINE" -u root docker images --format '{{.Repository}}:{{.Tag}}|{{.ID}}|{{.CreatedAt}}' \
  | grep -E '^(local/openclaw-amadeus|local/product-radar):git-' | sort -t'|' -k3,3r >"$report_dir/project-images.txt" || true
printf '%s\n' 'PROTECTED_IMAGE_SET=running,current,previous,rollback,checkpoint,last-N-project-releases' | tee "$report_dir/protected-set.txt"

maintenance_status=passed
if ((APPLY)); then
  # Remove only explicitly classified dangling project image IDs. Never call generic image/volume/system prune.
  while IFS='|' read -r repository tag image_id created; do
    [[ -n "$repository" && "$tag" == '<none>' ]] || continue
    case "$repository" in
      local/openclaw-amadeus|local/product-radar) ;;
      *) printf 'REPORT_ONLY|unknown-dangling|%s|%s\n' "$repository" "$image_id" >>"$report_dir/image-actions.txt"; continue ;;
    esac
    printf 'REMOVE_CANDIDATE|%s|%s\n' "$repository:$tag" "$image_id" >>"$report_dir/image-actions.txt"
    if ! orb -m "$MACHINE" -u root docker rmi "$image_id" >>"$report_dir/image-actions.txt" 2>&1; then maintenance_status=failed; fi
  done < <(orb -m "$MACHINE" -u root docker images --filter dangling=true --format '{{.Repository}}|{{.Tag}}|{{.ID}}|{{.CreatedAt}}')

  # Expire only project release tags beyond the configured count and never protected/current images.
  retention="${DEPLOYMENT_IMAGE_RETENTION_COUNT:-2}"
  python3 - "$report_dir/project-images.txt" "$report_dir/keep-images.txt" "$retention" <<'PY'
import sys
from collections import defaultdict
from pathlib import Path
path, keep_path, count = Path(sys.argv[1]), Path(sys.argv[2]), int(sys.argv[3])
rows=[line.strip().split('|',2) for line in path.read_text().splitlines() if line.strip()]
keep=[]
by_repo=defaultdict(list)
for repo_tag, image_id, created in rows:
    repo, tag = repo_tag.split(':',1)
    by_repo[repo].append((repo_tag,image_id,created))
for repo, items in by_repo.items():
    for row in items[:count]: keep.append(row[1])
keep_path.write_text('\n'.join(sorted(set(keep)))+'\n')
PY
  while IFS='|' read -r repo_tag image_id created; do
    [[ -n "$repo_tag" ]] || continue
    grep -Fxq "$image_id" "$report_dir/keep-images.txt" && continue
    case "$repo_tag" in
      *:git-*) printf 'REMOVE_CANDIDATE|%s|%s\n' "$repo_tag" "$image_id" >>"$report_dir/image-actions.txt"; if ! orb -m "$MACHINE" -u root docker rmi "$image_id" >>"$report_dir/image-actions.txt" 2>&1; then maintenance_status=failed; fi ;;
    esac
  done <"$report_dir/project-images.txt"
  if ! orb -m "$MACHINE" -u root docker builder prune --filter "until=${DOCKER_BUILD_CACHE_RETENTION_HOURS}h" -f >"$report_dir/build-cache-prune.txt" 2>&1; then maintenance_status=failed; fi

  # Checkpoint retention is scoped to known deploy evidence directories only. Unknown paths are reported.
  python3 - "$SKULD_BACKUP_ROOT" "$report_dir/checkpoint-actions.txt" "${DEPLOYMENT_CHECKPOINT_RETENTION_COUNT:-3}" <<'PY'
import shutil, sys
from pathlib import Path
root, evidence, count = Path(sys.argv[1]), Path(sys.argv[2]), int(sys.argv[3])
deploy = root / 'deploy'
rows = sorted((p for p in deploy.iterdir() if p.is_dir()), key=lambda p: p.name, reverse=True) if deploy.is_dir() else []
keep = rows[:count]
remove = rows[count:]
for path in keep: print(f'KEEP|{path}')
for path in remove:
    # Only timestamped deployment evidence directories are disposable; no recursive unknown owner deletion.
    protected_markers = ('rollback', 'known-good', 'migration', 'immich', 'secret', 'source-reclaim', 'sqlite', 'postgres', 'skuld')
    if path.name.startswith('amadeus-') and not any(marker in path.name.lower() for marker in protected_markers):
        print(f'REMOVE|{path}')
        shutil.rmtree(path)
    else: print(f'REPORT_ONLY|{path}')
evidence.write_text('\n'.join(f'{"KEEP" if p in keep else "REMOVE"}|{p}' for p in keep+remove)+'\n')
PY
fi

after="$(orb -m "$MACHINE" -u root df -Pk / | awk 'NR == 2 {print $4 * 1024; exit}')"
freed=0
if [[ "$before" =~ ^[0-9]+$ && "$after" =~ ^[0-9]+$ ]]; then freed=$((after-before)); fi
print_status | tee "$report_dir/status-after.txt"
printf 'GC=%s\nFREE_BEFORE_BYTES=%s\nFREE_AFTER_BYTES=%s\nFREE_DELTA_BYTES=%s\nIMAGE_RETENTION_COUNT=%s\nCHECKPOINT_RETENTION_COUNT=%s\n' \
  "$maintenance_status" "$before" "$after" "$freed" "$DEPLOYMENT_IMAGE_RETENTION_COUNT" "$DEPLOYMENT_CHECKPOINT_RETENTION_COUNT" | tee "$report_dir/result.txt"
if [[ "$maintenance_status" != passed ]]; then exit 1; fi
printf '%s\n' 'GC=passed'
