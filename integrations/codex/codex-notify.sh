#!/usr/bin/env bash
# Global Codex completion hook. It is intentionally fail-open: notification
# failures must never change the Codex turn result or exit status.
set -u

CODEX_HOME_DIR="${CODEX_HOME:-${HOME:-/tmp}/.codex}"
WEBHOOK_URL="${CODEX_NOTIFY_URL:-http://127.0.0.1:5679/webhook/codex-complete}"
SECRET_FILE="${CODEX_NOTIFY_SECRET_FILE:-$CODEX_HOME_DIR/secrets/codex-notify-secret}"
LOG_FILE="${CODEX_NOTIFY_LOG_FILE:-$CODEX_HOME_DIR/logs/codex-notify.log}"

log_event() {
  local level="$1"
  local event="$2"
  local parent
  parent="$(dirname "$LOG_FILE")"
  mkdir -p "$parent" 2>/dev/null || true
  printf '%s level=%s event=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$level" "$event" >>"$LOG_FILE" 2>/dev/null || true
}

# Codex's legacy notify hook passes the JSON as argv[1]. Reading stdin as a
# fallback keeps the bridge portable across CLI versions and test harnesses.
raw_payload="${1:-}"
if [[ -z "$raw_payload" ]]; then
  raw_payload="$(cat 2>/dev/null || true)"
fi
if [[ -z "$raw_payload" ]]; then
  log_event warn payload_missing
  exit 0
fi

# Normalize both the current Codex hyphenated payload and older camel/snake
# spellings. The helper emits only the fields needed by the private bridge.
normalize_with_python() {
  python3 -c '
import datetime
import json
import pathlib
import re
import sys

try:
    payload = json.loads(sys.stdin.read())
except Exception:
    sys.exit(20)
if not isinstance(payload, dict):
    sys.exit(20)

def pick(*names):
    for name in names:
        value = payload.get(name)
        if value is not None and value != "":
            return value
    return None

event = str(pick("event", "type", "event_name") or "")
if event != "agent-turn-complete":
    sys.exit(10)
thread_id = str(pick("threadId", "thread_id", "thread-id") or "").strip()
turn_id = str(pick("turnId", "turn_id", "turn-id") or "").strip()
cwd = str(pick("cwd", "workingDirectory", "working_directory") or "").strip()
if not thread_id or not turn_id or not cwd:
    sys.exit(21)

project = pathlib.PurePath(cwd.rstrip("/")).name or "unknown-project"
project = re.sub(r"[^A-Za-z0-9._-]+", "_", project).strip("._-")[:80] or "unknown-project"
message = str(pick("lastAssistantMessage", "last_assistant_message", "last-assistant-message") or "").strip()
# Completion text is user-visible but must not become a credential transport.
redactions = [
    (r"(?i)\bBearer\s+[A-Za-z0-9._-]{16,}", "Bearer [REDACTED]"),
    (r"\bsk-[A-Za-z0-9_-]{16,}\b", "[REDACTED]"),
    (r"\bgh[pousr]_[A-Za-z0-9_]{16,}\b", "[REDACTED]"),
    (r"\bxox[baprs]-[A-Za-z0-9-]{16,}\b", "[REDACTED]"),
    (r"(?i)(api[_-]?key|access[_-]?token|bot[_-]?token|app[_-]?secret|jwt[_-]?secret|password)\s*[:=]\s*[^\s,;]+", r"\1=[REDACTED]"),
]
for pattern, replacement in redactions:
    message = re.sub(pattern, replacement, message)
message = message[:8000]
timestamp = str(pick("timestamp", "completedAt", "completed_at") or "").strip()
if not timestamp:
    timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")

result = {
    "event": event,
    "threadId": thread_id,
    "turnId": turn_id,
    "cwd": cwd,
    "projectName": project,
    "lastAssistantMessage": message,
    "timestamp": timestamp,
}
print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
'
}

normalized_payload=""
if command -v python3 >/dev/null 2>&1; then
  normalized_payload="$(printf '%s' "$raw_payload" | normalize_with_python 2>/dev/null)"
  normalize_status=$?
else
  normalize_status=20
fi

case "$normalize_status" in
  0) ;;
  10)
    log_event info event_ignored
    exit 0
    ;;
  *)
    log_event warn payload_invalid
    exit 0
    ;;
esac

secret="${CODEX_NOTIFY_SECRET:-}"
if [[ -z "$secret" && -r "$SECRET_FILE" ]]; then
  IFS= read -r secret <"$SECRET_FILE" || true
fi
secret="${secret//$'\r'/}"
if [[ -z "$secret" ]]; then
  log_event warn secret_not_configured
  exit 0
fi
if ! command -v curl >/dev/null 2>&1; then
  log_event warn curl_unavailable
  exit 0
fi

# --connect-timeout and --max-time are the timeout boundary. Curl output and
# response bodies are discarded so secrets/errors cannot reach Codex stdout.
http_code="$(printf '%s' "$normalized_payload" | curl \
  --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --connect-timeout 2 --max-time 5 \
  -H 'Content-Type: application/json' \
  -H "X-Codex-Notify-Secret: $secret" \
  --data-binary @- "$WEBHOOK_URL" 2>/dev/null)"
curl_status=$?
if [[ "$curl_status" -eq 0 && "$http_code" =~ ^2[0-9][0-9]$ ]]; then
  log_event info webhook_sent
else
  log_event warn webhook_failed
fi
exit 0
