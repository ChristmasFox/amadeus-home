#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${SKULD_ROOT_DIR:-$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT_DIR"
MACHINE="${ORBSTACK_MACHINE:-ubuntu}"
OUTPUT_DIR=''
TEST_MODE="${SERVICE_AWARE_BACKUP_TEST_MODE:-0}"
FIXTURE_ROOT="${SERVICE_AWARE_BACKUP_FIXTURE_ROOT:-}"

while (($#)); do
  case "$1" in
    --output-dir) shift; OUTPUT_DIR="${1:?--output-dir requires a path}" ;;
    --machine) shift; MACHINE="${1:?--machine requires a name}" ;;
    --help|-h) printf '%s\n' 'Usage: scripts/service-aware-backup.sh --output-dir DIR [--machine NAME]'; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done
: "${OUTPUT_DIR:?--output-dir is required}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUTPUT_DIR/sqlite" "$OUTPUT_DIR/immich" "$OUTPUT_DIR/9router"
chmod 700 "$OUTPUT_DIR" "$OUTPUT_DIR/sqlite" "$OUTPUT_DIR/immich" "$OUTPUT_DIR/9router"

manifest_tmp="$(mktemp "${TMPDIR:-/tmp}/service-aware-backup.XXXXXX")"
trap 'rm -f "$manifest_tmp"' EXIT

write_manifest() {
  python3 - "$manifest_tmp" "$OUTPUT_DIR" "$stamp" <<'PY'
import json, sys
from pathlib import Path
path, root, stamp = map(Path, sys.argv[1:])
entries=[]
for item in sorted(root.rglob('*')):
    if item.is_file() and item.name != 'service-aware-manifest.json':
        entries.append({'path': str(item.relative_to(root)), 'sizeBytes': item.stat().st_size})
value={
    'schemaVersion': 1,
    'createdAtUtc': stamp.name if stamp.name else str(stamp),
    'backupMode': 'service-aware',
    'artifacts': entries,
    'sqlite': [],
    'postgresql': {'status': 'not-created'},
    'nineRouter': {'status': 'reference-only'},
}
path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
PY
}

snapshot_local() {
  local id="$1" source="$2"
  [[ -f "$source" ]] || { printf 'BACKUP_MISSING_SQLITE=%s\n' "$source" >&2; return 1; }
  python3 "$ROOT_DIR/scripts/sqlite-consistent-snapshot.py" "$source" "$OUTPUT_DIR/sqlite/$id.sqlite" "$id" >"$OUTPUT_DIR/sqlite/$id.result.json"
}

if ((TEST_MODE)); then
  : "${FIXTURE_ROOT:?SERVICE_AWARE_BACKUP_FIXTURE_ROOT is required in test mode}"
  snapshot_local pubg-sqlite "$FIXTURE_ROOT/openclaw/data/pubg.sqlite"
  snapshot_local identity-sqlite "$FIXTURE_ROOT/openclaw/data/identity.sqlite"
  snapshot_local product-radar-sqlite "$FIXTURE_ROOT/product-radar/product-radar.sqlite"
  if [[ -s "$FIXTURE_ROOT/immich-postgres.dump" ]]; then
    cp -p "$FIXTURE_ROOT/immich-postgres.dump" "$OUTPUT_DIR/immich/postgres-$stamp.dump"
    pg_restore --list "$OUTPUT_DIR/immich/postgres-$stamp.dump" >"$OUTPUT_DIR/immich/postgres-$stamp.list"
    shasum -a 256 "$OUTPUT_DIR/immich/postgres-$stamp.dump" | awk '{print $1 "  " $2}' >"$OUTPUT_DIR/immich/postgres-$stamp.dump.sha256"
  fi
  if [[ -d "$FIXTURE_ROOT/9router" ]]; then tar -C "$FIXTURE_ROOT/9router" -czf "$OUTPUT_DIR/9router/9router-fixture.tar.gz" .; fi
else
  command -v orb >/dev/null 2>&1 || { printf '%s\n' 'OrbStack CLI not found' >&2; exit 1; }
  for spec in \
    'pubg-sqlite|/DATA/AppData/openclaw/data/pubg.sqlite' \
    'identity-sqlite|/DATA/AppData/openclaw/data/identity.sqlite' \
    'product-radar-sqlite|/DATA/AppData/product-radar/product-radar.sqlite'; do
    id="${spec%%|*}"; source="${spec#*|}"
    orb -m "$MACHINE" -u root bash -s -- "$source" "$id" <<'REMOTE' | tar -xzf - -C "$OUTPUT_DIR/sqlite"
set -Eeuo pipefail
source_path="$1"
id="$2"
tmp="$(mktemp -d /tmp/skuld-sqlite.XXXXXX)"
trap 'rm -rf "$tmp"' EXIT
python3 - "$source_path" "$tmp/$id.sqlite" "$id" <<'PY'
import hashlib, json, os, sqlite3, sys
from pathlib import Path
source, destination, identifier = sys.argv[1:]
with sqlite3.connect('file:' + source + '?mode=ro', uri=True) as src, sqlite3.connect(destination) as dst:
    src.backup(dst)
    if dst.execute('PRAGMA integrity_check').fetchone()[0] != 'ok': raise SystemExit('sqlite integrity failed')
    tables=[]
    for name, kind in dst.execute("SELECT name,type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name"):
        tables.append({'name': name, 'type': kind})
    row_counts={}
    for item in tables:
        if item['type']=='table':
            quoted='"'+item['name'].replace('"','""')+'"'
            row_counts[item['name']]=dst.execute(f'SELECT COUNT(*) FROM {quoted}').fetchone()[0]
os.chmod(destination, 0o600)
digest=hashlib.sha256(Path(destination).read_bytes()).hexdigest()
Path(destination + '.manifest.json').write_text(json.dumps({'id':identifier,'snapshot':destination,'backupMethod':'sqlite-backup-api','integrity':'ok','sha256':digest,'sizeBytes':Path(destination).stat().st_size,'tables':tables,'rowCounts':row_counts}, indent=2)+'\n')
os.chmod(destination + '.manifest.json', 0o600)
PY
tar -C "$tmp" -czf - .
REMOTE
  done
  pg_dump_path="$OUTPUT_DIR/immich/postgres-$stamp.dump"
  orb -m "$MACHINE" -u root docker exec immich-postgres sh -lc 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >"$pg_dump_path"
  chmod 600 "$pg_dump_path"
  pg_restore --list "$pg_dump_path" >"$OUTPUT_DIR/immich/postgres-$stamp.list"
  shasum -a 256 "$pg_dump_path" | awk '{print $1 "  " $2}' >"$pg_dump_path.sha256"
  latest_9router="$(find "${SKULD_BACKUP_ROOT:-$EXTERNAL_STORAGE_ROOT/backups/operation-skuld}/9router" -maxdepth 1 -type f -name '9router-*.tar.gz' -print 2>/dev/null | sort | tail -n 1 || true)"
  if [[ -n "$latest_9router" ]]; then cp -p "$latest_9router" "$OUTPUT_DIR/9router/$(basename "$latest_9router")"; fi
fi

python3 - "$OUTPUT_DIR" "$manifest_tmp" "$stamp" <<'PY'
import hashlib, json, sys
from pathlib import Path
root = Path(sys.argv[1])
target = Path(sys.argv[2])
stamp = sys.argv[3]
entries=[]
for item in sorted(root.rglob('*')):
    if item.is_file() and item.name != 'service-aware-manifest.json':
        entries.append({'path': str(item.relative_to(root)), 'sizeBytes': item.stat().st_size, 'sha256': hashlib.sha256(item.read_bytes()).hexdigest()})
sqlite=[x for x in entries if x['path'].startswith('sqlite/') and x['path'].endswith('.manifest.json')]
pg=[x for x in entries if x['path'].startswith('immich/postgres-') and x['path'].endswith('.dump')]
router=[x for x in entries if x['path'].startswith('9router/') and x['path'].endswith('.tar.gz')]
value={
  'schemaVersion': 2,
  'createdAtUtc': stamp,
  'backupMode': 'service-aware',
  'artifacts': entries,
  'sqlite': sqlite,
  'postgresql': {'status': 'passed' if pg else 'not-created', 'logicalDump': pg[0] if pg else None, 'restoreList': any(x['path'].endswith('.list') for x in entries)},
  'nineRouter': {'status': 'passed' if router else 'reference-only', 'exactArtifact': router[0] if router else None},
  'immichMediaPolicy': {'root': 'host-profile:IMMICH_MEDIA_ROOT', 'portableArchive': False, 'sourceReclaim': 'pending'},
}
target.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
target.chmod(0o600)
PY
mv "$manifest_tmp" "$OUTPUT_DIR/service-aware-manifest.json"
chmod 600 "$OUTPUT_DIR/service-aware-manifest.json"
printf 'SERVICE_AWARE_BACKUP=passed\nMANIFEST=%s\n' "$OUTPUT_DIR/service-aware-manifest.json"
