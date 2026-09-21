#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="${SKULD_ROOT_DIR:-$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
MANIFEST="${SKULD_MANIFEST:-$ROOT_DIR/docs/OPERATION_SKULD_MIGRATION_MANIFEST.json}"
RUNBOOK="${SKULD_RUNBOOK:-$ROOT_DIR/docs/OPERATION_SKULD_MAC_MINI_MIGRATION_RUNBOOK.md}"
python3 - "$MANIFEST" "$RUNBOOK" <<'PY'
import json
import re
import sys
from pathlib import Path
manifest_path, runbook_path = map(Path, sys.argv[1:])
def no_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f'duplicate key: {key}')
        result[key] = value
    return result
manifest = json.loads(manifest_path.read_text(), object_pairs_hook=no_duplicates)
runbook = runbook_path.read_text()
errors = []
if manifest.get('operation') != 'operation-skuld': errors.append('manifest operation mismatch')
for item in manifest.get('criticalPersistentData', []):
    item_id = item.get('id')
    if not item_id or item_id not in runbook:
        errors.append(f'missing runbook restore step for critical data: {item_id}')
for item in manifest.get('secrets', []):
    item_id = item.get('id')
    if item.get('required') and (not item_id or item_id not in runbook):
        errors.append(f'missing runbook secret restore step: {item_id}')
for item in manifest.get('runtimeInfrastructure', []):
    item_id = item.get('id')
    if item.get('classification') in {'ACTIVE', 'COMPATIBILITY'} and (not item_id or item_id not in runbook):
        errors.append(f'missing runbook service restore step: {item_id}')
allowed = {'MIGRATE', 'REBUILD', 'EXTERNAL_DATA', 'DROP', 'MANUAL_BLOCKER'}
for item in manifest.get('serviceInventory', {}).get('services', []):
    if item.get('classification') not in allowed:
        errors.append(f'invalid service classification: {item.get("id")}')
if 'Mac mini cutover' not in runbook and 'cutover' not in runbook.lower():
    errors.append('runbook has no cutover boundary')
if errors:
    for error in errors: print(f'SKULD_CONSISTENCY_FAIL={error}', file=sys.stderr)
    raise SystemExit(1)
print('SKULD_MANIFEST_RUNBOOK_CONSISTENCY=passed')
PY
