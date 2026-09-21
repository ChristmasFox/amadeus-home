#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/amadeus-storage-runtime.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT
# Keep the fixture independent from a developer's ignored real host profile.
export AMADEUS_HOST_PROFILE="$fixture/no-host-profile"

external="$fixture/external"
source="$fixture/source"
destination="$external/immich/data"
backup="$fixture/backup"
mkdir -p "$external" "$source" "$backup"
python3 - "$source" <<'PY'
import sys
from pathlib import Path

root = Path(sys.argv[1])
for directory in ('library', 'upload', 'thumbs', 'encoded-video', 'profile', 'backups'):
    (root / directory).mkdir(parents=True)
(root / 'library' / 'photo.jpg').write_bytes(b'photo-v1')
(root / 'upload' / 'video.mp4').write_bytes(b'video-v1')
(root / 'thumbs' / 'thumb.jpg').write_bytes(b'thumb-v1')
(root / 'encoded-video' / 'encoded.mp4').write_bytes(b'encoded-v1')
(root / 'profile' / 'profile.json').write_text('{"fixture":true}\n')
(root / 'backups' / 'marker').write_bytes(b'backup-v1')
(root / 'library' / 'intentional-zero-byte').touch()
PY

cat >"$external/.amadeus-storage.json" <<'JSON'
{
  "schemaVersion": 1,
  "storageId": "fixture-external",
  "purpose": "amadeus-homelab-storage"
}
JSON
mkdir -p "$destination"
source_bytes="$(du -sk "$source" | awk '{print $1 * 1024}')"
free_bytes=$((source_bytes + 10737418240 + 1024))

preflight_env=(
  STORAGE_PREFLIGHT_TEST_MODE=1
  STORAGE_PREFLIGHT_NO_WRITE_TEST=0
  EXTERNAL_STORAGE_ROOT="$external"
  EXTERNAL_STORAGE_VOLUME_UUID='fixture-volume-uuid'
  STORAGE_TEST_ACTUAL_VOLUME_UUID='fixture-volume-uuid'
  EXTERNAL_STORAGE_SENTINEL_ID='fixture-external'
  STORAGE_TEST_SOURCE_DEVICE='internal-device'
  STORAGE_TEST_DESTINATION_DEVICE='external-device'
  STORAGE_TEST_DESTINATION_FREE_BYTES="$free_bytes"
  STORAGE_SAFETY_MARGIN_BYTES=10737418240
  IMMICH_MEDIA_ROOT="$destination"
)

run_preflight() {
  env "${preflight_env[@]}" bash "$ROOT_DIR/scripts/storage-preflight.sh" --check --source "$source" --destination "$destination" "$@"
}

if env "${preflight_env[@]}" EXTERNAL_STORAGE_ROOT="$fixture/missing" bash "$ROOT_DIR/scripts/storage-preflight.sh" --check --source "$source" --destination "$destination" >/dev/null 2>&1; then
  printf '%s\n' 'missing volume fixture unexpectedly passed' >&2
  exit 1
fi
if env "${preflight_env[@]}" STORAGE_TEST_ACTUAL_VOLUME_UUID='wrong-uuid' bash "$ROOT_DIR/scripts/storage-preflight.sh" --check --source "$source" --destination "$destination" >/dev/null 2>&1; then
  printf '%s\n' 'volume identity fixture unexpectedly passed' >&2
  exit 1
fi
if env "${preflight_env[@]}" STORAGE_TEST_SOURCE_DEVICE='same-device' STORAGE_TEST_DESTINATION_DEVICE='same-device' bash "$ROOT_DIR/scripts/storage-preflight.sh" --check --source "$source" --destination "$destination" >/dev/null 2>&1; then
  printf '%s\n' 'same-device fixture unexpectedly passed' >&2
  exit 1
fi
if env "${preflight_env[@]}" STORAGE_TEST_DESTINATION_FREE_BYTES=1 bash "$ROOT_DIR/scripts/storage-preflight.sh" --check --source "$source" --destination "$destination" >/dev/null 2>&1; then
  printf '%s\n' 'insufficient-free-space fixture unexpectedly passed' >&2
  exit 1
fi
run_preflight >/dev/null

compose="$fixture/immich-compose.yml"
printf '%s\n' 'services:' '  immich-server:' >"$compose"
state_dir="$fixture/migration-state"
common_migration_env=(
  MIGRATION_TEST_MODE=1
  IMMICH_SOURCE_ROOT="$source"
  IMMICH_MEDIA_ROOT="$destination"
  IMMICH_MIGRATION_STATE_DIR="$state_dir"
  IMMICH_COMPOSE_FILE="$compose"
  SKULD_BACKUP_ROOT="$backup"
  ORBSTACK_MACHINE=fixture
  STORAGE_PREFLIGHT_TEST_MODE=1
  EXTERNAL_STORAGE_ROOT="$external"
  EXTERNAL_STORAGE_VOLUME_UUID='fixture-volume-uuid'
  STORAGE_TEST_ACTUAL_VOLUME_UUID='fixture-volume-uuid'
  EXTERNAL_STORAGE_SENTINEL_ID='fixture-external'
  STORAGE_TEST_SOURCE_DEVICE='internal-device'
  STORAGE_TEST_DESTINATION_DEVICE='external-device'
  STORAGE_TEST_DESTINATION_FREE_BYTES="$free_bytes"
  STORAGE_SAFETY_MARGIN_BYTES=10737418240
)
env "${common_migration_env[@]}" bash "$ROOT_DIR/scripts/migrate-immich-media.sh" --precopy >/dev/null
env "${common_migration_env[@]}" bash "$ROOT_DIR/scripts/migrate-immich-media.sh" --verify >/dev/null
printf '%s' 'video-v2' >"$source/upload/video.mp4"
env "${common_migration_env[@]}" bash "$ROOT_DIR/scripts/migrate-immich-media.sh" --precopy >/dev/null
env "${common_migration_env[@]}" bash "$ROOT_DIR/scripts/migrate-immich-media.sh" --verify >/dev/null

printf '%s' 'xxxxx' >"$destination/library/photo.jpg"
if env "${common_migration_env[@]}" bash "$ROOT_DIR/scripts/migrate-immich-media.sh" --verify >/dev/null 2>&1; then
  printf '%s\n' 'checksum mismatch fixture unexpectedly passed' >&2
  exit 1
fi
[[ -d "$source" && -f "$source/upload/video.mp4" ]]
env "${common_migration_env[@]}" bash "$ROOT_DIR/scripts/migrate-immich-media.sh" --precopy >/dev/null
env "${common_migration_env[@]}" bash "$ROOT_DIR/scripts/migrate-immich-media.sh" --verify >/dev/null

db_backup="$state_dir/fresh-db.dump"
printf '%s\n' 'fixture-db-backup' >"$db_backup"
python3 - "$state_dir/state.json" "$source" "$destination" "$db_backup" <<'PY'
import json
import sys
from pathlib import Path

state, source, destination, db = map(Path, sys.argv[1:])
value = json.loads(state.read_text())
value.update({
    'phase': 'cutover-complete',
    'equivalenceStatus': 'passed',
    'sourceRetained': True,
    'sourceReclaimPending': True,
    'dbBackupPath': str(db),
    'source': str(source),
    'destination': str(destination),
})
state.write_text(json.dumps(value) + '\n')
PY
if env ORBSTACK_MACHINE=fixture IMMICH_MIGRATION_STATE_DIR="$state_dir" SKULD_BACKUP_ROOT="$backup" bash "$ROOT_DIR/scripts/reclaim-immich-old-source.sh" --apply >/dev/null 2>&1; then
  printf '%s\n' 'source reclaim without approval unexpectedly passed' >&2
  exit 1
fi
env ORBSTACK_MACHINE=fixture IMMICH_MIGRATION_STATE_DIR="$state_dir" SKULD_BACKUP_ROOT="$backup" bash "$ROOT_DIR/scripts/reclaim-immich-old-source.sh" --plan >/dev/null
[[ -d "$source" ]]

image_inventory="$fixture/images.txt"
printf '%s\n' \
  'fixture-running-current|current|running|running' \
  'fixture-previous|previous|protected|protected' \
  'fixture-rollback|rollback|protected|protected' \
  'fixture-old|old|dangling|dangling' \
  'fixture-unknown|user|other|unknown' >"$image_inventory"
gc_output="$(STORAGE_MAINTENANCE_TEST_MODE=1 STORAGE_IMAGE_INVENTORY_FILE="$image_inventory" bash "$ROOT_DIR/scripts/storage-maintenance.sh" --apply)"
printf '%s\n' "$gc_output" | grep -Fqx 'KEEP|fixture-running-current:current'
printf '%s\n' "$gc_output" | grep -Fqx 'KEEP|fixture-previous:previous'
printf '%s\n' "$gc_output" | grep -Fqx 'KEEP|fixture-rollback:rollback'
printf '%s\n' "$gc_output" | grep -Fqx 'REMOVE|fixture-old:old'
printf '%s\n' "$gc_output" | grep -Fqx 'REPORT_ONLY|fixture-unknown:user'

secret_source="$fixture/secret-source"
mkdir -p "$secret_source"
printf '%s\n' 'FIXTURE_SECRET_VALUE' >"$secret_source/credential.txt"
chmod 600 "$secret_source/credential.txt"
passphrase="$fixture/passphrase"
printf '%s\n' 'fixture-passphrase' >"$passphrase"
chmod 600 "$passphrase"
secret_output="$(SKULD_SECRET_TEST_MODE=1 SKULD_SECRET_SOURCE_DIR="$secret_source" bash "$ROOT_DIR/scripts/export-skuld-secrets.sh" --apply --passphrase-file "$passphrase" --output-dir "$fixture/secret-bundle")"
bundle="$(printf '%s\n' "$secret_output" | sed -n 's/^SECRET_BUNDLE=//p')"
[[ -s "$bundle" ]]
if grep -aF 'FIXTURE_SECRET_VALUE' "$bundle" >/dev/null 2>&1; then
  printf '%s\n' 'encrypted bundle contains plaintext fixture marker' >&2
  exit 1
fi
bash "$ROOT_DIR/scripts/import-skuld-secrets.sh" --bundle "$bundle" --passphrase-file "$passphrase" | grep -Fqx 'SECRET_RESTORE_REHEARSAL=passed'

inventory="$fixture/secret-inventory"
mkdir -p "$inventory/secrets"
printf '%s\n' 'FIXTURE_SECRET_VALUE' >"$inventory/openclaw.env"
for name in telegram-bot-token owner-whatsapp-target vps-readonly-ssh-key vps-ssh-known-hosts kiwivm-credentials.json; do
  printf '%s\n' 'FIXTURE_SECRET_VALUE' >"$inventory/secrets/$name"
done
for path in "$inventory/openclaw.env" "$inventory/secrets/"*; do chmod 600 "$path"; done
inventory_output="$(SECRETS_INVENTORY_TEST_MODE=1 SECRET_INVENTORY_ROOT="$inventory" bash "$ROOT_DIR/scripts/secrets-inventory.sh")"
printf '%s\n' "$inventory_output" | grep -Fqx 'SECRET_INVENTORY=passed (metadata only; secret values were not read or printed)'
if printf '%s\n' "$inventory_output" | grep -F 'FIXTURE_SECRET_VALUE' >/dev/null; then
  printf '%s\n' 'secret inventory leaked fixture marker' >&2
  exit 1
fi

grep -Fq '"log-driver": "local"' "$ROOT_DIR/infra/docker/daemon.json.example"
grep -Fq '"max-size": "20m"' "$ROOT_DIR/infra/docker/daemon.json.example"
grep -Fq '"max-file": "5"' "$ROOT_DIR/infra/docker/daemon.json.example"

for template in \
  infra/docker/casaos/openclaw/docker-compose.example.yml \
  infra/docker/casaos/product-radar/docker-compose.example.yml \
  infra/docker/homelab/9router/docker-compose.example.yml \
  infra/changedetection/docker-compose.example.yml \
  infra/docker/homelab/immich/docker-compose.example.yml; do
  grep -Fq 'driver:' "$ROOT_DIR/$template"
  grep -Fq 'max-size:' "$ROOT_DIR/$template"
  grep -Fq 'max-file:' "$ROOT_DIR/$template"
done
if grep -F -- '--delete' "$ROOT_DIR/scripts/migrate-immich-media.sh" >/dev/null; then
  printf '%s\n' 'forbidden synchronization flag found' >&2
  exit 1
fi
if grep -F -- 'volume prune' "$ROOT_DIR/scripts/storage-maintenance.sh" >/dev/null || grep -F -- 'system prune --volumes' "$ROOT_DIR/scripts/storage-maintenance.sh" >/dev/null; then
  printf '%s\n' 'forbidden Docker cleanup found' >&2
  exit 1
fi

printf '%s\n' 'STORAGE_RUNTIME_TEST=passed'
