#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT_DIR"
SOURCE_MACHINE="${ORBSTACK_MACHINE:-ubuntu}"

helper_payload="$(base64 < "$ROOT_DIR/scripts/openclaw_continuity.py" | tr -d '\r\n')"
remote_helper_code="import base64; ns={'__name__':'__main__'}; exec(compile(base64.b64decode('${helper_payload}'), 'openclaw_continuity.py', 'exec'), ns)"
source_containers="$(orb -m "$SOURCE_MACHINE" -u root docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null | awk 'tolower($0) ~ /openclaw/ {n++} END {print n+0}')" || source_containers=-1
source_process_probe="$(orb -m "$SOURCE_MACHINE" -u root python3 -c "$remote_helper_code" process-probe 2>/dev/null || true)"
source_processes="$(printf '%s\n' "$source_process_probe" | sed -n 's/^OPENCLAW_PROCESS_COUNT=//p' | tail -n 1)"
[[ "$source_processes" =~ ^[0-9]+$ ]] || source_processes=-1

probe_payload="$(base64 < "$ROOT_DIR/scripts/openclaw_runtime_probe.py" | tr -d '\r\n')"
destination_code="import base64; exec(compile(base64.b64decode(\"${probe_payload}\"), \"openclaw_runtime_probe.py\", \"exec\"), {\"__name__\":\"__main__\"})"
destination_command="/usr/local/bin/orb -m nyannyan -u root python3 -c '$destination_code'"
destination_json="$(ssh -o BatchMode=yes amadeus-m204 "$destination_command" 2>/dev/null || true)"

exec python3 "$ROOT_DIR/scripts/openclaw_unique_runtime_gate.py" \
  --source-containers "$source_containers" \
  --source-processes "$source_processes" \
  --destination-json "$destination_json"
