#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/amadeus-skuld-test.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT

fake_bin="$fixture/bin"
mkdir -p "$fake_bin"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'while (($#)); do' \
  '  case "$1" in -m|-u) shift 2 ;; *) break ;; esac' \
  'done' \
  'exec "$@"' > "$fake_bin/orb"
chmod 755 "$fake_bin/orb"
export PATH="$fake_bin:$PATH"

export MIGRATION_READINESS_LIB_ONLY=1
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/migration-readiness.sh"

OPENCLAW_DATA_DIR="$fixture/openclaw"
RADAR_DATA_DIR="$fixture/radar"
MACHINE='fixture'
FASHION_SIGLIP_MODEL_CACHE_DIR="$fixture/cache"
export OPENCLAW_DATA_DIR RADAR_DATA_DIR MACHINE FASHION_SIGLIP_MODEL_CACHE_DIR
mkdir -p "$OPENCLAW_DATA_DIR/data" "$OPENCLAW_DATA_DIR/secrets" "$OPENCLAW_DATA_DIR/notifications" \
  "$OPENCLAW_DATA_DIR/backups/checkpoint" "$RADAR_DATA_DIR"

printf 'external-placeholder\n' > "$OPENCLAW_DATA_DIR/openclaw.env"
chmod 600 "$OPENCLAW_DATA_DIR/openclaw.env"
for secret in \
  pubg-api-key pubg-team.json telegram-bot-token owner-whatsapp-target \
  mac-ssh-key vps-readonly-ssh-key vps-ssh-known-hosts kiwivm-credentials.json kook-bot-token; do
  printf 'external-placeholder\n' > "$OPENCLAW_DATA_DIR/secrets/$secret"
  chmod 600 "$OPENCLAW_DATA_DIR/secrets/$secret"
done
printf '%s\n' '{}' > "$OPENCLAW_DATA_DIR/data/vps-usage-state.json"
printf '%s\n' '{}' > "$OPENCLAW_DATA_DIR/backups/checkpoint/backup-manifest.json"

python3 - "$OPENCLAW_DATA_DIR/data/pubg.sqlite" "$OPENCLAW_DATA_DIR/data/identity.sqlite" "$RADAR_DATA_DIR/product-radar.sqlite" <<'PY'
import sqlite3
import sys
for raw in sys.argv[1:]:
    with sqlite3.connect(raw) as db:
        db.execute('CREATE TABLE marker (value TEXT)')
        db.commit()
PY

check_secrets_metadata
check_sqlite_integrity
check_restore_rehearsal

original_root="$ROOT_DIR"
check_version
version_fixture="$fixture/version-check"
mkdir -p "$version_fixture/scripts"
printf '%s\n' '1.4.4' > "$version_fixture/VERSION"
printf '%s\n' '# Amadeus 1.4.4' '' 'Storage runtime fixture.' > "$version_fixture/RELEASE_NOTES.md"
cp "$original_root/scripts/amadeus-version.sh" "$version_fixture/scripts/amadeus-version.sh"
chmod 755 "$version_fixture/scripts/amadeus-version.sh"
ROOT_DIR="$version_fixture"
check_version
printf '%s\n' '# Amadeus 1.4.2' '' 'Stale release fixture.' > "$version_fixture/RELEASE_NOTES.md"
if check_version >/dev/null 2>&1; then
  printf '%s\n' 'stale release notes unexpectedly passed dynamic version check' >&2
  exit 1
fi
ROOT_DIR="$original_root"

rm "$OPENCLAW_DATA_DIR/secrets/telegram-bot-token"
if check_secrets_metadata >/dev/null 2>&1; then
  printf '%s\n' 'missing required secret unexpectedly passed' >&2
  exit 1
fi
printf 'external-placeholder\n' > "$OPENCLAW_DATA_DIR/secrets/telegram-bot-token"
chmod 600 "$OPENCLAW_DATA_DIR/secrets/telegram-bot-token"

printf 'not a sqlite database\n' > "$OPENCLAW_DATA_DIR/data/pubg.sqlite"
if check_sqlite_integrity >/dev/null 2>&1; then
  printf '%s\n' 'corrupt SQLite unexpectedly passed' >&2
  exit 1
fi
rm "$OPENCLAW_DATA_DIR/data/pubg.sqlite"
python3 - "$OPENCLAW_DATA_DIR/data/pubg.sqlite" <<'PY'
import sqlite3
import sys
with sqlite3.connect(sys.argv[1]) as db:
    db.execute('CREATE TABLE marker (value TEXT)')
    db.commit()
PY

warnings=0
FASHION_SIGLIP_MODEL_CACHE_DIR="$fixture/missing-cache"
cache_output="$fixture/cache-output"
check_fashion_cache_inventory > "$cache_output"
grep -Fqx 'WARN  FashionSigLIP model cache will be re-downloaded' "$cache_output"
[[ "$warnings" -eq 1 ]]

profile="$fixture/host-profile.env"
printf '%s\n' 'ORBSTACK_MACHINE=skuld-test' 'MAC_CONTROL_USER=destination-user' 'FASHION_SIGLIP_PORT=18401' > "$profile"
profile_output="$(AMADEUS_HOST_PROFILE="$profile" bash -c '
  set -Eeuo pipefail
  source "$1/scripts/host-profile.sh"
  amadeus_host_profile_load "$1"
  printf "%s\\n" "$ORBSTACK_MACHINE" "$MAC_CONTROL_USER" "$FASHION_SIGLIP_PORT"
' _ "$ROOT_DIR")"
printf '%s\n' "$profile_output" | grep -Fqx 'skuld-test'
printf '%s\n' "$profile_output" | grep -Fqx 'destination-user'
printf '%s\n' "$profile_output" | grep -Fqx '18401'

python3 - "$ROOT_DIR/docs/OPERATION_SKULD_MIGRATION_MANIFEST.json" <<'PY'
import json
import sys

def reject_duplicates(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError(f'duplicate key: {key}')
        value[key] = item
    return value

manifest = json.load(open(sys.argv[1], encoding='utf-8'), object_pairs_hook=reject_duplicates)
assert manifest['schemaVersion'] >= 2
assert {'storage', 'serviceInventory', 'secretInventory', 'protectedArtifacts'} <= manifest.keys()
ids = {item['id'] for item in manifest['criticalPersistentData']}
assert {'pubg-sqlite', 'identity-sqlite', 'product-radar-sqlite', 'owner-outbox'} <= ids
assert manifest['rebuildableState'][0]['policy'] == 'redownload'
for item in manifest['secrets']:
    assert 'value' not in item
duplicate = {'a': 1}
try:
    reject_duplicates([('a', 1), ('a', 2)])
except ValueError:
    pass
else:
    raise AssertionError('duplicate-key fixture was accepted')
assert duplicate == {'a': 1}
PY

if rg -n 'docker (stop|rm|kill)|docker network disconnect|git reset --hard' "$ROOT_DIR/scripts/migration-readiness.sh" >/dev/null; then
  printf '%s\n' 'readiness script contains a production mutation' >&2
  exit 1
fi
rg -Fq 'verify-skuld-secret-bundle.sh' "$ROOT_DIR/scripts/migration-readiness.sh"
rg -Fq 'SECRET_BUNDLE_VERIFICATION=passed' "$ROOT_DIR/scripts/verify-skuld-secret-bundle.sh"
if rg -n '1\.4\.2|rsync[^\n]*--delete' "$ROOT_DIR/scripts/migration-readiness.sh" >/dev/null; then
  printf '%s\n' 'readiness script retains a stale release or destructive sync pattern' >&2
  exit 1
fi

printf '%s\n' 'MIGRATION_READINESS_TEST=passed'
