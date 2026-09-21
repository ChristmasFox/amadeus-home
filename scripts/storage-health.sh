#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${SKULD_ROOT_DIR:-$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT_DIR"
MACHINE="${ORBSTACK_MACHINE:-ubuntu}"
TEST_MODE="${STORAGE_HEALTH_TEST_MODE:-0}"
STATE_FILE="${STORAGE_HEALTH_STATE_FILE:-$OPENCLAW_DATA_DIR/data/storage-health-state.json}"
HISTORY_FILE="${STORAGE_GROWTH_HISTORY_FILE:-$OPENCLAW_DATA_DIR/data/storage-growth-history.jsonl}"

facts_json() {
  python3 - "$@" <<'PY'
import json
import sys
facts=[]
for raw in sys.argv[1:]:
    label, value = raw.split('=', 1)
    facts.append({'label': label, 'value': value})
print(json.dumps(facts, ensure_ascii=False))
PY
}

default_df() {
  local path="$1"
  df -Pk "$path" 2>/dev/null | awk 'NR == 2 {print $2 " " $3 " " $4}'
}
parse_df() {
  local label="$1" raw="$2"
  if [[ "$raw" =~ ^([0-9]+)[[:space:]]+([0-9]+)[[:space:]]+([0-9]+)$ ]]; then
    python3 - "$label" "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}" <<'PY'
import json
import sys
label, total_kib, used_kib, free_kib = sys.argv[1:]
total, used, free = (int(x) * 1024 for x in (total_kib, used_kib, free_kib))
used_percent = round((used / total * 100) if total else 100, 2)
free_percent = round((free / total * 100) if total else 0, 2)
print(json.dumps({'id': label, 'totalBytes': total, 'usedBytes': used, 'freeBytes': free, 'usedPercent': used_percent, 'freePercent': free_percent}))
PY
  fi
}

if ((TEST_MODE)); then
  TARGETS_FILE="${STORAGE_HEALTH_TARGETS_FILE:?STORAGE_HEALTH_TARGETS_FILE is required in test mode}"
  [[ -s "$TARGETS_FILE" ]] || { printf '%s\n' 'storage target fixture is empty' >&2; exit 2; }
  targets_json="$(cat "$TARGETS_FILE")"
  external_identity="${STORAGE_EXTERNAL_IDENTITY_STATUS:-healthy}"
  log_policy_status="${STORAGE_LOG_POLICY_STATUS:-healthy}"
  previous_status="${STORAGE_PREVIOUS_STATUS:-healthy}"
  history_stats="${STORAGE_HISTORY_STATS_JSON:-}"
else
  local_root="$(parse_df mac_internal_root "$(default_df /)")"
  external_root="$(parse_df external_storage "$(default_df "$EXTERNAL_STORAGE_ROOT")")"
  guest_lines="$(orb -m "$MACHINE" -u root df -Pk / /DATA /Volumes/Avalon 2>/dev/null || true)"
  guest_root_raw="$(printf '%s\n' "$guest_lines" | awk '$6=="/" {print $2 " " $3 " " $4; exit}')"
  guest_data_raw="$(printf '%s\n' "$guest_lines" | awk '$6=="/DATA" {print $2 " " $3 " " $4; exit}')"
  guest_external_raw="$(printf '%s\n' "$guest_lines" | awk '$6=="/Volumes/Avalon" {print $2 " " $3 " " $4; exit}')"
  guest_root="$(parse_df guest_root "$guest_root_raw")"
  guest_data="$(parse_df guest_data "${guest_data_raw:-$guest_root_raw}")"
  guest_external="$(parse_df guest_external_storage "$guest_external_raw")"
  targets_json="$(python3 - "$local_root" "$external_root" "$guest_root" "$guest_data" "$guest_external" <<'PY'
import json, sys
targets=[json.loads(x) for x in sys.argv[1:] if x]
print(json.dumps(targets))
PY
)"
  if bash "$ROOT_DIR/scripts/storage-preflight.sh" --status --allow-existing --source /DATA/Gallery/immich --destination "$IMMICH_MEDIA_ROOT" >/dev/null 2>&1; then
    external_identity=healthy
  else
    external_identity=missing
  fi
  history_stats="$(python3 - "$IMMICH_MEDIA_ROOT" "$EXTERNAL_STORAGE_ROOT" <<'PY'
import json, subprocess, sys
paths = {'immichMediaBytes': sys.argv[1], 'mediaBytes': sys.argv[2] + '/media', 'downloadsBytes': sys.argv[2] + '/downloads', 'dockerBytes': '/var/lib/docker'}
result={}
for key, path in paths.items():
    try:
        raw=subprocess.check_output(['orb','-m', '${MACHINE}', '-u', 'root', 'du', '-sx', '--apparent-size', '--block-size=1', path], text=True, stderr=subprocess.DEVNULL).split()[0]
        result[key]=int(raw)
    except Exception:
        result[key]=None
print(json.dumps(result))
PY
)"
  log_policy_status=healthy
  if ! bash "$ROOT_DIR/scripts/apply-docker-log-policy.sh" --audit >/dev/null 2>&1; then log_policy_status=policy_violation; fi
  previous_status="$(orb -m "$MACHINE" -u root python3 - "$STATE_FILE" <<'PY'
import json, sys
from pathlib import Path
try: print(json.loads(Path(sys.argv[1]).read_text()).get('status',''))
except (FileNotFoundError, json.JSONDecodeError): print('')
PY
)"
fi

state_json="$(python3 - "$targets_json" "$external_identity" "$log_policy_status" "$previous_status" "$STORAGE_WARN_FREE_PERCENT" "$STORAGE_CRITICAL_FREE_PERCENT" "${STORAGE_WARN_FREE_BYTES:-}" "${STORAGE_CRITICAL_FREE_BYTES:-}" "$STORAGE_GROWTH_HISTORY_RETENTION_DAYS" "$history_stats" <<'PY'
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

targets, identity, log_policy, previous, warn_pct, critical_pct, warn_bytes, critical_bytes, retention, history_raw = sys.argv[1:]
targets = json.loads(targets)
history = json.loads(history_raw or "{}")
warn_pct = float(warn_pct)
critical_pct = float(critical_pct)
warn_bytes = int(warn_bytes) if warn_bytes else None
critical_bytes = int(critical_bytes) if critical_bytes else None

def capacity_status(value):
    if not value: return 'missing'
    free_pct, free_bytes = float(value.get('freePercent', 0)), int(value.get('freeBytes', 0))
    if critical_bytes is not None and free_bytes <= critical_bytes: return 'critical'
    if free_pct <= critical_pct: return 'critical'
    if warn_bytes is not None and free_bytes <= warn_bytes: return 'warning'
    if free_pct <= warn_pct: return 'warning'
    return 'healthy'

target_map = {item['id']: item for item in targets}
components = {
    'externalStorageIdentity': identity if identity in {'healthy','missing','policy_violation'} else 'policy_violation',
    'externalCapacity': capacity_status(target_map.get('external_storage')) if identity != 'missing' else 'missing',
    'internalCapacity': capacity_status(target_map.get('mac_internal_root')),
    'guestCapacity': capacity_status(target_map.get('guest_root')),
    'guestDataCapacity': capacity_status(target_map.get('guest_data')),
    'dockerLogPolicy': log_policy if log_policy in {'healthy','policy_violation'} else 'policy_violation',
}
priority = {'healthy': 0, 'policy_violation': 1, 'warning': 2, 'critical': 3, 'missing': 4}
status = max(components.values(), key=lambda x: priority.get(x, 4))
now = datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
state = {
    'schemaVersion': 2,
    'status': status,
    'previousStatus': previous or None,
    'transition': bool(previous and previous != status),
    'components': components,
    'targets': targets,
    'updatedAt': now,
    'thresholds': {
        'warnFreePercent': warn_pct,
        'criticalFreePercent': critical_pct,
        'warnFreeBytes': warn_bytes,
        'criticalFreeBytes': critical_bytes,
    },
    'historyRetentionDays': int(retention),
    'growth': history,
}
print(json.dumps(state, ensure_ascii=False))
PY
)"

write_state() {
  local json="$1"
  if ((TEST_MODE)); then
    mkdir -p "$(dirname -- "$STATE_FILE")"
    printf '%s\n' "$json" >"$STATE_FILE"
    chmod 600 "$STATE_FILE"
    python3 - "$HISTORY_FILE" "$json" <<'PY'
import json, sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
path, raw = Path(sys.argv[1]), sys.argv[2]
state=json.loads(raw)
rows=[]
if path.exists():
    for line in path.read_text().splitlines():
        try:
            value=json.loads(line)
            when=datetime.fromisoformat(value['timestamp'].replace('Z','+00:00'))
            if when >= datetime.now(timezone.utc)-timedelta(days=int(state.get('historyRetentionDays',90))): rows.append(value)
        except Exception: pass
row={'timestamp':state['updatedAt'],'status':state['status'],'internalFreeBytes':next((x.get('freeBytes') for x in state.get('targets',[]) if x.get('id')=='mac_internal_root'),None),'externalFreeBytes':next((x.get('freeBytes') for x in state.get('targets',[]) if x.get('id')=='external_storage'),None)}
row.update({key: state.get('growth',{}).get(key) for key in ('immichMediaBytes','mediaBytes','downloadsBytes','dockerBytes')})
rows.append(row)
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(''.join(json.dumps(value, ensure_ascii=False)+'\n' for value in rows))
path.chmod(0o600)
PY
  else
    orb -m "$MACHINE" -u root python3 - "$STATE_FILE" "$HISTORY_FILE" "$json" <<'PY'
import json, sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
state_path, history_path, state_raw = sys.argv[1:]
state = json.loads(state_raw)
for path in (Path(state_path), Path(history_path)):
    path.parent.mkdir(parents=True, exist_ok=True)
Path(state_path).write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n')
Path(state_path).chmod(0o600)
targets = {x['id']: x for x in state.get('targets', [])}
row = {
    'timestamp': state['updatedAt'],
    'internalFreeBytes': targets.get('mac_internal_root', {}).get('freeBytes'),
    'externalFreeBytes': targets.get('external_storage', {}).get('freeBytes'),
    'immichMediaBytes': state.get('growth', {}).get('immichMediaBytes'),
    'mediaBytes': state.get('growth', {}).get('mediaBytes'),
    'downloadsBytes': state.get('growth', {}).get('downloadsBytes'),
    'dockerBytes': state.get('growth', {}).get('dockerBytes'),
    'status': state['status'],
}
path = Path(history_path)
rows=[]
if path.exists():
    for line in path.read_text().splitlines():
        try:
            value=json.loads(line)
            if datetime.fromisoformat(value['timestamp'].replace('Z','+00:00')) >= datetime.now(timezone.utc)-timedelta(days=int(state.get('historyRetentionDays',90))): rows.append(value)
        except Exception: pass
rows.append(row)
path.write_text(''.join(json.dumps(x, ensure_ascii=False) + '\n' for x in rows))
path.chmod(0o600)
PY
  fi
}
write_state "$state_json"

status="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])' <<<"$state_json")"
previous="$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("previousStatus") or "")' <<<"$state_json")"
if ((TEST_MODE == 0)) && [[ -n "$previous" && "$previous" != "$status" ]]; then
  case "$status" in
    missing) headline='IBN 5100 · 关键存储节点失联'; theme=ibn_5100; severity=error; significance=critical; summary='外置存储身份或挂载校验失败；未执行迁移、清理或删除。' ;;
    warning|critical) headline='世界线偏移 · 存储容量进入压力区间'; theme=worldline_divergence; severity=warning; significance=major; summary='存储容量状态发生变化；已保留真实容量事实，未伪造 healthy。' ;;
    healthy) headline='存储状态恢复 · 世界线收束'; theme=worldline_convergence; severity=success; significance=notable; summary='存储容量与日志策略从压力或失联状态恢复。' ;;
    policy_violation) headline='世界线偏移 · 受管日志策略越界'; theme=worldline_divergence; severity=warning; significance=major; summary='受管容器日志策略发生越界；未知服务仍仅报告。' ;;
  esac
  notify_args=(--remote-machine "$MACHINE" --outbox-dir "$OPENCLAW_DATA_DIR/notifications" \
    --event-key "storage-state:$status:$(date -u +%F)" --source storage-health --headline "$headline" --summary "$summary" \
    --facts-json "$(facts_json status="$status" previous_status="$previous" external_root="$EXTERNAL_STORAGE_ROOT" state_file="$STATE_FILE")" \
    --severity "$severity" --significance "$significance" --theme "$theme")
  if [[ "$status" == healthy ]]; then notify_args+=(--worldline-closing); fi
  bash "$ROOT_DIR/scripts/notify-owner.sh" "${notify_args[@]}" || true
fi
printf 'STORAGE_STATUS=%s\n' "$status"
printf 'STORAGE_COMPONENTS=%s\n' "$(python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["components"], sort_keys=True))' <<<"$state_json")"
printf 'STORAGE_HEALTH=passed\n'
[[ "$status" != missing && "$status" != critical && "$status" != policy_violation ]]
