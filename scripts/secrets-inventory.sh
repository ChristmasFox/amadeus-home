#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${SKULD_ROOT_DIR:-$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT_DIR"
MACHINE="${ORBSTACK_MACHINE:-ubuntu}"
TEST_MODE="${SECRETS_INVENTORY_TEST_MODE:-0}"
BASE="${SECRET_INVENTORY_ROOT:-}"
FAILURES=0

pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAILURES=$((FAILURES + 1)); }

stat_mode() {
  local path="$1"
  if ((TEST_MODE)); then
    stat -f '%Lp' "$path" 2>/dev/null || stat -c '%a' "$path"
  else
    orb -m "$MACHINE" -u root stat -c '%a' "$path"
  fi
}
file_exists() {
  local path="$1"
  if ((TEST_MODE)); then [[ -s "$path" ]]
  else orb -m "$MACHINE" -u root test -s "$path"
  fi
}
dir_exists() {
  local path="$1"
  if ((TEST_MODE)); then [[ -d "$path" ]]
  else orb -m "$MACHINE" -u root test -d "$path"
  fi
}

check_file() {
  local label="$1" path="$2" mode
  if ! file_exists "$path"; then fail "$label metadata is missing"; return; fi
  mode="$(stat_mode "$path")"
  case "$mode" in
    600|640|400|440) pass "$label exists with restricted mode" ;;
    *) fail "$label has unsafe mode $mode" ;;
  esac
}
check_dir() {
  local label="$1" path="$2"
  if dir_exists "$path"; then pass "$label directory exists"; else fail "$label directory is missing"; fi
}

if ((TEST_MODE)); then
  : "${BASE:?SECRET_INVENTORY_ROOT is required in test mode}"
  check_file 'OpenClaw environment' "$BASE/openclaw.env"
  check_file 'Telegram bot token' "$BASE/secrets/telegram-bot-token"
  check_file 'WhatsApp owner target' "$BASE/secrets/owner-whatsapp-target"
  check_file 'VPS read-only SSH key' "$BASE/secrets/vps-readonly-ssh-key"
  check_file 'VPS known hosts' "$BASE/secrets/vps-ssh-known-hosts"
  check_file 'KiwiVM credentials' "$BASE/secrets/kiwivm-credentials.json"
else
  check_file 'OpenClaw environment' "$OPENCLAW_DATA_DIR/openclaw.env"
  check_dir 'OpenClaw secret directory' "$OPENCLAW_DATA_DIR/secrets"
  for entry in \
    'PUBG API key|pubg-api-key' \
    'PUBG team config|pubg-team.json' \
    'Telegram bot token|telegram-bot-token' \
    'WhatsApp owner target|owner-whatsapp-target' \
    'Mac control SSH key|mac-ssh-key' \
    'VPS read-only SSH key|vps-readonly-ssh-key' \
    'VPS known hosts|vps-ssh-known-hosts' \
    'KiwiVM credentials|kiwivm-credentials.json' \
    'KOOK bot token|kook-bot-token'; do
    label="${entry%%|*}"; name="${entry#*|}"
    check_file "$label" "$OPENCLAW_DATA_DIR/secrets/$name"
  done
  check_file 'Product Radar environment' "$RADAR_APP_DIR/.env"
  check_dir '9Router protected provider/account state' '/DATA/AppData/9router/data'
  check_file '9Router external secret env' "$NINE_ROUTER_ENV_FILE"
  check_file 'Immich external secret env' "$IMMICH_ENV_FILE"
  check_file_metadata() {
    local label="$1" path="$2"
    if orb -m "$MACHINE" -u root test -s "$path"; then pass "$label metadata exists"; else fail "$label metadata is missing"; fi
  }
  check_file_metadata 'Immich CasaOS compose credential boundary' '/var/lib/casaos/apps/immich/docker-compose.yml'
  check_file_metadata '9Router CasaOS compose credential boundary' '/var/lib/casaos/apps/9router/docker-compose.yml'
  check_dir 'Immich PostgreSQL protected state' '/DATA/AppData/immich/pgdata'
  check_dir 'changedetection compatibility state' '/DATA/AppData/changedetection/datastore'
  check_dir 'media adapter state' '/DATA/AppData/media-organizer-adapter'
  # Check only metadata/structure. Never print or compare file contents.
  if orb -m "$MACHINE" -u root python3 - '/var/lib/casaos/apps/immich/docker-compose.yml' '/var/lib/casaos/apps/9router/docker-compose.yml' <<'PY'
import re
import sys
from pathlib import Path
secret_keys = re.compile(r'^(?:POSTGRES_PASSWORD|DB_PASSWORD|API_KEY_SECRET|JWT_SECRET|INITIAL_PASSWORD|MACHINE_ID_SALT):\s*(?!\$\{)(\S+)')
for raw in sys.argv[1:]:
    for line in Path(raw).read_text(encoding='utf-8').splitlines():
        if secret_keys.search(line):
            raise SystemExit(1)
PY
  then pass 'CasaOS compose files use external secret boundaries'; else fail 'CasaOS compose files contain inline secret values'; fi
fi

check_manifest_coverage() {
  local manifest="$ROOT_DIR/docs/OPERATION_SKULD_MIGRATION_MANIFEST.json"
  [[ -s "$manifest" ]] || { fail 'Operation Skuld manifest is missing'; return; }
  if ! python3 - "$manifest" <<'PY'
import json, sys
from pathlib import Path
value=json.loads(Path(sys.argv[1]).read_text())
for item in value.get('secretInventory', []):
    if item.get('required', True) and (not item.get('restoreTarget') or item.get('contentsInGit') is not False or item.get('encryptedBundle') is not True):
        raise SystemExit(1)
PY
  then fail 'required manifest secret lacks encrypted restore coverage'; else pass 'manifest required secret coverage is metadata-only and encrypted'; fi
}
check_manifest_coverage

if ((FAILURES)); then
  printf 'SECRET_INVENTORY=blocked (%s failure(s); values were not read or printed)\n' "$FAILURES"
  exit 1
fi
printf '%s\n' 'SECRET_INVENTORY=passed (metadata only; secret values were not read or printed)'
