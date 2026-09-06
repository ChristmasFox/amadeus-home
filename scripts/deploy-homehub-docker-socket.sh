#!/usr/bin/env bash
set -euo pipefail

MACHINE="${ORBSTACK_MACHINE:-ubuntu}"
CONTAINER="${HOMEHUB_RUNTIME_CONTAINER:-pubg-query-engine-v3}"
COMPOSE_FILE="${HOMEHUB_COMPOSE_FILE:-/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml}"
APPLY=0

usage() {
  cat <<'USAGE'
Usage: scripts/deploy-homehub-docker-socket.sh [--dry-run] [--apply]

Ensure the canonical CasaOS HomeHub compose mounts the Docker socket read-only
and grants the runtime image the socket's group. The default is a dry-run.
--apply is required before the compose file is changed or the app recreated.
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
printf 'CONTAINER=%s\n' "$CONTAINER"
printf 'COMPOSE_FILE=%s\n' "$COMPOSE_FILE"
printf '%s\n' 'PLAN=mount /var/run/docker.sock:ro, add the socket group, recreate with --no-build, verify socket and runtime client.'

if ((APPLY == 0)); then
  exit 0
fi

patch_source='''from pathlib import Path
import shutil
import stat
import sys

compose = Path(sys.argv[1])
backup_stamp = sys.argv[2]
socket_gid = sys.argv[3]
text = compose.read_text()
original = text

if "/var/run/docker.sock:/var/run/docker.sock:ro" not in text:
    marker = "    volumes:\\n"
    if marker not in text:
        raise SystemExit("compose service volumes block not found")
    text = text.replace(marker, f"      - /var/run/docker.sock:/var/run/docker.sock:ro\\n{marker}", 1)

if "    group_add:\\n" not in text:
    marker = "    restart: unless-stopped\\n"
    if marker not in text:
        raise SystemExit("compose service restart block not found")
    text = text.replace(marker, f"{marker}    group_add:\\n      - \\\"{socket_gid}\\\"\\n", 1)
else:
    lines = text.splitlines()
    for index, line in enumerate(lines):
        if line == "    group_add:":
            if index + 1 >= len(lines) or lines[index + 1].strip() != socket_gid:
                raise SystemExit("compose already has group_add with an unexpected value; refusing to overwrite")
            break

if text != original:
    backup = compose.with_name(compose.name + ".codex-backup." + backup_stamp)
    shutil.copy2(compose, backup)
    compose.write_text(text)
    print("ROLLBACK_COMPOSE=" + str(backup))
else:
    print("COMPOSE_ALREADY_CONFIGURED=true")
'''
encoded="$(printf '%s' "$patch_source" | base64 | tr -d '\n')"
remote_compose="$(printf '%q' "$COMPOSE_FILE")"
remote_container="$(printf '%q' "$CONTAINER")"
orb -m "$MACHINE" -u root bash -lc "
  set -euo pipefail
  compose_file=$remote_compose
  container=$remote_container
  test -f \"\$compose_file\"
  test -S /var/run/docker.sock
  socket_gid=\$(stat -c '%g' /var/run/docker.sock)
  echo '$encoded' | base64 -d >/tmp/homehub-docker-socket-patch.py
  python3 /tmp/homehub-docker-socket-patch.py \"\$compose_file\" \"\$(date +%Y%m%d-%H%M%S)\" \"\$socket_gid\"
  rm -f /tmp/homehub-docker-socket-patch.py
  cd \"\$(dirname \"\$compose_file\")\"
  docker compose -f \"\$compose_file\" config >/dev/null
  docker compose -f \"\$compose_file\" up -d --no-build
  docker inspect \"\$container\" --format '{{json .Mounts}}' | grep -F '/var/run/docker.sock' >/dev/null
  docker exec \"\$container\" sh -c 'test -S /var/run/docker.sock'
  echo 'Docker socket compose deployment passed.'
"
