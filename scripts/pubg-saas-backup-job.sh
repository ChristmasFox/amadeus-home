#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

: "${PUBG_SAAS_DATABASE_URL:?load the read-only backup role URL from the protected environment}"
: "${PUBG_SAAS_BACKUP_RECIPIENTS_FILE:?set the external age recipients file}"
: "${PUBG_SAAS_BACKUP_OUTPUT_DIR:?set the external encrypted backup directory}"

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
tool="$script_dir/pubg-saas-backup-restore.py"
retention_days="${PUBG_SAAS_BACKUP_RETENTION_DAYS:-7}"

python3 "$tool" backup \
  --recipients-file "$PUBG_SAAS_BACKUP_RECIPIENTS_FILE" \
  --output-dir "$PUBG_SAAS_BACKUP_OUTPUT_DIR"

python3 "$tool" prune \
  --output-dir "$PUBG_SAAS_BACKUP_OUTPUT_DIR" \
  --confirm-output-dir "$PUBG_SAAS_BACKUP_OUTPUT_DIR" \
  --retention-days "$retention_days" \
  --apply
