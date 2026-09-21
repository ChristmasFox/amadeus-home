#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="${SKULD_ROOT_DIR:-$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/amadeus-backup-fixture.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT
python3 - "$fixture/source.sqlite" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    db.execute('CREATE TABLE events (id INTEGER PRIMARY KEY, value TEXT)')
    db.executemany('INSERT INTO events(value) VALUES (?)', [('fixture',), ('non-secret-row-count-only',)])
    db.commit()
PY
python3 "$ROOT_DIR/scripts/sqlite-consistent-snapshot.py" "$fixture/source.sqlite" "$fixture/snapshot.sqlite" pubg-sqlite >"$fixture/result.json"
python3 - "$fixture/snapshot.sqlite.manifest.json" <<'PY'
import json, sys
from pathlib import Path
v=json.loads(Path(sys.argv[1]).read_text())
assert v['integrity'] == 'ok'
assert v['backupMethod'] == 'sqlite-backup-api'
assert v['rowCounts']['events'] == 2
assert v['sizeBytes'] > 0
PY
if [[ -n "${SKULD_FIXTURE_PG_DUMP:-}" ]]; then
  pg_restore --list "$SKULD_FIXTURE_PG_DUMP" >/dev/null
  printf '%s\n' 'POSTGRES_LOGICAL_DUMP=passed'
else
  printf '%s\n' 'POSTGRES_LOGICAL_DUMP=external-fixture-required-for-live-contract'
fi
python3 - "$ROOT_DIR/docs/SERVICE_AWARE_BACKUP_REGISTRY.json" <<'PY'
import json, sys
from pathlib import Path
v=json.loads(Path(sys.argv[1]).read_text())
assert v['schemaVersion'] == 1
for item in v['entries']:
    assert {'id','backupMethod','restoreMethod','integrityCheck','classification'} <= item.keys()
print('SERVICE_AWARE_REGISTRY=passed')
PY
printf '%s\n' 'SERVICE_AWARE_BACKUP_FIXTURE=passed'
