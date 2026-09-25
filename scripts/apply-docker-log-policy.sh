#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT_DIR"
MACHINE="$ORBSTACK_MACHINE"
MODE='audit'
FAILURES=0

while (($#)); do
  case "$1" in
    --audit|--apply|--daemon-audit|--daemon-apply) MODE="${1#--}" ;;
    --help|-h) printf '%s\n' 'Usage: scripts/apply-docker-log-policy.sh [--audit|--apply|--daemon-audit|--daemon-apply]'; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

[[ "$DOCKER_LOG_DRIVER" =~ ^[A-Za-z0-9_-]+$ ]] || { printf '%s\n' 'invalid DOCKER_LOG_DRIVER' >&2; exit 2; }
[[ "$DOCKER_LOG_MAX_SIZE" =~ ^[0-9]+[kKmMgG]?$ ]] || { printf '%s\n' 'invalid DOCKER_LOG_MAX_SIZE' >&2; exit 2; }
[[ "$DOCKER_LOG_MAX_FILE" =~ ^[0-9]+$ ]] || { printf '%s\n' 'invalid DOCKER_LOG_MAX_FILE' >&2; exit 2; }
command -v orb >/dev/null 2>&1 || { printf '%s\n' 'OrbStack CLI not found' >&2; exit 1; }

audit_container() {
  local name="$1" record driver max_size max_file log_path compose_dir size
  record="$(orb -m "$MACHINE" -u root docker inspect --format '{{.HostConfig.LogConfig.Type}}|{{index .HostConfig.LogConfig.Config "max-size"}}|{{index .HostConfig.LogConfig.Config "max-file"}}|{{.LogPath}}|{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$name" 2>/dev/null || true)"
  if [[ -z "$record" ]]; then
    printf 'FAIL  managed container is absent: %s\n' "$name"
    FAILURES=$((FAILURES + 1))
    return
  fi
  IFS='|' read -r driver max_size max_file log_path compose_dir <<<"$record"
  if [[ -n "$log_path" ]]; then
    size="$(orb -m "$MACHINE" -u root stat -c '%s' "$log_path" 2>/dev/null || printf '%s' unknown)"
  else
    size='unknown'
  fi
  printf 'LOG_AUDIT|%s|driver=%s|max-size=%s|max-file=%s|bytes=%s|compose=%s\n' "$name" "$driver" "$max_size" "$max_file" "$size" "${compose_dir:-unknown}"
  if [[ "$driver" != "$DOCKER_LOG_DRIVER" || "$max_size" != "$DOCKER_LOG_MAX_SIZE" || "$max_file" != "$DOCKER_LOG_MAX_FILE" ]]; then
    printf 'FAIL  unbounded or noncompliant managed log policy: %s\n' "$name"
    FAILURES=$((FAILURES + 1))
  else
    printf 'PASS  bounded managed log policy: %s\n' "$name"
  fi
}

audit_daemon() {
  local record driver max_size max_file
  record="$(orb -m "$MACHINE" -u root python3 - <<'PY'
import json
from pathlib import Path

path = Path('/etc/docker/daemon.json')
if not path.is_file():
    raise SystemExit('missing /etc/docker/daemon.json')
value = json.loads(path.read_text(encoding='utf-8'))
if not isinstance(value, dict):
    raise SystemExit('daemon.json must contain an object')
options = value.get('log-opts', {})
print('|'.join([
    str(value.get('log-driver', '')),
    str(options.get('max-size', '')),
    str(options.get('max-file', '')),
]))
PY
  2>/dev/null || true)"
  IFS='|' read -r driver max_size max_file <<<"$record"
  printf 'DAEMON_LOG_AUDIT|driver=%s|max-size=%s|max-file=%s\n' "$driver" "$max_size" "$max_file"
  if [[ "$driver" != "$DOCKER_LOG_DRIVER" || "$max_size" != "$DOCKER_LOG_MAX_SIZE" || "$max_file" != "$DOCKER_LOG_MAX_FILE" ]]; then
    printf '%s\n' 'FAIL  daemon default log policy is not bounded'
    FAILURES=$((FAILURES + 1))
  else
    printf '%s\n' 'PASS  daemon default log policy is bounded'
  fi
}

audit_unknown() {
  local name
  printf '%s\n' 'UNKNOWN_LOG_OWNERS=report-only'
  while IFS= read -r name; do
    [[ -n "$name" ]] || continue
    case " openclaw product-radar 9router immich-server immich-machine-learning immich-postgres immich-redis changedetection " in
      *" $name "*) ;;
      *) printf 'UNKNOWN_LOG_OWNER|%s\n' "$name" ;;
    esac
  done < <(orb -m "$MACHINE" -u root docker ps -a --format '{{.Names}}' 2>/dev/null)
  orb -m "$MACHINE" -u root bash -lc 'find /DATA/AppData -type f \( -name "*.log" -o -name "*.log.[0-9]*" \) -size +100M -print 2>/dev/null | head -50' \
    | sed 's#^#LARGE_APP_LOG_REPORT_ONLY|#' || true
}

audit() {
  audit_daemon
  for name in openclaw product-radar 9router immich-server immich-machine-learning immich-postgres immich-redis changedetection; do
    audit_container "$name"
  done
  audit_unknown
  ((FAILURES == 0))
}

apply_daemon_policy() {
  command -v orbctl >/dev/null 2>&1 || { printf '%s\n' 'OrbStack control CLI not found' >&2; return 1; }
  bash "$ROOT_DIR/scripts/storage-preflight.sh" --status --identity-only --destination "$IMMICH_MEDIA_ROOT" >/dev/null || {
    printf '%s\n' 'DAEMON_LOG_POLICY=blocked; verified external storage is unavailable' >&2
    return 1
  }
  local stamp backup_root config_path
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  backup_root="$SKULD_BACKUP_ROOT/log-policy/daemon-$stamp"
  [[ "$backup_root" == "$EXTERNAL_STORAGE_ROOT/"* ]] || { printf '%s\n' 'daemon policy backup must be on the verified external volume' >&2; return 1; }
  mkdir -p "$backup_root"
  chmod 700 "$backup_root"
  config_path='/etc/docker/daemon.json'
  orb -m "$MACHINE" -u root docker ps --format '{{.Names}}|{{.Status}}|{{.Image}}' >"$backup_root/containers.before.txt"
  orb -m "$MACHINE" -u root cat "$config_path" >"$backup_root/daemon.json.before"
  chmod 600 "$backup_root/daemon.json.before"
  orb -m "$MACHINE" -u root python3 - "$config_path" "$DOCKER_LOG_DRIVER" "$DOCKER_LOG_MAX_SIZE" "$DOCKER_LOG_MAX_FILE" <<'PY'
import json
import os
import sys
from pathlib import Path

path, driver, max_size, max_file = sys.argv[1:]
target = Path(path)
value = json.loads(target.read_text(encoding='utf-8')) if target.exists() else {}
if not isinstance(value, dict):
    raise SystemExit('daemon.json must contain an object')
value['log-driver'] = driver
value['log-opts'] = {'max-size': max_size, 'max-file': max_file}
temporary = Path(str(target) + '.skuld-tmp')
temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
os.chmod(temporary, 0o644)
temporary.replace(target)
PY
  orb -m "$MACHINE" -u root python3 -m json.tool "$config_path" >/dev/null
  if ! orbctl restart "$MACHINE"; then
    orb -m "$MACHINE" -u root cp "$backup_root/daemon.json.before" "$config_path" || true
    orbctl restart "$MACHINE" || true
    printf '%s\n' 'DAEMON_LOG_POLICY=failed; original daemon.json restore attempted' >&2
    return 1
  fi
  local ready=0 attempt
  for attempt in $(seq 1 60); do
    if orb -m "$MACHINE" -u root docker info >/dev/null 2>&1; then ready=1; break; fi
    sleep 2
  done
  ((ready)) || { printf '%s\n' 'DAEMON_LOG_POLICY=failed; Docker did not return after restart' >&2; return 1; }
  orb -m "$MACHINE" -u root cat "$config_path" >"$backup_root/daemon.json.after"
  orb -m "$MACHINE" -u root docker info --format 'LoggingDriver={{.LoggingDriver}} ServerVersion={{.ServerVersion}}' >"$backup_root/docker-info.after"
  orb -m "$MACHINE" -u root docker ps --format '{{.Names}}|{{.Status}}|{{.Image}}' >"$backup_root/containers.after.txt"
  printf 'DAEMON_LOG_POLICY_BACKUP=%s\n' "$backup_root"
  audit_daemon
  ((FAILURES == 0))
}

compose_entries() {
  printf '%s\n' \
    "openclaw|$OPENCLAW_APP_DIR/docker-compose.yml" \
    "product-radar|$RADAR_APP_DIR/docker-compose.yml" \
    "9router|/var/lib/casaos/apps/9router/docker-compose.yml" \
    "immich|/var/lib/casaos/apps/immich/docker-compose.yml" \
    "changedetection|/var/lib/casaos/apps/changedetection/docker-compose.yml"
}

apply_policy() {
  bash "$ROOT_DIR/scripts/storage-preflight.sh" --status --identity-only --destination "$IMMICH_MEDIA_ROOT" >/dev/null || {
    printf '%s\n' 'LOG_POLICY=blocked; verified external storage is unavailable' >&2
    return 1
  }
  local stamp backup_root name path backup
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  backup_root="$SKULD_BACKUP_ROOT/log-policy/$stamp"
  [[ "$backup_root" == "$EXTERNAL_STORAGE_ROOT/"* ]] || { printf '%s\n' 'log-policy backup must be on the verified external volume' >&2; return 1; }
  mkdir -p "$backup_root"
  chmod 700 "$backup_root"
  local -a compose_specs
  compose_specs=()
  while IFS= read -r entry; do
    compose_specs[${#compose_specs[@]}]="$entry"
  done < <(compose_entries)
  for entry in "${compose_specs[@]}"; do
    IFS='|' read -r name path <<<"$entry"
    if ! orb -m "$MACHINE" -u root test -f "$path"; then
      printf 'WARN  compose file absent; skipping %s: %s\n' "$name" "$path"
      continue
    fi
    backup="$backup_root/$name.before.yml"
    orb -m "$MACHINE" -u root cat "$path" >"$backup"
    chmod 600 "$backup"
    orb -m "$MACHINE" -u root python3 - "$path" "$DOCKER_LOG_DRIVER" "$DOCKER_LOG_MAX_SIZE" "$DOCKER_LOG_MAX_FILE" <<'PY'
import os
import re
import sys
from pathlib import Path

path, driver, max_size, max_file = sys.argv[1:]
lines = Path(path).read_text(encoding='utf-8').splitlines(keepends=True)
service_starts = []
in_services = False
service_indent = None
for index, line in enumerate(lines):
    stripped = line.strip()
    if stripped == 'services:':
        in_services = True
        continue
    if in_services and line.strip() and not line.startswith(' '):
        break
    if in_services:
        match = re.fullmatch(r'(\s+)[A-Za-z0-9_.-]+:\s*', line.rstrip('\n'))
        if match:
            indent = len(match.group(1).replace('\t', '    '))
            if service_indent is None:
                service_indent = indent
            if indent == service_indent:
                service_starts.append(index)
if not service_starts:
    raise SystemExit(f'no services found in {path}')
changed = 0
for position in reversed(range(len(service_starts))):
    start = service_starts[position]
    end = service_starts[position + 1] if position + 1 < len(service_starts) else len(lines)
    block = lines[start:end]
    property_indent = next(
        (match.group(1) for line in block
         for match in [re.match(r'^(\s+)(?:image|container_name):', line)]
         if match),
        None,
    )
    if property_indent is None:
        continue
    if any(re.match(r'^\s*logging\s*:', line) for line in block):
        continue
    list_indent = ' ' * (len(property_indent.replace('\t', '    ')) + 2)
    insertion = next((index for index in range(start + 1, end) if lines[index].startswith(property_indent + 'restart:')), start)
    payload = [
        f'{property_indent}logging:\n',
        f'{list_indent}driver: {driver}\n',
        f'{list_indent}options:\n',
        f'{list_indent}  max-size: "{max_size}"\n',
        f'{list_indent}  max-file: "{max_file}"\n',
    ]
    lines[insertion:insertion] = payload
    changed += 1
temporary = Path(str(path) + '.skuld-tmp')
temporary.write_text(''.join(lines), encoding='utf-8')
os.chmod(temporary, 0o644)
temporary.replace(path)
print(f'LOG_POLICY_SERVICES_UPDATED={changed}')
PY
    orb -m "$MACHINE" -u root docker compose --project-directory "$(dirname "$path")" -f "$path" config --quiet
    orb -m "$MACHINE" -u root docker compose --project-directory "$(dirname "$path")" -f "$path" up -d --no-build >/dev/null
  done
  printf 'LOG_POLICY_BACKUP=%s\n' "$backup_root"
  audit
}

if [[ "$MODE" == daemon-apply ]]; then
  apply_daemon_policy
elif [[ "$MODE" == daemon-audit ]]; then
  audit_daemon
  ((FAILURES == 0))
elif [[ "$MODE" == apply ]]; then
  apply_policy
else
  audit
fi
