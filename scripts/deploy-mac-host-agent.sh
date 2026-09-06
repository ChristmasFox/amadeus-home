#!/usr/bin/env bash
set -euo pipefail

MACHINE="${ORBSTACK_MACHINE:-ubuntu}"
COMPOSE_FILE="${HOMEHUB_COMPOSE_FILE:-/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml}"
TOKEN_FILE="${MAC_HOST_AGENT_TOKEN_FILE:-/DATA/AppData/pubg-query-engine-v3/secrets/mac-host-agent-token}"
APPLY=0

usage() {
  cat <<'USAGE'
Usage: scripts/deploy-mac-host-agent.sh [--dry-run] [--apply]

Patch the canonical CasaOS HomeHub compose with the external macOS HostAgent URL,
read-only token mount and token-file environment. Default is dry-run; --apply is
required before the remote compose is changed or recreated.
USAGE
}

while (($#)); do
  case "$1" in
    --dry-run) APPLY=0 ;;
    --apply) APPLY=1 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

printf 'MODE=%s\n' "$([[ $APPLY -eq 1 ]] && printf apply || printf dry-run)"
printf 'MACHINE=%s\n' "$MACHINE"
printf 'COMPOSE_FILE=%s\n' "$COMPOSE_FILE"
printf 'TOKEN_FILE=%s\n' "$TOKEN_FILE"
printf '%s\n' 'PLAN=external MAC_HOST_AGENT_URL + /run/secrets/mac_host_agent_token, then compose up -d --no-build.'

if ((APPLY == 0)); then
  exit 0
fi

orb -m "$MACHINE" -u root bash -lc "
  set -euo pipefail
  compose_file=$(printf '%q' "$COMPOSE_FILE")
  token_file=$(printf '%q' "$TOKEN_FILE")
  test -f \"\$compose_file\"
  test -f \"\$token_file\"
  test -s \"\$token_file\"
  backup=\"\${compose_file}.codex-backup.\$(date +%Y%m%d-%H%M%S)\"
  python3 - \"\$compose_file\" \"\$backup\" <<'PY'
from pathlib import Path
import shutil
import sys

compose = Path(sys.argv[1])
backup = Path(sys.argv[2])
text = compose.read_text()
original = text

env_url = '      MAC_HOST_AGENT_URL: ${MAC_HOST_AGENT_URL:-http://host.docker.internal:49152}\n'
env_file = '      MAC_HOST_AGENT_TOKEN_FILE: /run/secrets/mac_host_agent_token\n'
if 'MAC_HOST_AGENT_URL:' not in text:
    marker = '      KOOK_ADMIN_USER_ID: ${KOOK_ADMIN_USER_ID:-}\n'
    if marker not in text:
        marker = '    environment:\n'
        if marker not in text:
            raise SystemExit('compose environment block not found')
        text = text.replace(marker, marker + env_url + env_file, 1)
    else:
        text = text.replace(marker, marker + env_url + env_file, 1)
elif 'MAC_HOST_AGENT_TOKEN_FILE:' not in text:
    marker = '      MAC_HOST_AGENT_URL:'
    line_start = text.find(marker)
    line_end = text.find('\n', line_start)
    text = text[:line_end + 1] + env_file + text[line_end + 1:]

mount = '      - ${MAC_HOST_AGENT_TOKEN_FILE:-/DATA/AppData/pubg-query-engine-v3/secrets/mac-host-agent-token}:/run/secrets/mac_host_agent_token:ro\n'
if '/run/secrets/mac_host_agent_token:ro' not in text:
    marker = '    volumes:\n'
    if marker not in text:
        raise SystemExit('compose volumes block not found')
    text = text.replace(marker, marker + mount, 1)

if text != original:
    shutil.copy2(compose, backup)
    compose.write_text(text)
    print('ROLLBACK_COMPOSE=' + str(backup))
else:
    print('COMPOSE_ALREADY_CONFIGURED=true')
PY
  cd \"\$(dirname \"\$compose_file\")\"
  docker compose -f \"\$compose_file\" config >/dev/null
  docker compose -f \"\$compose_file\" up -d --no-build
  docker inspect pubg-query-engine-v3 --format '{{json .Mounts}}' | grep -F '/run/secrets/mac_host_agent_token' >/dev/null
  docker inspect pubg-query-engine-v3 --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -Fx 'MAC_HOST_AGENT_TOKEN_FILE=/run/secrets/mac_host_agent_token' >/dev/null
  echo 'MacHostAgent compose deployment passed.'
"
