#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${SKULD_ROOT_DIR:-$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
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
check_version() {
  local version headline
  version="$(tr -d '[:space:]' < "$ROOT_DIR/VERSION")"
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 1
  bash "$ROOT_DIR/scripts/amadeus-version.sh" check >/dev/null
  headline="$(sed -n '1p' "$ROOT_DIR/RELEASE_NOTES.md")"
  [[ "$headline" == "# Amadeus $version" ]]
}
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
    "$ROOT_DIR/docs/OPERATION_SKULD_MAC_MINI_MIGRATION_RUNBOOK.md" \
    "$ROOT_DIR/docs/OPERATION_SKULD_SERVICE_INVENTORY.md" \
    "$ROOT_DIR/docs/STORAGE_RETENTION_POLICY.md" \
    "$ROOT_DIR/infra/docker/homelab/immich/docker-compose.example.yml" \
    "$ROOT_DIR/scripts/storage-preflight.sh" \
    "$ROOT_DIR/scripts/migrate-immich-media.sh" \
    "$ROOT_DIR/scripts/reclaim-immich-old-source.sh" \
    "$ROOT_DIR/scripts/storage-maintenance.sh" \
    "$ROOT_DIR/scripts/apply-docker-log-policy.sh" \
    "$ROOT_DIR/scripts/externalize-casaos-secrets.sh" \
    "$ROOT_DIR/scripts/storage-health.sh" \
    "$ROOT_DIR/scripts/install-storage-scheduler-macos.sh" \
    "$ROOT_DIR/scripts/export-9router-runtime.sh" \
    "$ROOT_DIR/scripts/secrets-inventory.sh" \
    "$ROOT_DIR/scripts/export-skuld-secrets.sh" \
    "$ROOT_DIR/scripts/import-skuld-secrets.sh" \
    "$ROOT_DIR/scripts/run-check.sh" \
    "$ROOT_DIR/scripts/test-fresh-clone-readiness.sh" \
    "$ROOT_DIR/scripts/service-aware-backup.sh" \
    "$ROOT_DIR/scripts/sqlite-consistent-snapshot.py" \
    "$ROOT_DIR/scripts/test-service-aware-backup.sh" \
    "$ROOT_DIR/scripts/test-skuld-manifest-runbook-consistency.sh" \
    "$ROOT_DIR/docs/SERVICE_AWARE_BACKUP_REGISTRY.json" \
    "$ROOT_DIR/docs/AMADEUS_1_4_6_OPERATION_SKULD_CUTOVER_READINESS_GOAL.md" \
    "$ROOT_DIR/scripts/plan-destination-bootstrap.sh" \
    "$ROOT_DIR/scripts/plan-clean-orbstack-guest.sh" \
    "$ROOT_DIR/scripts/plan-homelab-clean-restore.sh" \
    "$ROOT_DIR/scripts/skuld-state-machine.sh" \
    "$ROOT_DIR/scripts/plan-skuld-rollback.sh" \
    "$ROOT_DIR/scripts/pre-migration-gc.sh" \
    "$ROOT_DIR/scripts/plan-destination-capacity.sh" \
    "$ROOT_DIR/scripts/test-skuld-preparation-tooling.sh" \
    "$ROOT_DIR/scripts/test-immich-checksum-equivalence.sh"; do
    [[ -f "$path" ]] || return 1
  done
  python3 -m json.tool "$ROOT_DIR/docs/OPERATION_SKULD_MIGRATION_MANIFEST.json" >/dev/null
  for path in scripts/secrets-inventory.sh scripts/export-skuld-secrets.sh scripts/import-skuld-secrets.sh scripts/plan-destination-bootstrap.sh scripts/skuld-state-machine.sh scripts/pre-migration-gc.sh scripts/plan-destination-capacity.sh; do
    git -C "$ROOT_DIR" ls-files --error-unmatch "$path" >/dev/null || return 1
  done
}
check_active_sources() {
  ! rg -n -i 'langbot|n8n-sandbox|legacy n8n runtime' \
    "$ROOT_DIR/scripts" "$ROOT_DIR/infra" "$ROOT_DIR/integrations" "$ROOT_DIR/apps/product-radar" "$ROOT_DIR/plugins" "$ROOT_DIR/packages" \
    --glob '*.sh' --glob '*.py' --glob '*.mjs' --glob '*.ts' \
    --glob '*.json' --glob '*.yml' --glob '*.yaml' \
    --glob '!**/migration/**' \
    --glob '!**/*migration*.ts' \
    --glob '!**/migrate-pubg-data.ts' \
    --glob '!**/migration-cli.ts' \
    --glob '!**/check-architecture.mjs' \
    --glob '!**/test-check-architecture.mjs' \
    --glob '!**/migration-readiness.sh' \
    --glob '!**/plan-destination-bootstrap.sh' \
    --glob '!**/plan-clean-orbstack-guest.sh' \
    --glob '!**/plan-homelab-clean-restore.sh' \
    --glob '!**/skuld-state-machine.sh' \
    --glob '!**/plan-skuld-rollback.sh' \
    --glob '!**/pre-migration-gc.sh' \
    --glob '!**/plan-destination-capacity.sh' \
    --glob '!**/test-skuld-preparation-tooling.sh' \
    --glob '!**/test-immich-checksum-equivalence.sh' >/dev/null
}
check_remote_machine() {
  command -v orb >/dev/null 2>&1 && orb list 2>/dev/null | awk -v machine="$MACHINE" '$1 == machine && $2 == "running" { found = 1 } END { exit found ? 0 : 1 }'
}
check_remote_containers() {
  local names
  names="$(orb -m "$MACHINE" -u root docker ps --format '{{.Names}}' 2>/dev/null)"
  for name in openclaw product-radar media-organizer-adapter changedetection 9router immich-server immich-machine-learning immich-postgres immich-redis; do
    printf '%s\n' "$names" | grep -Fx "$name" >/dev/null || return 1
  done
  ! printf '%s\n' "$names" | grep -E '^(langbot|langbot_plugin_runtime|n8n|n8n-sandbox)' >/dev/null
}
check_health() {
  orb -m "$MACHINE" -u root curl --fail --silent --show-error --max-time 8 http://127.0.0.1:18789/healthz >/dev/null
  orb -m "$MACHINE" -u root curl --fail --silent --show-error --max-time 8 http://127.0.0.1:5315/health >/dev/null
  orb -m "$MACHINE" -u root docker exec "$MEDIA_ADAPTER_CONTAINER" python3 -c 'import urllib.request; urllib.request.urlopen("http://127.0.0.1:8765/healthz", timeout=8).read()' >/dev/null
  orb -m "$MACHINE" -u root curl --fail --silent --show-error --max-time 8 http://127.0.0.1:2283/api/server/ping >/dev/null
  orb -m "$MACHINE" -u root curl --silent --show-error --max-time 8 -o /dev/null -w '%{http_code}' http://127.0.0.1:20128/v1/models | grep -Fx '401' >/dev/null
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
    "$OPENCLAW_DATA_DIR/backups" \
    "/DATA/AppData/9router/data" \
    "/DATA/AppData/immich/pgdata" \
    "/DATA/AppData/changedetection/datastore"; do
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
check_storage_identity() {
  local state="$SKULD_BACKUP_ROOT/immich-migration/state.json"
  if [[ -f "$state" ]] && python3 - "$state" <<'PY'
import json, sys
from pathlib import Path
value=json.loads(Path(sys.argv[1]).read_text())
raise SystemExit(0 if value.get('sourceReclaimState') == 'SOURCE_RECLAIMED' else 1)
PY
  then
    STORAGE_PREFLIGHT_SKIP_SOURCE=1 bash "$ROOT_DIR/scripts/storage-preflight.sh" --check --allow-existing --source "$IMMICH_MEDIA_ROOT" --destination "$IMMICH_MEDIA_ROOT" >/dev/null
  else
    bash "$ROOT_DIR/scripts/storage-preflight.sh" --check --allow-existing --source /DATA/Gallery/immich --destination "$IMMICH_MEDIA_ROOT" >/dev/null
  fi
}
check_immich_migration_checkpoint() {
  local state="$SKULD_BACKUP_ROOT/immich-migration/state.json"
  [[ -f "$state" ]] || return 1
  python3 - "$state" <<'PY'
import json
import sys
from pathlib import Path
value = json.loads(Path(sys.argv[1]).read_text())
backup = value.get('dbBackupPath') or value.get('freshDbBackupPath')
if value.get('sourceReclaimState') == 'SOURCE_RECLAIMED':
    required = value.get('phase') == 'source-reclaimed' and value.get('sourceReclaimPending') is False and value.get('sourceRetained') is False and value.get('freshEquivalenceStatus') == 'passed' and value.get('freshReclaimEvidencePath')
else:
    required = value.get('phase') == 'cutover-complete' and value.get('copyStatus') == 'passed' and value.get('equivalenceStatus') == 'passed' and value.get('sourceReclaimPending') is True and value.get('sourceRetained') is True
raise SystemExit(0 if required and isinstance(backup, str) and Path(backup).is_file() else 1)
PY
}
check_secret_inventory() { bash "$ROOT_DIR/scripts/secrets-inventory.sh" >/dev/null; }
check_service_inventory() { bash "$ROOT_DIR/scripts/service-inventory.sh" --check >/dev/null; }
check_encrypted_secret_bundle() {
  local bundle
  bundle="$(find "$SKULD_BACKUP_ROOT" -type f -name 'secrets.tar.enc' -print -quit 2>/dev/null || true)"
  [[ -n "$bundle" && -s "$bundle" && -s "$bundle.sha256" ]]
}
check_9router_artifact() {
  local artifact
  artifact="$(find "$SKULD_BACKUP_ROOT" -type f -name '9router-*.tar*' -print -quit 2>/dev/null || true)"
  [[ -n "$artifact" && -s "$artifact" ]]
}
check_log_policy() {
  bash "$ROOT_DIR/scripts/apply-docker-log-policy.sh" --audit >/dev/null
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

check_manifest_runbook() { bash "$ROOT_DIR/scripts/test-skuld-manifest-runbook-consistency.sh" >/dev/null; }
check_service_aware_backup() {
  local newest manifest
  newest="$(find "$SKULD_BACKUP_ROOT" -type f -name 'service-aware-manifest.json' -print 2>/dev/null | sort | tail -n 1)"
  [[ -n "$newest" && -s "$newest" ]] || return 1
  manifest="$newest"
  python3 - "$manifest" <<'PY'
import json, sys
from pathlib import Path
v=json.loads(Path(sys.argv[1]).read_text())
if v.get('backupMode') != 'service-aware': raise SystemExit(1)
if not v.get('sqlite'): raise SystemExit(1)
pg=v.get('postgresql',{})
if pg.get('status') == 'passed' and not pg.get('restoreList'): raise SystemExit(1)
PY
}
check_storage_state() {
  local state="$OPENCLAW_DATA_DIR/data/storage-health-state.json"
  orb -m "$MACHINE" -u root test -s "$state" || return 1
  orb -m "$MACHINE" -u root python3 - "$state" "$STORAGE_READINESS_ALLOW_KNOWN_PRESSURE" "$STORAGE_HARD_MIN_FREE_BYTES" <<'PY'
import json, sys
from pathlib import Path
v=json.loads(Path(sys.argv[1]).read_text())
allow, hard_min = sys.argv[2], int(sys.argv[3])
status=v.get('status')
if status in {'missing','policy_violation'}: raise SystemExit(1)
if not v.get('components') or not v.get('targets'): raise SystemExit(1)
if status == 'critical':
    if allow != '1': raise SystemExit(1)
    target_ids={'mac_internal_root','external_storage','guest_root','guest_data'}
    for target in v.get('targets',[]):
        if target.get('id') in target_ids and int(target.get('freeBytes',0)) < hard_min:
            raise SystemExit(1)
    print('STORAGE_PRESSURE=known-and-operator-acknowledged')
print('STORAGE_STATE=valid')
PY
}
check_retention_policy() {
  [[ "${DEPLOYMENT_IMAGE_RETENTION_COUNT:-0}" =~ ^[1-9][0-9]*$ ]] || return 1
  [[ "${DEPLOYMENT_CHECKPOINT_RETENTION_COUNT:-0}" =~ ^[1-9][0-9]*$ ]] || return 1
  ! rg -n --fixed-strings -- 'docker volume prune' "$ROOT_DIR/scripts/storage-maintenance.sh" >/dev/null
  ! rg -n --fixed-strings -- 'docker system prune' "$ROOT_DIR/scripts/storage-maintenance.sh" >/dev/null
}


check_destination_identity() {
  local manifest="$ROOT_DIR/docs/OPERATION_SKULD_MIGRATION_MANIFEST.json"
  [[ -f "$manifest" ]] || return 1
  python3 - "$manifest" <<'PY'
import json, sys
from pathlib import Path
m = json.loads(Path(sys.argv[1]).read_text())
dest = m.get('destinationIdentity', {})
if dest.get('hostname') != 'Amadeus-M204': raise SystemExit('destination hostname not Amadeus-M204')
if dest.get('macosUser') != 'nyannyan': raise SystemExit('destination macosUser not nyannyan')
if dest.get('orbstackMachine') != 'nyannyan': raise SystemExit('destination orbstackMachine not nyannyan')
if dest.get('linuxUser') != 'nyannyan': raise SystemExit('destination linuxUser not nyannyan')
if dest.get('guestStrategy') != 'clean-orbstack-ubuntu-guest': raise SystemExit('guest strategy not clean')
print('DESTINATION_IDENTITY=Amadeus-M204/nyannyan')
PY
}
check_preparation_tooling() {
  local scripts=(
    "$ROOT_DIR/scripts/plan-destination-bootstrap.sh"
    "$ROOT_DIR/scripts/plan-clean-orbstack-guest.sh"
    "$ROOT_DIR/scripts/plan-homelab-clean-restore.sh"
    "$ROOT_DIR/scripts/skuld-state-machine.sh"
    "$ROOT_DIR/scripts/plan-skuld-rollback.sh"
    "$ROOT_DIR/scripts/pre-migration-gc.sh"
    "$ROOT_DIR/scripts/plan-destination-capacity.sh"
  )
  for script in "${scripts[@]}"; do
    [[ -f "$script" ]] || return 1
    bash -n "$script" >/dev/null || return 1
  done
}
check_immich_checksum_fix() {
  # Verify the 1.4.6 zero-changes fix is present and old filesReported pattern is gone
  grep -q 'filesChecked' "$ROOT_DIR/scripts/reclaim-immich-old-source.sh" || return 1
  grep -q 'transfer_lines' "$ROOT_DIR/scripts/reclaim-immich-old-source.sh" || return 1
  ! grep -q 'filesReported' "$ROOT_DIR/scripts/reclaim-immich-old-source.sh" || return 1
}
check_storage_telemetry_fix() {
  # Verify the 1.4.6 MACHINE variable expansion fix is present
  ! grep -q "'\${MACHINE}'" "$ROOT_DIR/scripts/storage-health.sh" || return 1
  grep -q 'machine, immich_root, ext_root = sys.argv' "$ROOT_DIR/scripts/storage-health.sh" || return 1
}
run_readiness() {
  check 'clean Git worktree' check_git_clean
  check 'dynamic release version and release notes' check_version
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
  check 'external storage identity and Immich source/destination preflight' check_storage_identity
  check 'Immich cutover and retained-source checkpoint' check_immich_migration_checkpoint
  check 'service inventory coverage' check_service_inventory
  check 'secret inventory metadata' check_secret_inventory
  check 'encrypted secret bundle metadata' check_encrypted_secret_bundle
  check 'service-aware backup manifest' check_service_aware_backup
  check 'manifest/runbook consistency' check_manifest_runbook
  check 'storage state and capacity evaluation' check_storage_state
  check 'destination identity is Amadeus-M204/nyannyan' check_destination_identity
  check '1.4.6 preparation tooling scripts present and valid' check_preparation_tooling
  check '1.4.6 Immich remote checksum zero-changes fix applied' check_immich_checksum_fix
  check '1.4.6 storage growth telemetry fix applied' check_storage_telemetry_fix
  check 'retention policy and safe-GC guards' check_retention_policy
  check 'exact 9Router runtime artifact' check_9router_artifact
  check 'managed Docker log policy' check_log_policy

  printf 'Operation Skuld readiness: %s failure(s), %s warning(s).\n' "$failures" "$warnings"
  if ((failures == 0)); then
    printf '%s\n' 'IMMICH_SOURCE_RECLAIM=READY_BUT_PENDING'
    printf '%s\n' 'OPERATION_SKULD=READY'
    printf '%s\n' 'OPERATION_SKULD_SOURCE_READY=yes'
    printf '%s\n' 'DESTINATION_HOST_IDENTITY=Amadeus-M204'
    printf '%s\n' 'DESTINATION_MACOS_USER=nyannyan'
    printf '%s\n' 'DESTINATION_ORBSTACK_MACHINE=nyannyan'
    printf '%s\n' 'DESTINATION_LINUX_USER=nyannyan'
    printf '%s\n' 'SOURCE_FROZEN=NO'
    printf '%s\n' 'DESTINATION_MUTATED=NO'
    printf '%s\n' 'MAC_MINI_CUTOVER=NOT_EXECUTED'
    printf '%s\n' 'IMMICH_SOURCE_RECLAIM=PENDING'
  else
    printf '%s\n' 'OPERATION_SKULD=BLOCKED'
    return 1
  fi
}

if [[ "${MIGRATION_READINESS_LIB_ONLY:-0}" != "1" ]]; then
  run_readiness
fi
