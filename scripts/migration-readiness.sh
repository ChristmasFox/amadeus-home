#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT_DIR"
MACHINE="$ORBSTACK_MACHINE"
failures=0
warnings=0

pass() { printf 'PASS  %s\n' "$1"; }
warn() { printf 'WARN  %s\n' "$1"; warnings=$((warnings + 1)); }
fail() { printf 'FAIL  %s\n' "$1"; failures=$((failures + 1)); }

check() {
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then pass "$label"; else fail "$label"; fi
}

check_git_clean() { [[ -z "$(git -C "$ROOT_DIR" status --short --untracked-files=all)" ]]; }
check_version() { [[ "$(bash "$ROOT_DIR/scripts/amadeus-version.sh" show)" == '1.4.2' ]]; }
check_required_sources() {
  local path
  for path in \
    "$ROOT_DIR/infra/host-profile.env.example" \
    "$ROOT_DIR/infra/docker/casaos/openclaw/docker-compose.example.yml" \
    "$ROOT_DIR/infra/docker/casaos/product-radar/docker-compose.example.yml" \
    "$ROOT_DIR/scripts/deploy-openclaw.sh" \
    "$ROOT_DIR/docs/INFRASTRUCTURE_CLASSIFICATION.md" \
    "$ROOT_DIR/docs/PROACTIVE_NOTIFICATION_PRODUCERS.md" \
    "$ROOT_DIR/docs/OPERATION_SKULD_MIGRATION_MANIFEST.json" \
    "$ROOT_DIR/docs/OPERATION_SKULD_MAC_MINI_MIGRATION_RUNBOOK.md"; do
    [[ -f "$path" ]] || return 1
  done
  python3 -m json.tool "$ROOT_DIR/docs/OPERATION_SKULD_MIGRATION_MANIFEST.json" >/dev/null
}
check_active_sources() {
  ! rg -n -i 'langbot|n8n-sandbox|legacy n8n runtime|/Users/blacksidev' \
    "$ROOT_DIR/scripts" "$ROOT_DIR/infra" "$ROOT_DIR/integrations" "$ROOT_DIR/apps/product-radar" "$ROOT_DIR/plugins" "$ROOT_DIR/packages" \
    --glob '*.sh' --glob '*.py' --glob '*.mjs' --glob '*.ts' \
    --glob '*.json' --glob '*.yml' --glob '*.yaml' \
    --glob '!**/migration/**' \
    --glob '!**/*migration*.ts' \
    --glob '!**/migrate-pubg-data.ts' \
    --glob '!**/migration-cli.ts' \
    --glob '!**/check-architecture.mjs' \
    --glob '!**/test-check-architecture.mjs' \
    --glob '!**/migration-readiness.sh' >/dev/null
}
check_remote_machine() {
  command -v orb >/dev/null 2>&1 && orb list 2>/dev/null | awk -v machine="$MACHINE" '$1 == machine && $2 == "running" { found = 1 } END { exit found ? 0 : 1 }'
}
check_remote_containers() {
  local names
  names="$(orb -m "$MACHINE" -u root docker ps --format '{{.Names}}' 2>/dev/null)"
  for name in openclaw product-radar media-organizer-adapter changedetection 9router; do
    printf '%s\n' "$names" | grep -Fx "$name" >/dev/null || return 1
  done
  ! printf '%s\n' "$names" | grep -E '^(langbot|langbot_plugin_runtime|n8n|n8n-sandbox)' >/dev/null
}
check_health() {
  orb -m "$MACHINE" -u root curl --fail --silent --show-error --max-time 8 http://127.0.0.1:18789/healthz >/dev/null
  orb -m "$MACHINE" -u root curl --fail --silent --show-error --max-time 8 http://127.0.0.1:5315/health >/dev/null
  orb -m "$MACHINE" -u root docker exec "$MEDIA_ADAPTER_CONTAINER" python3 -c 'import urllib.request; urllib.request.urlopen("http://127.0.0.1:8765/healthz", timeout=8).read()' >/dev/null
}
check_network() {
  orb -m "$MACHINE" -u root docker network inspect "$AMADEUS_NETWORK_NAME" >/dev/null
  orb -m "$MACHINE" -u root docker network inspect "$NINE_ROUTER_NETWORK_NAME" >/dev/null
}
check_remote_files() {
  local path
  for path in \
    "$OPENCLAW_DATA_DIR/data/pubg.sqlite" \
    "$OPENCLAW_DATA_DIR/data/identity.sqlite" \
    "$OPENCLAW_DATA_DIR/data/vps-usage-state.json" \
    "$RADAR_DATA_DIR/product-radar.sqlite" \
    "$OPENCLAW_DATA_DIR/notifications" \
    "$OPENCLAW_DATA_DIR/secrets" \
    "$OPENCLAW_DATA_DIR/backups"; do
    orb -m "$MACHINE" -u root test -e "$path" || return 1
  done
}
check_secrets_metadata() {
  orb -m "$MACHINE" -u root python3 - "$OPENCLAW_DATA_DIR" <<'PY'
import os, stat, sys
from pathlib import Path
root = Path(sys.argv[1])
paths = [
    root / 'openclaw.env', root / 'secrets/pubg-api-key', root / 'secrets/pubg-team.json',
    root / 'secrets/telegram-bot-token', root / 'secrets/owner-whatsapp-target',
    root / 'secrets/mac-ssh-key', root / 'secrets/vps-readonly-ssh-key',
    root / 'secrets/vps-ssh-known-hosts', root / 'secrets/kiwivm-credentials.json',
    root / 'secrets/kook-bot-token',
]
for path in paths:
    if not path.is_file() or not path.read_bytes().strip(): raise SystemExit('missing secret metadata')
    if stat.S_IMODE(path.stat().st_mode) & 0o077: raise SystemExit('secret permissions too broad')
print('SECRET_METADATA=valid')
PY
}
check_sqlite_integrity() {
  orb -m "$MACHINE" -u root python3 - \
    "$OPENCLAW_DATA_DIR/data/pubg.sqlite" \
    "$OPENCLAW_DATA_DIR/data/identity.sqlite" \
    "$RADAR_DATA_DIR/product-radar.sqlite" <<'PY'
import sqlite3, sys
for raw in sys.argv[1:]:
    uri = 'file:' + raw + '?mode=ro'
    with sqlite3.connect(uri, uri=True) as db:
        result = db.execute('PRAGMA integrity_check').fetchone()[0]
        if result != 'ok': raise SystemExit('sqlite integrity failed')
print('SQLITE_INTEGRITY=valid')
PY
}
check_outbox() {
  orb -m "$MACHINE" -u root python3 - "$OPENCLAW_DATA_DIR/notifications" <<'PY'
import json, sys
from pathlib import Path
directory = Path(sys.argv[1])
for path in directory.glob('*.pending.json'):
    value = json.loads(path.read_text())
    required = ('type', 'eventType', 'severity', 'significance', 'theme', 'eventKey', 'source', 'headline', 'facts', 'occurredAt')
    if any(key not in value for key in required) or value.get('type') != 'owner_notification': raise SystemExit('invalid owner outbox event')
print('OWNER_OUTBOX=valid')
PY
}
check_crons() {
  orb -m "$MACHINE" -u root docker exec openclaw node dist/index.js cron list --json | python3 -c '
import json,sys
jobs={item.get("name") for item in json.load(sys.stdin).get("jobs",[])}
expected={"amadeus-vps-morning","amadeus-vps-evening","amadeus-pubg-telemetry-hourly","amadeus-pubg-sync-daily","amadeus-market-open","amadeus-market-close"}
raise SystemExit(0 if expected <= jobs else 1)
'
}
check_fashion_siglip() {
  curl --fail --silent --show-error --max-time 8 "http://127.0.0.1:${FASHION_SIGLIP_PORT}/health" | python3 -c 'import json,sys; value=json.load(sys.stdin); raise SystemExit(0 if value.get("status") == "ok" and value.get("device") == "mps" else 1)' >/dev/null
  if command -v launchctl >/dev/null 2>&1; then launchctl print "gui/$(id -u)/$FASHION_SIGLIP_LABEL" >/dev/null; fi
}
check_fashion_cache_inventory() {
  if [[ -d "$FASHION_SIGLIP_MODEL_CACHE_DIR" ]]; then
    pass "FashionSigLIP model cache present"
  else
    warn "FashionSigLIP model cache will be re-downloaded"
  fi
}
check_backup_manifest() {
  local newest
  newest="$(orb -m "$MACHINE" -u root find "$OPENCLAW_DATA_DIR/backups" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n 1 | cut -d' ' -f2-)"
  [[ -n "$newest" ]] || return 1
  orb -m "$MACHINE" -u root test -f "$newest/backup-manifest.json"
}
check_restore_rehearsal() {
  orb -m "$MACHINE" -u root python3 - \
    "$OPENCLAW_DATA_DIR/data/pubg.sqlite" \
    "$OPENCLAW_DATA_DIR/data/identity.sqlite" \
    "$RADAR_DATA_DIR/product-radar.sqlite" \
    "$OPENCLAW_DATA_DIR/data/vps-usage-state.json" <<'PY'
import json, shutil, sqlite3, sys, tempfile
from pathlib import Path
staging = Path(tempfile.mkdtemp(prefix='operation-skuld-readiness-'))
try:
    for index, raw in enumerate(sys.argv[1:]):
        source = Path(raw)
        target = staging / str(index) / source.name
        target.parent.mkdir(parents=True)
        shutil.copy2(source, target)
        if source.suffix in {'.sqlite', '.db'}:
            with sqlite3.connect('file:' + str(target) + '?mode=ro', uri=True) as db:
                if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok': raise SystemExit('temporary sqlite restore failed')
        elif source.suffix == '.json':
            json.loads(target.read_text())
finally:
    shutil.rmtree(staging, ignore_errors=True)
print('TEMP_RESTORE_REHEARSAL=passed')
PY
}

run_readiness() {
  check 'clean Git worktree' check_git_clean
  check 'version 1.4.2' check_version
  check 'tracked migration sources and valid manifest' check_required_sources
  check 'active source has no retired runtime or old host path' check_active_sources
  check 'OrbStack machine is running' check_remote_machine
  check 'active containers present and legacy containers absent' check_remote_containers
  check 'OpenClaw, Product Radar, and media health' check_health
  check 'Amadeus and 9Router networks exist' check_network
  check 'critical runtime data paths exist' check_remote_files
  check 'secret presence and permissions without reading values' check_secrets_metadata
  check 'SQLite integrity is valid' check_sqlite_integrity
  check 'owner outbox contract is valid' check_outbox
  check 'expected native cron jobs exist' check_crons
  check 'FashionSigLIP worker and launch agent are healthy' check_fashion_siglip
  check_fashion_cache_inventory
  check 'external checkpoint has backup manifest' check_backup_manifest
  check 'temporary restore rehearsal is clean' check_restore_rehearsal

  printf 'Operation Skuld readiness: %s failure(s), %s warning(s).\n' "$failures" "$warnings"
  if ((failures == 0)); then
    printf '%s\n' 'OPERATION_SKULD=READY'
  else
    printf '%s\n' 'OPERATION_SKULD=BLOCKED'
    return 1
  fi
}

if [[ "${MIGRATION_READINESS_LIB_ONLY:-0}" != "1" ]]; then
  run_readiness
fi
