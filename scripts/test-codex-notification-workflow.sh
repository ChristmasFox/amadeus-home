#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW="$ROOT_DIR/integrations/n8n/workflows/codex-completion-notification.workflow.json"

command -v python3 >/dev/null 2>&1 || { echo 'python3 is required.' >&2; exit 1; }
python3 - "$WORKFLOW" <<'PY'
import json
import sys
from pathlib import Path

workflow = json.loads(Path(sys.argv[1]).read_text())
nodes = {node['name']: node for node in workflow['nodes']}
required = {
    'Codex Completion Webhook', 'Validate Completion', 'Valid Completion?',
    'Read Idempotency Key', 'Resolve Idempotency', 'Already Seen?',
    'Claim Completion', 'Format Notification', 'Send Telegram DM',
    'Send KOOK DM', 'Record Delivery', 'Respond Accepted',
    'Respond Duplicate', 'Respond Rejected',
}
missing = required - nodes.keys()
assert not missing, missing
assert workflow['connections']['Valid Completion?']['main'][0][0]['node'] == 'Read Idempotency Key'
assert workflow['connections']['Valid Completion?']['main'][1][0]['node'] == 'Respond Rejected'
assert workflow['connections']['Already Seen?']['main'][0][0]['node'] == 'Respond Duplicate'
assert workflow['connections']['Already Seen?']['main'][1][0]['node'] == 'Claim Completion'
assert nodes['Send Telegram DM']['continueOnFail'] is True
assert nodes['Send KOOK DM']['continueOnFail'] is True
validate = nodes['Validate Completion']['parameters']['jsCode']
format_code = nodes['Format Notification']['parameters']['jsCode']
record_code = nodes['Record Delivery']['parameters']['jsCode']
assert "agent-turn-complete" in validate
assert "CODEX_NOTIFY_SECRET" in validate
assert "threadId" in validate and "turnId" in validate
assert "$vars.TELEGRAM_ADMIN_USER_ID" in validate
assert "$vars.KOOK_ADMIN_USER_ID" in validate
assert "body.recipient" not in format_code
assert "$vars.TELEGRAM_ADMIN_USER_ID" in format_code
assert "$vars.KOOK_ADMIN_USER_ID" in format_code
assert "target_type: 'person'" in format_code
assert "status: sent ? 'sent' : 'failed'" in record_code
assert "platform_request_failed" in record_code
assert nodes['Send Telegram DM']['parameters']['url'].endswith('/e2ff1900-fd8a-4ad5-9e99-6cae6afdb831/send_message')
assert nodes['Send KOOK DM']['parameters']['url'].endswith('/2f25e57b-6157-458d-99e4-db411ddc85d4/send_message')
assert nodes['Read Idempotency Key']['parameters']['dataTableId']['value'] == 'codex-completion-idempotency-20260906'
assert nodes['Claim Completion']['parameters']['operation'] == 'insert'

# Model the small deterministic delivery recorder used by the workflow. The
# HTTP nodes' continueOnFail flags make either platform failure independent.
def delivery(value):
    value = value or {}
    status_code = int(value.get('statusCode') or 0)
    body = value.get('body') if isinstance(value.get('body'), dict) else value
    error = value.get('error') or body.get('error')
    sent = not error and ((200 <= status_code < 300) or body.get('data', {}).get('sent') is True or body.get('sent') is True)
    return 'sent' if sent else 'failed'

assert delivery({'statusCode': 200, 'body': {'data': {'sent': True}}}) == 'sent'
assert delivery({'error': 'transport'}) == 'failed'
assert (delivery({'error': 'telegram'}), delivery({'statusCode': 200, 'body': {'data': {'sent': True}}})) == ('failed', 'sent')
assert (delivery({'statusCode': 200, 'body': {'data': {'sent': True}}}), delivery({'error': 'kook'})) == ('sent', 'failed')
print('Codex n8n workflow static smoke passed: completion filter, fixed person recipients, idempotency table, and independent delivery statuses.')
PY
