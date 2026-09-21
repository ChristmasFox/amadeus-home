#!/usr/bin/env python3
"""Create a portable SQLite snapshot without copying a live file blindly."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('source')
    parser.add_argument('destination')
    parser.add_argument('identifier')
    args = parser.parse_args()
    source = Path(args.source)
    destination = Path(args.destination)
    if not source.is_file():
        raise SystemExit(f'source SQLite file is missing: {source}')
    destination.parent.mkdir(parents=True, exist_ok=True)
    if source.resolve() == destination.resolve():
        raise SystemExit('SQLite snapshot destination must differ from source')
    destination.unlink(missing_ok=True)
    source_uri = f'file:{source}?mode=ro'
    with sqlite3.connect(source_uri, uri=True) as source_db, sqlite3.connect(destination) as target_db:
        source_db.backup(target_db)
        result = target_db.execute('PRAGMA integrity_check').fetchone()
        if not result or result[0] != 'ok':
            raise SystemExit('SQLite integrity check failed after backup')
        tables = []
        for name, kind in target_db.execute("SELECT name, type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name"):
            tables.append({'name': name, 'type': kind})
        row_counts = {}
        for table in tables:
            if table['type'] == 'table':
                quoted = '"' + table['name'].replace('"', '""') + '"'
                row_counts[table['name']] = target_db.execute(f'SELECT COUNT(*) FROM {quoted}').fetchone()[0]
    os.chmod(destination, 0o600)
    manifest = {
        'schemaVersion': 1,
        'id': args.identifier,
        'source': str(source),
        'snapshot': str(destination),
        'backupMethod': 'sqlite-backup-api',
        'integrity': 'ok',
        'sha256': sha256(destination),
        'sizeBytes': destination.stat().st_size,
        'tables': tables,
        'rowCounts': row_counts,
        'contents': 'metadata-only-row-counts',
    }
    manifest_path = Path(str(destination) + '.manifest.json')
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    os.chmod(manifest_path, 0o600)
    print(json.dumps({k: manifest[k] for k in ('id', 'snapshot', 'integrity', 'sha256', 'sizeBytes')}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
