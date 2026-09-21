#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${SKULD_ROOT_DIR:-$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
MIGRATION_TEST_MODE="${MIGRATION_TEST_MODE:-0}"
if ((MIGRATION_TEST_MODE)); then export STORAGE_PREFLIGHT_TEST_MODE=1; fi
export STORAGE_PREFLIGHT_LIB_ONLY=1
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/storage-preflight.sh"

MACHINE="${ORBSTACK_MACHINE:-ubuntu}"
IMMICH_COMPOSE_FILE="${IMMICH_COMPOSE_FILE:-/var/lib/casaos/apps/immich/docker-compose.yml}"
IMMICH_SOURCE_ROOT="${IMMICH_SOURCE_ROOT:-}"
MIGRATION_STATE_DIR="${IMMICH_MIGRATION_STATE_DIR:-$SKULD_BACKUP_ROOT/immich-migration}"
MIGRATION_STATE_FILE="$MIGRATION_STATE_DIR/state.json"
RSYNC_REPORT="$MIGRATION_STATE_DIR/rsync-checksum-report.txt"
ACTION=''
CUTOVER_STARTED=0
CUTOVER_SUCCEEDED=0
ROLLBACK_COMPOSE=''

usage() {
  cat <<'USAGE'
Usage: scripts/migrate-immich-media.sh --plan|--precopy|--verify|--cutover|--status

The default behavior is read-only. The copy is resumable and never removes
destination entries or mutates the source. Source reclaim is a separate tool.
USAGE
}

fail() { printf 'BLOCKER  %s\n' "$*" >&2; exit 1; }

guest() {
  if ((MIGRATION_TEST_MODE)); then "$@"; else orb -m "$MACHINE" -u root "$@"; fi
}

discover_source() {
  if [[ -n "$IMMICH_SOURCE_ROOT" ]]; then
    printf '%s\n' "$IMMICH_SOURCE_ROOT"
  elif ((MIGRATION_TEST_MODE)); then
    fail 'IMMICH_SOURCE_ROOT is required in migration test mode'
  else
    local value
    value="$(orb -m "$MACHINE" -u root docker inspect --format '{{range .Mounts}}{{if eq .Destination "/usr/src/app/upload"}}{{.Source}}{{end}}{{end}}' immich-server 2>/dev/null || true)"
    [[ -n "$value" ]] || fail 'could not discover the live Immich media mount from immich-server'
    printf '%s\n' "$value"
  fi
}

stat_value() { printf '%s\n' "$1" | awk -F= -v key="$2" '$1 == key {print substr($0, index($0, "=") + 1); exit}'; }

ensure_state_dir() {
  mkdir -p "$MIGRATION_STATE_DIR"
  chmod 700 "$MIGRATION_STATE_DIR"
}

record_state() {
  local source="$1" destination="$2" phase="$3" copy_status="$4" verify_status="$5" db_dump="$6" old_bytes="$7" rsync_status="$8"
  ensure_state_dir
  python3 - "$MIGRATION_STATE_FILE" "$source" "$destination" "$phase" "$copy_status" "$verify_status" "$db_dump" "$old_bytes" "$rsync_status" <<'PY'
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

target, source, destination, phase, copy_status, verify_status, db_dump, old_bytes, rsync_status = sys.argv[1:]
path = Path(target)
previous = json.loads(path.read_text()) if path.is_file() else {}
previous.update({
    'schemaVersion': 1,
    'source': source,
    'destination': destination,
    'phase': phase,
    'copyStatus': copy_status,
    'equivalenceStatus': verify_status,
    'dbBackupPath': db_dump or None,
    'oldSourceBytes': int(old_bytes or 0),
    'reclaimableBytes': int(old_bytes or 0),
    'sourceRetained': True,
    'sourceReclaimPending': True,
    'rsyncExitStatus': int(rsync_status or 0),
    'updatedAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
})
path.write_text(json.dumps(previous, ensure_ascii=False, indent=2) + '\n')
path.chmod(0o600)
PY
}

run_stats() { storage_stats "$1" "$2"; }

run_preflight() {
  STORAGE_FAILURES=0
  STORAGE_WARNINGS=0
  storage_preflight "$1" "$2" "${3:-0}"
  ((STORAGE_FAILURES == 0)) || fail 'external storage preflight failed; source and destination were left unchanged'
}

ensure_destination() {
  local destination="$1"
  if [[ -e "$destination" && ! -d "$destination" ]]; then fail "destination is not a directory: $destination"; fi
  if ((MIGRATION_TEST_MODE)); then mkdir -p "$destination"; else orb -m "$MACHINE" -u root mkdir -p "$destination"; fi
}

copy_media() {
  local source="$1" destination="$2" report="$3"
  if ((MIGRATION_TEST_MODE)); then
    rsync -rt --checksum --partial --human-readable --stats "$source/" "$destination/" >"$report"
  else
    orb -m "$MACHINE" -u root rsync -rt --checksum --partial --human-readable --stats "$source/" "$destination/" >"$report"
  fi
}

checksum_verify() {
  local source="$1" destination="$2" report="$3"
  if ((MIGRATION_TEST_MODE)); then
    rsync -rt --checksum --dry-run --out-format='%i %n%L' "$source/" "$destination/" >"$report"
  else
    orb -m "$MACHINE" -u root rsync -rt --checksum --dry-run --out-format='%i %n%L' "$source/" "$destination/" >"$report"
  fi
  ! grep -E '^[<>c].*f' "$report" >/dev/null 2>&1
}

verify_equivalence() {
  local source="$1" destination="$2" stats source_files destination_files source_bytes destination_bytes source_zero destination_zero child
  stats="$(run_stats "$source" "$destination")" || return 1
  source_files="$(stat_value "$stats" SOURCE_FILES)"
  destination_files="$(stat_value "$stats" DESTINATION_FILES)"
  source_bytes="$(stat_value "$stats" SOURCE_BYTES)"
  destination_bytes="$(stat_value "$stats" DESTINATION_BYTES)"
  [[ "$source_files" == "$destination_files" ]] || { printf 'EQUIVALENCE_FAIL=file_count:%s:%s\n' "$source_files" "$destination_files"; return 1; }
  [[ "$source_bytes" == "$destination_bytes" ]] || { printf 'EQUIVALENCE_FAIL=logical_bytes:%s:%s\n' "$source_bytes" "$destination_bytes"; return 1; }
  source_zero="$(stat_value "$stats" SOURCE_ZERO)"
  destination_zero="$(stat_value "$stats" DESTINATION_ZERO)"
  [[ "$source_zero" == "$destination_zero" ]] || { printf '%s\n' 'EQUIVALENCE_FAIL=zero_byte_manifest'; return 1; }
  for child in library upload thumbs encoded-video profile backups; do
    if ((MIGRATION_TEST_MODE)); then
      [[ -d "$source/$child" && -d "$destination/$child" ]] || { printf 'EQUIVALENCE_FAIL=missing_subtree:%s\n' "$child"; return 1; }
    else
      guest test -d "$source/$child" || { printf 'EQUIVALENCE_FAIL=source_subtree:%s\n' "$child"; return 1; }
      guest test -d "$destination/$child" || { printf 'EQUIVALENCE_FAIL=destination_subtree:%s\n' "$child"; return 1; }
    fi
  done
  ensure_state_dir
  checksum_verify "$source" "$destination" "$RSYNC_REPORT" || { printf '%s\n' 'EQUIVALENCE_FAIL=checksum_dry_run'; return 1; }
  printf 'EQUIVALENCE=passed\nSOURCE_FILES=%s\nSOURCE_BYTES=%s\n' "$source_files" "$source_bytes"
}

create_db_backup() {
  local checkpoint="$1" dump dump_image dump_name
  dump="$checkpoint/immich-postgres.dump"
  mkdir -p "$checkpoint"
  if ((MIGRATION_TEST_MODE)); then
    printf '%s\n' 'fixture-db-backup' >"$dump"
  else
    orb -m "$MACHINE" -u root docker exec immich-postgres sh -lc 'pg_dump -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-immich}" -Fc' >"$dump"
    dump_image="$(orb -m "$MACHINE" -u root docker inspect --format '{{.Config.Image}}' immich-postgres)"
    [[ -n "$dump_image" ]] || fail 'could not resolve the live Immich PostgreSQL image for dump validation'
    dump_name="$(basename "$dump")"
    orb -m "$MACHINE" -u root docker run --rm --entrypoint pg_restore \
      -v "$(dirname "$dump"):/tmp/immich-cutover:ro" \
      "$dump_image" --list "/tmp/immich-cutover/$dump_name" >/dev/null
  fi
  [[ -s "$dump" ]] || fail 'fresh Immich PostgreSQL backup is empty'
  chmod 600 "$dump"
  printf '%s\n' "$dump"
}

backup_compose() {
  local checkpoint="$1" target
  target="$checkpoint/immich-compose.before.yml"
  if ((MIGRATION_TEST_MODE)); then cp "$IMMICH_COMPOSE_FILE" "$target"; else orb -m "$MACHINE" -u root cat "$IMMICH_COMPOSE_FILE" >"$target"; fi
  chmod 600 "$target"
  printf '%s\n' "$target"
}

stop_media_writers() {
  ((MIGRATION_TEST_MODE)) && return
  orb -m "$MACHINE" -u root docker compose -f "$IMMICH_COMPOSE_FILE" stop immich-server immich-machine-learning >/dev/null
}

restore_old_compose() {
  local backup="$1"
  [[ -f "$backup" ]] || return 0
  if ((MIGRATION_TEST_MODE)); then
    cp "$backup" "$IMMICH_COMPOSE_FILE"
  else
    orb -m "$MACHINE" -u root cp "$backup" "$IMMICH_COMPOSE_FILE" 2>/dev/null || cp "$backup" "$IMMICH_COMPOSE_FILE"
    orb -m "$MACHINE" -u root docker compose -f "$IMMICH_COMPOSE_FILE" up -d immich-server immich-machine-learning >/dev/null || true
  fi
}

rollback_if_needed() {
  if ((CUTOVER_STARTED && !CUTOVER_SUCCEEDED)); then
    printf '%s\n' 'IMMICH_CUTOVER=failed; restoring the pre-cutover compose without touching either media tree' >&2
    restore_old_compose "$ROLLBACK_COMPOSE"
  fi
}

wait_healthy() {
  ((MIGRATION_TEST_MODE)) && return 0
  local i status
  for i in $(seq 1 60); do
    status="$(orb -m "$MACHINE" -u root docker inspect --format '{{.State.Health.Status}}' immich-server 2>/dev/null || true)"
    if [[ "$status" == healthy ]] && orb -m "$MACHINE" -u root curl --fail --silent --max-time 5 http://127.0.0.1:2283/api/server/ping >/dev/null; then
      local all_healthy=1
      for name in immich-machine-learning immich-postgres immich-redis; do
        status="$(orb -m "$MACHINE" -u root docker inspect --format '{{.State.Health.Status}}' "$name" 2>/dev/null || true)"
        [[ "$status" == healthy ]] || all_healthy=0
      done
      ((all_healthy)) && return 0
    fi
    sleep 2
  done
  return 1
}

update_live_compose() {
  local destination="$1"
  ((MIGRATION_TEST_MODE)) && return
  orb -m "$MACHINE" -u root python3 - "$IMMICH_COMPOSE_FILE" "$destination" <<'PY'
import sys
from pathlib import Path

path, destination = sys.argv[1:]
lines = Path(path).read_text(encoding='utf-8').splitlines(keepends=True)
matches = 0
for index, line in enumerate(lines):
    if line.strip() == 'source: /DATA/Gallery/immich':
        indent = line[:len(line) - len(line.lstrip())]
        lines[index] = indent + 'source: ' + destination + '\n'
        matches += 1
if matches != 1:
    raise SystemExit(f'expected exactly one old Immich media source, found {matches}')
temporary = Path(str(path) + '.skuld-tmp')
temporary.write_text(''.join(lines), encoding='utf-8')
temporary.replace(path)
PY
}

cutover() {
  local source="$1" destination="$2" state checkpoint dump stats old_bytes
  state="$(cat "$MIGRATION_STATE_FILE" 2>/dev/null || true)"
  [[ "$state" == *'"equivalenceStatus": "passed"'* ]] || fail 'cutover requires a passed equivalence checkpoint'
  ensure_state_dir
  checkpoint="$MIGRATION_STATE_DIR/cutover-$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$checkpoint"
  ROLLBACK_COMPOSE="$(backup_compose "$checkpoint")"
  dump="$(create_db_backup "$checkpoint")"
  stats="$(run_stats "$source" "$destination")"
  old_bytes="$(stat_value "$stats" SOURCE_BYTES)"
  stop_media_writers
  CUTOVER_STARTED=1
  copy_media "$source" "$destination" "$MIGRATION_STATE_DIR/final-copy-report.txt"
  verify_equivalence "$source" "$destination" >/dev/null || fail 'final sync equivalence gate failed; old source remains authoritative'
  update_live_compose "$destination"
  if ((MIGRATION_TEST_MODE == 0)); then
    orb -m "$MACHINE" -u root docker compose -f "$IMMICH_COMPOSE_FILE" config --quiet
    orb -m "$MACHINE" -u root docker compose -f "$IMMICH_COMPOSE_FILE" up -d immich-server immich-machine-learning >/dev/null
  fi
  wait_healthy || fail 'Immich did not return healthy after the media mount cutover'
  if ((MIGRATION_TEST_MODE == 0)); then
    orb -m "$MACHINE" -u root docker exec immich-server sh -lc 'test -r /usr/src/app/upload/library && test -r /usr/src/app/upload/thumbs && test -r /usr/src/app/upload/encoded-video'
  fi
  record_state "$source" "$destination" 'cutover-complete' 'passed' 'passed' "$dump" "$old_bytes" 0
  stats="$(run_stats "$source" "$destination")"
  local source_files destination_files destination_bytes destination_free facts_json release_version
  source_files="$(stat_value "$stats" SOURCE_FILES)"
  destination_bytes="$(stat_value "$stats" DESTINATION_BYTES)"
  destination_files="$(stat_value "$stats" DESTINATION_FILES)"
  destination_free="$(stat_value "$stats" DESTINATION_FREE_BYTES)"
  release_version="$(bash "$ROOT_DIR/scripts/amadeus-version.sh" show 2>/dev/null || printf '%s' unknown)"
  facts_json="$(python3 - "$old_bytes" "$destination_bytes" "$source_files" "$destination_files" "$destination_free" <<'PY'
import json
import sys

old_bytes, destination_bytes, source_files, destination_files, destination_free = map(int, sys.argv[1:])
print(json.dumps([
    {'label': '源媒体字节', 'value': old_bytes},
    {'label': '目标媒体字节', 'value': destination_bytes},
    {'label': '源文件数', 'value': source_files},
    {'label': '目标文件数', 'value': destination_files},
    {'label': '外置盘可用字节', 'value': destination_free},
    {'label': '旧源保留', 'value': True},
    {'label': '预计可回收字节', 'value': old_bytes},
]))
PY
  )"
  bash "$ROOT_DIR/scripts/notify-owner.sh" \
    --remote-machine "$MACHINE" \
    --outbox-dir "$OPENCLAW_DATA_DIR/notifications" \
    --event-key "immich-storage-cutover:$release_version" \
    --source immich-storage \
    --headline 'Immich 媒体存储已切换至 8TB 外接盘 · 世界线收束' \
    --summary 'Immich 媒体目标已通过文件数、逻辑字节、checksum dry-run、数据库备份和健康检查；旧源仍保留，source reclaim 尚未执行。' \
    --severity success \
    --significance major \
    --theme worldline_convergence \
    --facts-json "$facts_json" \
    --worldline-closing || true
  CUTOVER_SUCCEEDED=1
  printf 'IMMICH_LIVE_MEDIA=EXTERNAL_8TB\nIMMICH_DESTINATION_VERIFIED=yes\nIMMICH_OLD_SOURCE=retained\nSOURCE_RECLAIM_PENDING=yes\nRECLAIMABLE_BYTES=%s\n' "$old_bytes"
}

status() {
  printf 'IMMICH_MEDIA_ROOT=%s\n' "$IMMICH_MEDIA_ROOT"
  printf 'MIGRATION_STATE=%s\n' "$MIGRATION_STATE_FILE"
  if [[ -f "$MIGRATION_STATE_FILE" ]]; then
    python3 - "$MIGRATION_STATE_FILE" <<'PY'
import json
import sys
from pathlib import Path

value = json.loads(Path(sys.argv[1]).read_text())
for key in ('phase', 'source', 'destination', 'copyStatus', 'equivalenceStatus', 'sourceRetained', 'sourceReclaimPending', 'oldSourceBytes', 'reclaimableBytes', 'dbBackupPath'):
    print(f'{key}={value.get(key)}')
PY
  else
    printf '%s\n' 'IMMICH_MIGRATION_STATE=absent'
  fi
  if ((MIGRATION_TEST_MODE == 0)); then
    printf 'LIVE_MEDIA_MOUNT=%s\n' "$(discover_source)"
  fi
}

while (($#)); do
  case "$1" in
    --plan|--precopy|--verify|--cutover|--status) ACTION="${1#--}" ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done
[[ -n "$ACTION" ]] || { usage >&2; exit 2; }

trap rollback_if_needed EXIT
if [[ "$ACTION" == status ]]; then status; exit 0; fi

SOURCE="$(discover_source)"
DESTINATION="$IMMICH_MEDIA_ROOT"
case "$ACTION" in
  plan)
    run_preflight "$SOURCE" "$DESTINATION" 0 || true
    printf 'SOURCE=%s\nDESTINATION=%s\n' "$SOURCE" "$DESTINATION"
    ;;
  precopy)
    ensure_state_dir
    [[ -f "$MIGRATION_STATE_FILE" ]] && export STORAGE_ALLOW_RESUMABLE_DEST=1
    run_preflight "$SOURCE" "$DESTINATION" "${STORAGE_ALLOW_RESUMABLE_DEST:+1}"
    ensure_destination "$DESTINATION"
    copy_media "$SOURCE" "$DESTINATION" "$MIGRATION_STATE_DIR/precopy-report.txt" || fail 'pre-copy failed; source was not modified'
    stats="$(run_stats "$SOURCE" "$DESTINATION")"
    old_bytes="$(stat_value "$stats" SOURCE_BYTES)"
    record_state "$SOURCE" "$DESTINATION" 'precopy-complete' 'passed' 'pending' '' "$old_bytes" 0
    printf 'IMMICH_PRECOPY=passed\nSOURCE_FILES=%s\nSOURCE_BYTES=%s\n' "$(stat_value "$stats" SOURCE_FILES)" "$old_bytes"
    ;;
  verify)
    ensure_state_dir
    run_preflight "$SOURCE" "$DESTINATION" 1
    if verify_equivalence "$SOURCE" "$DESTINATION"; then
      stats="$(run_stats "$SOURCE" "$DESTINATION")"
      old_bytes="$(stat_value "$stats" SOURCE_BYTES)"
      record_state "$SOURCE" "$DESTINATION" 'verified' 'passed' 'passed' '' "$old_bytes" 0
      printf '%s\n' 'IMMICH_EQUIVALENCE=passed'
    else
      record_state "$SOURCE" "$DESTINATION" 'verification-failed' 'passed' 'failed' '' '0' 1
      fail 'Immich equivalence verification failed; cutover is blocked'
    fi
    ;;
  cutover) cutover "$SOURCE" "$DESTINATION" ;;
esac
