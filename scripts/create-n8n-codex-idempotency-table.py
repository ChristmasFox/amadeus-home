#!/usr/bin/env python3
from pathlib import Path
import sqlite3
import sys
import uuid

path = Path(sys.argv[1])
table_id = sys.argv[2]
table_name = sys.argv[3]
stamp = sys.argv[4]
if not table_id.replace('-', '').replace('_', '').isalnum():
    raise SystemExit('table ID contains unsupported characters')
if not table_name.replace('_', '').isalnum():
    raise SystemExit('table name contains unsupported characters')

con = sqlite3.connect(path)
backup = path.with_name(path.name + '.codex-backup.' + stamp)
backup_con = sqlite3.connect(backup)
try:
    con.backup(backup_con)
finally:
    backup_con.close()

physical = 'data_table_user_' + table_id
quoted_physical = '"' + physical.replace('"', '""') + '"'
try:
    con.execute('BEGIN IMMEDIATE')
    project = con.execute('select id from project order by createdAt limit 1').fetchone()
    if project is None:
        raise SystemExit('no n8n project exists')
    existing = con.execute('select id,name,projectId from data_table where id=?', (table_id,)).fetchone()
    if existing is None:
        columns = [
            ('eventKey', 0), ('receivedAt', 1), ('threadId', 2),
            ('turnId', 3), ('projectName', 4), ('timestamp', 5),
        ]
        con.execute('insert into data_table (id,name,projectId) values (?,?,?)', (table_id, table_name, project[0]))
        for name, index in columns:
            con.execute(
                'insert into data_table_column (id,name,type,"index",dataTableId) values (?,?,?,?,?)',
                (str(uuid.uuid4()), name, 'string', index, table_id),
            )
        con.execute(
            f'''create table {quoted_physical} (
                "id" integer primary key not null,
                "eventKey" text,
                "receivedAt" text,
                "threadId" text,
                "turnId" text,
                "projectName" text,
                "timestamp" text,
                "createdAt" datetime(3) not null default (STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')),
                "updatedAt" datetime(3) not null default (STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW'))
            )''',
        )
        con.execute(f'create unique index "idx_{table_id}_eventKey" on {quoted_physical}("eventKey")')
        print('TABLE_CREATED=true')
    else:
        columns = {row[0] for row in con.execute('select name from data_table_column where dataTableId=?', (table_id,))}
        expected = {'eventKey', 'receivedAt', 'threadId', 'turnId', 'projectName', 'timestamp'}
        if columns != expected:
            raise SystemExit('existing idempotency table has an unexpected schema')
        if con.execute("select name from sqlite_master where type='table' and name=?", (physical,)).fetchone() is None:
            raise SystemExit('metadata exists but physical Data Table is missing')
        print('TABLE_ALREADY_CONFIGURED=true')
    con.commit()
finally:
    con.close()
print('BACKUP_DB=' + str(backup))
