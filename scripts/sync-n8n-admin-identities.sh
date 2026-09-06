#!/usr/bin/env bash
set -euo pipefail

MACHINE="${ORBSTACK_MACHINE:-ubuntu}"
ENV_FILE="${ADMIN_IDENTITY_ENV_FILE:-/DATA/AppData/pubg-query-engine-v3/admin-identity.env}"
DB_FILE="${N8N_DB_FILE:-/DATA/AppData/n8n/database.sqlite}"
SECRET_FILE="${CODEX_NOTIFY_SECRET_FILE:-/DATA/AppData/n8n/secrets/codex-notify-secret}"
CONTAINER="${N8N_CONTAINER:-n8n}"
APPLY=0

usage() {
  cat <<'USAGE'
Usage: scripts/sync-n8n-admin-identities.sh [--dry-run] [--apply]

Copy externally restored Telegram/KOOK admin identities and the Codex notify
shared secret into n8n's global variables, without printing values. The database
is backed up with SQLite's online backup API and n8n is restarted after an
apply. The default is a dry-run.
USAGE
}

while (($#)); do
  case "$1" in
    --dry-run) APPLY=0 ;;
    --apply) APPLY=1 ;;
    --machine)
      (($# >= 2)) || { echo '--machine requires a value.' >&2; exit 2; }
      MACHINE="$2"
      shift
      ;;
    --env-file)
      (($# >= 2)) || { echo '--env-file requires a path.' >&2; exit 2; }
      ENV_FILE="$2"
      shift
      ;;
    --db-file)
      (($# >= 2)) || { echo '--db-file requires a path.' >&2; exit 2; }
      DB_FILE="$2"
      shift
      ;;
    --secret-file)
      (($# >= 2)) || { echo '--secret-file requires a path.' >&2; exit 2; }
      SECRET_FILE="$2"
      shift
      ;;
    --container)
      (($# >= 2)) || { echo '--container requires a value.' >&2; exit 2; }
      CONTAINER="$2"
      shift
      ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

printf 'MODE=%s\n' "$([[ $APPLY -eq 1 ]] && printf apply || printf dry-run)"
printf 'MACHINE=%s\n' "$MACHINE"
printf 'ENV_FILE=%s\n' "$ENV_FILE"
printf 'DB_FILE=%s\n' "$DB_FILE"
printf 'SECRET_FILE=%s\n' "$SECRET_FILE"
printf 'CONTAINER=%s\n' "$CONTAINER"
printf '%s\n' 'PLAN=read external admin identities and shared secret without outputting values, backup n8n DB, upsert global n8n variables, restart n8n.'

if ((APPLY == 0)); then
  exit 0
fi

patch_source="$(cat <<'PY'
from pathlib import Path
import datetime
import sqlite3
import shutil
import sys
import uuid

source = Path(sys.argv[1])
database = Path(sys.argv[2])
secret_file = Path(sys.argv[3])
stamp = sys.argv[4]
required = ('TELEGRAM_ADMIN_USER_ID', 'KOOK_ADMIN_USER_ID')
values = {}
for raw_line in source.read_text().splitlines():
    line = raw_line.strip()
    if not line or line.startswith('#') or '=' not in line:
        continue
    key, value = line.split('=', 1)
    if key in required:
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        values[key] = value
missing = [key for key in required if not values.get(key)]
if missing:
    raise SystemExit('missing required admin identity values in external env file: ' + ', '.join(missing))
if any('\n' in value or '\r' in value for value in values.values()):
    raise SystemExit('admin identity values must be single-line')
if not secret_file.is_file():
    raise SystemExit('missing external Codex notify secret file')
secret = secret_file.read_text().strip()
if len(secret) < 32 or '\n' in secret or '\r' in secret:
    raise SystemExit('Codex notify secret must be at least 32 single-line characters')
values['CODEX_NOTIFY_SECRET'] = secret

backup = database.with_name(database.name + '.codex-backup.' + stamp)
source_db = sqlite3.connect(database)
backup_db = sqlite3.connect(backup)
try:
    source_db.backup(backup_db)
finally:
    backup_db.close()

try:
    source_db.execute('BEGIN IMMEDIATE')
    for key, value in values.items():
        row = source_db.execute(
            'select id from variables where key = ? and projectId is null',
            (key,),
        ).fetchone()
        if row:
            source_db.execute(
                'update variables set type = ?, value = ? where id = ?',
                ('string', value, row[0]),
            )
        else:
            source_db.execute(
                'insert into variables (id, key, type, value, projectId) values (?, ?, ?, ?, null)',
                (str(uuid.uuid4()), key, 'string', value),
            )
    source_db.commit()
finally:
    source_db.close()

print('SYNCED_KEYS=' + str(len(values)))
print('BACKUP_DB=' + str(backup))
PY
)"
encoded="$(printf '%s' "$patch_source" | base64 | tr -d '\n')"
remote_env="$(printf '%q' "$ENV_FILE")"
remote_db="$(printf '%q' "$DB_FILE")"
remote_secret="$(printf '%q' "$SECRET_FILE")"
orb -m "$MACHINE" -u root bash -lc "
  set -euo pipefail
  test -f $remote_env
  test -f $remote_db
  echo '$encoded' | base64 -d >/tmp/sync-n8n-admin-identities.py
  python3 /tmp/sync-n8n-admin-identities.py $remote_env $remote_db $remote_secret \"\$(date +%Y%m%d-%H%M%S)\"
  rm -f /tmp/sync-n8n-admin-identities.py
"
orb -m "$MACHINE" -u root docker restart "$CONTAINER" >/dev/null
printf '%s\n' 'n8n restarted after admin identity and Codex notify configuration sync; values were not printed.'
