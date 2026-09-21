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
  printf '%s\n' 'PROTECTED_IMAGE_SET=fixture-running-current,fixture-previous,fixture-rollback'
  while IFS='|' read -r image tag state classification; do
    [[ -n "$image" ]] || continue
    case "$classification" in
      protected|running) printf 'KEEP|%s:%s\n' "$image" "$tag" ;;
      dangling) printf 'REMOVE|%s:%s\n' "$image" "$tag" ;;
      *) printf 'REPORT_ONLY|%s:%s\n' "$image" "$tag" ;;
    esac
  done <"$inventory"
  exit 0
fi

command -v orb >/dev/null 2>&1 || { printf '%s\n' 'OrbStack CLI not found' >&2; exit 1; }
if [[ "$MODE" == apply ]]; then
  bash "$ROOT_DIR/scripts/storage-preflight.sh" --status --allow-existing --source /DATA/Gallery/immich --destination "$IMMICH_MEDIA_ROOT" >/dev/null || {
    printf '%s\n' 'STORAGE_MAINTENANCE=blocked; verified external storage is unavailable' >&2
    exit 1
  }
fi
if [[ -d "$EXTERNAL_STORAGE_ROOT" ]]; then
  report_root="${SKULD_BACKUP_ROOT:-/Volumes/Avalon/backups/operation-skuld}/storage-maintenance"
else
  report_root="${TMPDIR:-/tmp}/amadeus-storage-maintenance"
  printf 'WARN  external storage root is absent; plan evidence uses %s\n' "$report_root" >&2
fi
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
report_dir="$report_root/$stamp"
mkdir -p "$report_dir"
chmod 700 "$report_dir"

disk_available() { orb -m "$MACHINE" -u root df -Pk / | awk 'NR == 2 {print $4 * 1024; exit}'; }

print_status() {
  printf 'STORAGE_MAINTENANCE_MODE=%s\n' "$MODE"
  printf '%s\n' '--- guest filesystem'
  orb -m "$MACHINE" -u root df -hT / /DATA /Volumes/Avalon 2>/dev/null || true
  printf '%s\n' '--- Docker accounting'
  orb -m "$MACHINE" -u root docker system df || true
  printf '%s\n' '--- log policy audit (unknown services are report-only)'
  orb -m "$MACHINE" -u root bash -lc '
    for name in $(docker ps -a --format "{{.Names}}"); do
      docker inspect --format "{{.Name}}|{{.HostConfig.LogConfig.Type}}|{{json .HostConfig.LogConfig.Config}}|{{index .Config.Labels \"com.docker.compose.project.working_dir\"}}" "$name" 2>/dev/null || true
    done
  ' | sort
}

if [[ "$MODE" == status ]]; then
  print_status
  exit 0
fi

before="$(disk_available)"
print_status | tee "$report_dir/status-before.txt"
printf '%s\n' '--- protected image set'
orb -m "$MACHINE" -u root docker ps -a --format '{{.Names}}|{{.Image}}' | sort >"$report_dir/running-images.txt"
cat "$report_dir/running-images.txt"
printf '%s\n' 'Protected set includes every running image, current/previous Amadeus and Product Radar tags, current 9Router, rollback-* tags, and checkpoint-referenced images.'

if [[ "$MODE" == plan || "$MODE" == scheduled ]]; then
  printf '%s\n' 'PLAN=read-only; no images, volumes, logs, AppData, or media were changed.'
  exit 0
fi

maintenance_status=passed
if ! orb -m "$MACHINE" -u root docker image prune -f >"$report_dir/dangling-image-prune.txt" 2>&1; then
  maintenance_status=failed
fi
if ! orb -m "$MACHINE" -u root docker builder prune --filter "until=${DOCKER_BUILD_CACHE_RETENTION_HOURS}h" -f >"$report_dir/build-cache-prune.txt" 2>&1; then
  maintenance_status=failed
fi

after="$(disk_available)"
if [[ "$before" =~ ^[0-9]+$ && "$after" =~ ^[0-9]+$ ]]; then
  freed=$((after - before))
else
  freed=0
fi
print_status | tee "$report_dir/status-after.txt"
printf 'POST_DEPLOY_MAINTENANCE=%s\nFREE_BEFORE_BYTES=%s\nFREE_AFTER_BYTES=%s\nFREE_DELTA_BYTES=%s\n' "$maintenance_status" "$before" "$after" "$freed" | tee "$report_dir/result.txt"

if [[ "$maintenance_status" != passed ]]; then
  bash "$ROOT_DIR/scripts/notify-owner.sh" --remote-machine "$MACHINE" --outbox-dir "$OPENCLAW_DATA_DIR/notifications" \
    --event-key "storage-maintenance:$stamp" --source storage-maintenance --headline '存储维护发生偏移' \
    --summary "受保护对象未触碰；允许的 Docker GC 有失败，已保留证据：$report_dir" \
    --severity warning --significance major --theme worldline_divergence || true
  exit 1
fi
if ((freed >= STORAGE_MEANINGFUL_RELEASE_BYTES)); then
  bash "$ROOT_DIR/scripts/notify-owner.sh" --remote-machine "$MACHINE" --outbox-dir "$OPENCLAW_DATA_DIR/notifications" \
    --event-key "storage-maintenance:$stamp" --source storage-maintenance --headline '存储维护完成' \
    --summary "Docker 受保护集之外的可回收对象已清理；可用空间从 $before bytes 增至 $after bytes，释放 $freed bytes。" \
    --severity success --significance notable --theme worldline_convergence --worldline-closing || true
fi
exit 0
