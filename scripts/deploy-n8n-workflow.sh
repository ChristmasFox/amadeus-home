#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MACHINE="${ORBSTACK_MACHINE:-ubuntu}"
CONTAINER="${N8N_CONTAINER:-n8n}"
WORKFLOW=""
WORKFLOW_ID=""
APPLY=0
RESTART=1

usage() {
  cat <<'USAGE'
Usage: scripts/deploy-n8n-workflow.sh --workflow FILE --id ID [--dry-run] [--apply]

Export the currently published n8n workflow to the external n8n backup area,
import the Git workflow source, and re-activate the same workflow ID. The
process is dry-run by default; --apply is required for the n8n database write.
USAGE
}

while (($#)); do
  case "$1" in
    --workflow)
      (($# >= 2)) || { echo '--workflow requires a path.' >&2; exit 2; }
      WORKFLOW="$2"
      shift
      ;;
    --id)
      (($# >= 2)) || { echo '--id requires a value.' >&2; exit 2; }
      WORKFLOW_ID="$2"
      shift
      ;;
    --machine)
      (($# >= 2)) || { echo '--machine requires a value.' >&2; exit 2; }
      MACHINE="$2"
      shift
      ;;
    --container)
      (($# >= 2)) || { echo '--container requires a value.' >&2; exit 2; }
      CONTAINER="$2"
      shift
      ;;
    --dry-run) APPLY=0 ;;
    --apply) APPLY=1 ;;
    --no-restart) RESTART=0 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

[[ -n "$WORKFLOW" ]] || { echo '--workflow is required.' >&2; exit 2; }
[[ -n "$WORKFLOW_ID" ]] || { echo '--id is required.' >&2; exit 2; }
WORKFLOW_PATH="$ROOT_DIR/$WORKFLOW"
[[ -f "$WORKFLOW_PATH" ]] || { echo "Workflow source not found: $WORKFLOW_PATH" >&2; exit 1; }

printf 'MODE=%s\n' "$([[ $APPLY -eq 1 ]] && printf apply || printf dry-run)"
printf 'MACHINE=%s\n' "$MACHINE"
printf 'CONTAINER=%s\n' "$CONTAINER"
printf 'WORKFLOW=%s\n' "$WORKFLOW_PATH"
printf 'WORKFLOW_ID=%s\n' "$WORKFLOW_ID"
printf '%s\n' "PLAN=backup published workflow externally, import Git source, reactivate same ID, restart n8n=${RESTART}, verify source marker and active state."

if ((APPLY == 0)); then
  exit 0
fi

command -v orb >/dev/null 2>&1 || { echo 'orb is required.' >&2; exit 1; }
encoded="$(base64 < "$WORKFLOW_PATH" | tr -d '\n')"
remote_file="/tmp/codex-n8n-workflow-${WORKFLOW_ID}.json"
backup_name="codex-${WORKFLOW_ID}-before-$(date +%Y%m%d-%H%M%S).json"
remote_container="$(printf '%q' "$CONTAINER")"
remote_file_q="$(printf '%q' "$remote_file")"
backup_name_q="$(printf '%q' "$backup_name")"
workflow_id_q="$(printf '%q' "$WORKFLOW_ID")"

orb -m "$MACHINE" -u root docker exec "$CONTAINER" sh -lc 'mkdir -p /home/node/.n8n/workflow-backups'
backup_created=0
if orb -m "$MACHINE" -u root docker exec "$CONTAINER" n8n export:workflow \
  --id="$WORKFLOW_ID" --published --pretty \
  --output="/home/node/.n8n/workflow-backups/$backup_name"; then
  backup_created=1
else
  printf '%s\n' 'No existing workflow with this ID; importing as a new workflow without an overwrite backup.' >&2
fi

orb -m "$MACHINE" -u root docker exec "$CONTAINER" sh -lc "echo '$encoded' | base64 -d >$remote_file_q"
orb -m "$MACHINE" -u root docker exec "$CONTAINER" n8n import:workflow --input="$remote_file"
orb -m "$MACHINE" -u root docker exec "$CONTAINER" n8n update:workflow --id="$WORKFLOW_ID" --active=true
if ((RESTART)); then
  orb -m "$MACHINE" -u root docker restart "$CONTAINER"
fi
orb -m "$MACHINE" -u root docker exec "$CONTAINER" sh -lc "rm -f $remote_file_q"

orb -m "$MACHINE" -u root bash -lc "
  python3 - '$WORKFLOW_ID' <<'PY'
import json
import sqlite3
import sys
workflow_id = sys.argv[1]
con = sqlite3.connect('/DATA/AppData/n8n/database.sqlite')
row = con.execute('select name, active, nodes from workflow_entity where id = ?', (workflow_id,)).fetchone()
if row is None:
    raise SystemExit('workflow not found after import')
name, active, nodes = row
if not active:
    raise SystemExit('workflow is not active after import')
node_values = json.loads(nodes)
code = '\\n'.join(str(node.get('parameters', {}).get('jsCode', '')) for node in node_values)
if workflow_id == 'pubg-sync-matches-v3-20260902' and 'deathSemantics' not in code:
    raise SystemExit('PUBG v3 workflow did not contain the KD normalization marker')
if workflow_id == 'codex-completion-notification-20260906':
    node_names = {str(node.get('name')) for node in node_values}
    required_nodes = {'Codex Completion Webhook', 'Validate Completion', 'Format Notification', 'Send Telegram DM', 'Send KOOK DM', 'Record Delivery'}
    if not required_nodes.issubset(node_names):
        raise SystemExit('Codex notification workflow is missing required nodes')
    if 'target_type' not in code or '\$vars.TELEGRAM_ADMIN_USER_ID' not in code or '\$vars.KOOK_ADMIN_USER_ID' not in code:
        raise SystemExit('Codex notification workflow does not resolve fixed admin recipients')
print(f'Verified n8n workflow active: {name}')
PY
"
if ((backup_created)); then
  printf '%s\n' "n8n workflow deployment passed; external backup: /home/node/.n8n/workflow-backups/$backup_name"
else
  printf '%s\n' 'n8n workflow deployment passed; workflow was newly created, so no overwrite backup was required.'
fi
