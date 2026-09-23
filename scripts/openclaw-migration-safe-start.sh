#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT_DIR"
MACHINE="${ORBSTACK_MACHINE:-ubuntu}"
DATA_ROOT="${OPENCLAW_DATA_DIR:-/DATA/AppData/openclaw}"
APP_DIR="$OPENCLAW_APP_DIR"
ORB_BIN="${ORB_BIN:-$(command -v orb || true)}"
if [[ -z "$ORB_BIN" && -x /usr/local/bin/orb ]]; then ORB_BIN=/usr/local/bin/orb; fi
MODE=plan
APPROVAL=''

usage() {
  printf '%s\n' 'Usage: scripts/openclaw-migration-safe-start.sh [--plan|--apply --approve-avalon-move APPROVE_AVALON_MOVE_1_4_8]'
}
while (($#)); do
  case "$1" in
    --plan) MODE=plan ;;
    --apply) MODE=apply ;;
    --approve-avalon-move) shift; APPROVAL="${1:?--approve-avalon-move requires a token}" ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

[[ "$MACHINE" == nyannyan ]] || { printf 'MIGRATION_SAFE_OPENCLAW=BLOCKED machine must be nyannyan (got %s).\n' "$MACHINE"; exit 1; }
[[ -n "$ORB_BIN" ]] || { printf '%s\n' 'MIGRATION_SAFE_OPENCLAW=BLOCKED OrbStack CLI was not found.'; exit 1; }
host_name="$(scutil --get ComputerName 2>/dev/null || hostname -s)"
[[ "$host_name" == Amadeus-M204 ]] || { printf 'MIGRATION_SAFE_OPENCLAW=BLOCKED destination host identity mismatch (%s).\n' "$host_name"; exit 1; }
[[ "$(<"$ROOT_DIR/VERSION")" == 1.4.8 ]] || { printf '%s\n' 'MIGRATION_SAFE_OPENCLAW=BLOCKED VERSION must be 1.4.8.'; exit 1; }
[[ "$(git -C "$ROOT_DIR" branch --show-current)" == main && -z "$(git -C "$ROOT_DIR" status --porcelain)" ]] || { printf '%s\n' 'MIGRATION_SAFE_OPENCLAW=BLOCKED repository must be clean main.'; exit 1; }
[[ "$(git -C "$ROOT_DIR" rev-parse HEAD)" == "$(git -C "$ROOT_DIR" rev-parse origin/main)" ]] || { printf '%s\n' 'MIGRATION_SAFE_OPENCLAW=BLOCKED repository must match origin/main.'; exit 1; }

export STORAGE_PREFLIGHT_LIB_ONLY=1
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/storage-preflight.sh"
storage_host_volume_check "$EXTERNAL_STORAGE_ROOT" "$EXTERNAL_STORAGE_VOLUME_UUID"
storage_read_sentinel "$EXTERNAL_STORAGE_ROOT" "$EXTERNAL_STORAGE_SENTINEL_ID"
((STORAGE_FAILURES == 0)) || { printf '%s\n' 'MIGRATION_SAFE_OPENCLAW=BLOCKED Avalon identity/sentinel check failed.'; exit 1; }

openclaw_state="$("$ORB_BIN" -m "$MACHINE" -u root docker inspect --format '{{.State.Status}}' openclaw 2>/dev/null || printf absent)"
[[ "$openclaw_state" != running ]] || { printf '%s\n' 'MIGRATION_SAFE_OPENCLAW=BLOCKED an OpenClaw container is already running.'; exit 1; }
radar_state="$("$ORB_BIN" -m "$MACHINE" -u root docker inspect --format '{{.State.Status}}' product-radar 2>/dev/null || printf absent)"
[[ "$radar_state" != running ]] || { printf '%s\n' 'MIGRATION_SAFE_OPENCLAW=BLOCKED Product Radar must remain stopped.'; exit 1; }
ingress="$("$ORB_BIN" -m "$MACHINE" -u root docker ps --format '{{.Names}} {{.Image}}' | awk -f "$ROOT_DIR/scripts/openclaw-ingress-count.awk")"
[[ "$ingress" == 0 ]] || { printf '%s\n' 'MIGRATION_SAFE_OPENCLAW=BLOCKED a destination ingress container is running.'; exit 1; }
"$ORB_BIN" -m "$MACHINE" -u root test -f "$APP_DIR/docker-compose.yml" && "$ORB_BIN" -m "$MACHINE" -u root test ! -L "$APP_DIR/docker-compose.yml" || { printf '%s\n' 'MIGRATION_SAFE_OPENCLAW=BLOCKED canonical OpenClaw Compose definition is missing or symlinked.'; exit 1; }
"$ORB_BIN" -m "$MACHINE" -u root test -f "$DATA_ROOT/config/openclaw.json" && "$ORB_BIN" -m "$MACHINE" -u root test ! -L "$DATA_ROOT/config/openclaw.json" || { printf '%s\n' 'MIGRATION_SAFE_OPENCLAW=BLOCKED canonical restored config is missing or symlinked.'; exit 1; }

[[ "$MODE" != apply || "$APPROVAL" == APPROVE_AVALON_MOVE_1_4_8 ]] || { printf '%s\n' 'Apply requires exact APPROVE_AVALON_MOVE_1_4_8.' >&2; exit 2; }

helper_payload="$(base64 < "$ROOT_DIR/scripts/openclaw_migration_safe_config.py" | tr -d '\r\n')"
remote_code="import base64; ns={'__name__':'__main__'}; exec(compile(base64.b64decode('${helper_payload}'), 'openclaw_migration_safe_config.py', 'exec'), ns)"
overlay_config="/run/openclaw-migration-safe/openclaw.json"
if [[ "$MODE" == apply ]]; then
  "$ORB_BIN" -m "$MACHINE" -u root python3 -c "$remote_code" --source "$DATA_ROOT/config/openclaw.json" --output "$overlay_config" --apply --approve-avalon-move "$APPROVAL"
else
  "$ORB_BIN" -m "$MACHINE" -u root python3 -c "$remote_code" --source "$DATA_ROOT/config/openclaw.json" --output "$overlay_config"
fi

compose_overlay_source="$ROOT_DIR/infra/docker/casaos/openclaw/docker-compose.migration-safe.example.yml"
compose_payload="$(base64 < "$compose_overlay_source" | tr -d '\r\n')"
temporary_compose_overlay="/run/openclaw-migration-safe/docker-compose.migration-safe.yml"
write_compose_overlay() {
  local destination="$1"
  "$ORB_BIN" -m "$MACHINE" -u root python3 - "$destination" "$compose_payload" <<'PY'
import base64, os, sys
from pathlib import Path
target = Path(sys.argv[1])
payload = base64.b64decode(sys.argv[2])
if target.is_symlink() or target.parent.is_symlink(): raise SystemExit('migration Compose overlay path is symlinked')
target.parent.mkdir(parents=True, exist_ok=True)
if target.exists():
    if not target.is_file() or target.read_bytes() != payload:
        raise SystemExit('migration Compose overlay already exists with different content')
else:
    temporary = target.with_name('.' + target.name + '.operation-skuld-tmp')
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'wb') as stream:
        stream.write(payload); stream.flush(); os.fsync(stream.fileno())
    os.chmod(temporary, 0o644)
    os.replace(temporary, target)
os.chmod(target, 0o644)
print('MIGRATION_SAFE_COMPOSE_OVERLAY=ready')
PY
}
write_compose_overlay "$temporary_compose_overlay"

preflight_payload="$(base64 < "$ROOT_DIR/scripts/openclaw_migration_safe_preflight.py" | tr -d '\r\n')"
preflight_code="import base64; ns={'__name__':'openclaw_migration_safe_preflight'}; exec(compile(base64.b64decode('${preflight_payload}'), 'openclaw_migration_safe_preflight.py', 'exec'), ns); raise SystemExit(ns['main']())"
"$ORB_BIN" -m "$MACHINE" -u root python3 -c "$preflight_code" "$APP_DIR" "$temporary_compose_overlay"

if [[ "$MODE" == plan ]]; then
  printf 'MIGRATION_SAFE_OPENCLAW=PLAN destination=%s sourceConfigPreserved=yes ownerIngress=disabled publicIngress=disabled ownerDelivery=disabled\n' "$MACHINE"
  exit 0
fi

write_compose_overlay "$APP_DIR/docker-compose.migration-safe.yml"
cd "$APP_DIR"
"$ORB_BIN" -m "$MACHINE" -u root bash -lc "cd '$APP_DIR' && docker compose -f docker-compose.yml -f docker-compose.migration-safe.yml up -d --no-build"

healthy=0
for _ in {1..30}; do
  status="$("$ORB_BIN" -m "$MACHINE" -u root docker inspect --format '{{.State.Health.Status}}' openclaw 2>/dev/null || true)"
  [[ "$status" == healthy ]] && { healthy=1; break; }
  sleep 2
done
((healthy == 1)) || { printf '%s\n' 'MIGRATION_SAFE_OPENCLAW=BLOCKED health did not pass; container left in migration-safe mode for inspection.'; exit 1; }
"$ORB_BIN" -m "$MACHINE" -u root docker exec openclaw node -e 'const fs=require("fs"); const c=JSON.parse(fs.readFileSync(process.env.OPENCLAW_CONFIG_PATH,"utf8")); if(c.gateway?.bind!=="loopback" || Object.values(c.channels||{}).some(x=>x.enabled!==false) || c.plugins?.entries?.amadeus?.config?.ownerNotificationDeliveryEnabled!==false) process.exit(1);'
"$ORB_BIN" -m "$MACHINE" -u root docker exec openclaw node -e 'fetch("http://9router:20128/v1/models").then(r=>process.exit((r.status===200||r.status===401)?0:1)).catch(()=>process.exit(1))'
"$ORB_BIN" -m "$MACHINE" -u root docker exec openclaw node dist/index.js plugins inspect amadeus --runtime --json >/dev/null
printf '%s\n' 'MIGRATION_SAFE_OPENCLAW=running' 'TELEGRAM_INGRESS=disabled' 'WHATSAPP_INGRESS=disabled' 'PUBLIC_INGRESS=disabled' 'OWNER_NOTIFICATION_DELIVERY=disabled' 'OPENCLAW_STATE=restored-canonical'
