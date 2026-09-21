#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT_DIR"
MACHINE="$ORBSTACK_MACHINE"
MODE='plan'

while (($#)); do
  case "$1" in
    --plan|--apply) MODE="${1#--}" ;;
    --help|-h) printf '%s\n' 'Usage: scripts/externalize-casaos-secrets.sh [--plan|--apply]'; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

command -v orb >/dev/null 2>&1 || { printf '%s\n' 'OrbStack CLI not found' >&2; exit 1; }

orb -m "$MACHINE" -u root python3 - \
  /var/lib/casaos/apps/9router/docker-compose.yml "$NINE_ROUTER_ENV_FILE" \
  /var/lib/casaos/apps/immich/docker-compose.yml "$IMMICH_ENV_FILE" "$MODE" <<'PY'
import os
import re
import sys
from pathlib import Path

nine_compose, nine_env, immich_compose, immich_env, mode = sys.argv[1:]
specs = [
    (Path(nine_compose), Path(nine_env), ['API_KEY_SECRET', 'JWT_SECRET', 'INITIAL_PASSWORD', 'MACHINE_ID_SALT'], ['9router']),
    (Path(immich_compose), Path(immich_env), ['POSTGRES_PASSWORD', 'DB_PASSWORD'], ['database', 'immich-machine-learning', 'immich-server']),
]

def service_bounds(lines, names):
    starts = {}
    for index, line in enumerate(lines):
        match = re.fullmatch(r'(\s+)([A-Za-z0-9_.-]+):\s*', line.rstrip('\n'))
        if match and match.group(2) in names:
            indent = len(match.group(1).replace('\t', '    '))
            if starts and indent != next(iter(starts.values()))[2]:
                continue
            starts[match.group(2)] = (index, match.group(2), indent)
    bounds = {}
    ordered = sorted(starts.items(), key=lambda item: item[1][0])
    service_indent = next(iter(starts.values()))[2] if starts else 2
    for position, (name, details) in enumerate(ordered):
        start = details[0]
        end = ordered[position + 1][1][0] if position + 1 < len(ordered) else len(lines)
        bounds[name] = (start, end)
    return bounds, service_indent

def value_from_line(line, key):
    match = re.match(rf'^\s+{re.escape(key)}:\s*(.*)$', line.rstrip('\n'))
    if not match:
        return None
    value = match.group(1).strip()
    if value.startswith('$' + '{') or not value:
        return None
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        value = value[1:-1]
    return value

for compose_path, env_path, keys, service_names in specs:
    lines = compose_path.read_text(encoding='utf-8').splitlines(keepends=True)
    found = {}
    for line in lines:
        for key in keys:
            value = value_from_line(line, key)
            if value is not None:
                found.setdefault(key, value)
    if mode == 'plan':
        print(f'PLAN|{compose_path}|inlineSecretKeys={len(found)}|externalEnv={env_path}|exists={env_path.is_file()}')
        continue
    if not found and not env_path.is_file():
        raise SystemExit(f'no inline secrets and no external env file: {compose_path}')
    existing = {}
    if env_path.is_file():
        for line in env_path.read_text(encoding='utf-8').splitlines():
            if '=' in line and not line.lstrip().startswith('#'):
                key, value = line.split('=', 1)
                existing[key.strip()] = value
    values = dict(existing)
    for key, value in found.items():
        if key in existing and existing[key] != value:
            raise SystemExit(f'external env conflicts with inline secret key: {key}')
        values[key] = value
    missing = [key for key in keys if key not in values]
    if missing:
        raise SystemExit(f'missing required secret keys in {compose_path}: {",".join(missing)}')
    env_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_env = Path(str(env_path) + '.skuld-tmp')
    temporary_env.write_text(''.join(f'{key}={values[key]}\n' for key in keys), encoding='utf-8')
    os.chmod(temporary_env, 0o600)
    temporary_env.replace(env_path)
    _, service_indent = service_bounds(lines, service_names)
    removals = []
    for line_index, line in enumerate(lines):
        if any(value_from_line(line, key) is not None for key in keys):
            removals.append(line_index)
    for line_index in reversed(removals):
        del lines[line_index]
    bounds, service_indent = service_bounds(lines, service_names)
    for name in reversed(service_names):
        if name not in bounds:
            raise SystemExit(f'service is missing from compose: {name}')
        start, end = bounds[name]
        block = lines[start:end]
        if any(line.strip() == 'env_file:' for line in block):
            continue
        property_indent = ' ' * (service_indent + 4)
        list_indent = ' ' * (service_indent + 8)
        insertion = next((index for index in range(start + 1, end) if lines[index].startswith(property_indent + 'restart:')), start)
        lines[insertion:insertion] = [
            f'{property_indent}env_file:\n',
            f'{list_indent}- {env_path}\n',
        ]
    temporary_compose = Path(str(compose_path) + '.skuld-tmp')
    temporary_compose.write_text(''.join(lines), encoding='utf-8')
    os.chmod(temporary_compose, 0o600)
    temporary_compose.replace(compose_path)
    print(f'APPLY|{compose_path}|externalEnv={env_path}|movedSecretKeys={len(found)}')
PY

if [[ "$MODE" == apply ]]; then
  orb -m "$MACHINE" -u root docker compose --project-directory /var/lib/casaos/apps/9router -f /var/lib/casaos/apps/9router/docker-compose.yml config --quiet
  orb -m "$MACHINE" -u root docker compose --project-directory /var/lib/casaos/apps/9router -f /var/lib/casaos/apps/9router/docker-compose.yml up -d --no-build >/dev/null
  orb -m "$MACHINE" -u root docker compose --project-directory /var/lib/casaos/apps/immich -f /var/lib/casaos/apps/immich/docker-compose.yml config --quiet
  orb -m "$MACHINE" -u root docker compose --project-directory /var/lib/casaos/apps/immich -f /var/lib/casaos/apps/immich/docker-compose.yml up -d --no-build >/dev/null
  printf '%s\n' 'CASAOS_SECRET_BOUNDARY=applied'
fi
