#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${SKULD_ROOT_DIR:-$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT_DIR"

STATE_FILE="${STORAGE_HEALTH_STATE_FILE:-$OPENCLAW_DATA_DIR/data/storage-health-state.json}"
facts_json() {
  python3 - "$@" <<'PY'
import json
import sys
facts = []
for raw in sys.argv[1:]:
    label, value = raw.split('=', 1)
    facts.append({'label': label, 'value': value})
print(json.dumps(facts, ensure_ascii=False))
PY
}

write_state() {
  local status="$1"
  orb -m "$ORBSTACK_MACHINE" -u root python3 - "$STATE_FILE" "$status" <<'PY'
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

path, status = sys.argv[1:]
path = Path(path)
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps({'status': status, 'updatedAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')}) + '\n')
path.chmod(0o600)
PY
}

previous_status="$(orb -m "$ORBSTACK_MACHINE" -u root python3 - "$STATE_FILE" <<'PY'
import json
import sys
from pathlib import Path
try:
    print(json.loads(Path(sys.argv[1]).read_text()).get('status', ''))
except (FileNotFoundError, json.JSONDecodeError):
    print('')
PY
)"

if ! bash "$ROOT_DIR/scripts/storage-preflight.sh" --status --allow-existing --source /DATA/Gallery/immich --destination "$IMMICH_MEDIA_ROOT"; then
  write_state missing || true
  bash "$ROOT_DIR/scripts/notify-owner.sh" --remote-machine "$ORBSTACK_MACHINE" --outbox-dir "$OPENCLAW_DATA_DIR/notifications" \
    --event-key "external-storage-missing:$(date -u +%F)" --source external-storage --headline 'IBN 5100 · 关键存储节点失联' \
    --summary '8TB 外接存储身份或挂载校验失败；未执行迁移、清理或删除。' \
    --facts-json "$(facts_json storage_root="$EXTERNAL_STORAGE_ROOT" immich_media_root="$IMMICH_MEDIA_ROOT" previous_status="${previous_status:-unknown}")" \
    --severity error --significance critical --theme ibn_5100 || true
  exit 1
fi

if [[ "$previous_status" == missing ]]; then
  bash "$ROOT_DIR/scripts/notify-owner.sh" --remote-machine "$ORBSTACK_MACHINE" --outbox-dir "$OPENCLAW_DATA_DIR/notifications" \
    --event-key "external-storage-recovered:$(date -u +%F)" --source external-storage --headline '8TB 外接存储已恢复 · 世界线收束' \
    --summary '外置存储身份、sentinel、可写性和 Immich media boundary 已恢复；未执行 source reclaim。' \
    --facts-json "$(facts_json storage_root="$EXTERNAL_STORAGE_ROOT" immich_media_root="$IMMICH_MEDIA_ROOT")" \
    --severity success --significance notable --theme worldline_convergence --worldline-closing || true
fi

df_line() { df -Pk "$1" 2>/dev/null | awk 'NR == 2 {print $2 " " $3 " " $4 " " $5}'; }
printf 'MAC_INTERNAL_DF=%s\n' "$(df_line /)"
printf 'EXTERNAL_DF=%s\n' "$(df_line "$EXTERNAL_STORAGE_ROOT")"
printf 'GUEST_DF_BEGIN\n'
orb -m "$ORBSTACK_MACHINE" -u root df -Pk / /DATA "$EXTERNAL_STORAGE_ROOT" 2>/dev/null || true
printf 'DOCKER_STORAGE_DF_BEGIN\n'
orb -m "$ORBSTACK_MACHINE" -u root docker system df || true
printf 'LOG_POLICY_AUDIT_BEGIN\n'
log_policy_status='passed'
if ! bash "$ROOT_DIR/scripts/apply-docker-log-policy.sh" --audit; then
  log_policy_status='violation'
  bash "$ROOT_DIR/scripts/notify-owner.sh" --remote-machine "$ORBSTACK_MACHINE" --outbox-dir "$OPENCLAW_DATA_DIR/notifications" \
    --event-key "log-policy-violation:$(date -u +%F)" --source storage-runtime --headline '世界线偏移 · 受管日志策略存在越界' \
    --summary '受管容器仍存在未 bounded 的 stdout/stderr policy；未知服务仅报告，不执行通用删除。' \
    --severity warning --significance major --theme worldline_divergence || true
fi
bash "$ROOT_DIR/scripts/storage-maintenance.sh" --status || true
write_state healthy || true
printf 'LOG_POLICY_STATUS=%s\n' "$log_policy_status"
printf '%s\n' 'STORAGE_HEALTH=passed'
