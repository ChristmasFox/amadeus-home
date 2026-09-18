#!/usr/bin/env bash
# Codex completion/failure hook. Fail-open by design: a notification problem
# must never change the Codex turn result or exit status.
set -u

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
if [[ -x "$ROOT_DIR/scripts/notify-owner.sh" ]]; then
  NOTIFY_SCRIPT="$ROOT_DIR/scripts/notify-owner.sh"
elif [[ -x "$ROOT_DIR/agent-monorepo/scripts/notify-owner.sh" ]]; then
  NOTIFY_SCRIPT="$ROOT_DIR/agent-monorepo/scripts/notify-owner.sh"
else
  exit 0
fi
OUTBOX_DIR="${OWNER_NOTIFICATION_OUTBOX_DIR:-${CODEX_NOTIFICATION_OUTBOX_DIR:-/tmp/openclaw-owner-notifications}}"
LOG_FILE="${CODEX_NOTIFY_LOG_FILE:-/tmp/openclaw-codex-notify.log}"
raw_payload="${1:-}"
if [[ -z "$raw_payload" ]]; then raw_payload="$(cat 2>/dev/null || true)"; fi
if [[ -z "$raw_payload" ]]; then exit 0; fi

mkdir -p "$(dirname -- "$LOG_FILE")" 2>/dev/null || true

python3 - "$NOTIFY_SCRIPT" "$OUTBOX_DIR" "$raw_payload" "$LOG_FILE" <<'PY' >/dev/null 2>&1 || true
import datetime
import json
import pathlib
import re
import subprocess
import sys

notify_script, outbox, raw, log_file = sys.argv[1:]
try:
    payload = json.loads(raw)
except Exception:
    raise SystemExit(0)
if not isinstance(payload, dict):
    raise SystemExit(0)

def pick(*names):
    for name in names:
        value = payload.get(name)
        if value is not None and value != "":
            return value
    return None

event = str(pick("event", "type", "event_name") or "agent-turn-complete").strip().lower()
allowed = {"agent-turn-complete", "agent-turn-failed", "agent-turn-error", "agent-turn-cancelled", "turn-failed", "turn-error"}
if event not in allowed:
    raise SystemExit(0)

thread_id = str(pick("threadId", "thread_id", "thread-id") or "").strip()
turn_id = str(pick("turnId", "turn_id", "turn-id", "runId", "run_id") or "").strip()
cwd = str(pick("cwd", "workingDirectory", "working_directory") or "").strip()
project = pathlib.PurePath(cwd.rstrip("/")).name if cwd else "unknown-project"
project = re.sub(r"[^A-Za-z0-9._-]+", "_", project).strip("._-")[:80] or "unknown-project"
status = str(pick("status", "result", "outcome") or ("completed" if event == "agent-turn-complete" else "failed"))
message = str(pick("lastAssistantMessage", "last_assistant_message", "last-assistant-message", "error", "errorMessage") or "").strip()
for pattern, replacement in [
    (r"(?i)\bBearer\s+[A-Za-z0-9._-]{16,}", "Bearer [REDACTED]"),
    (r"\bsk-[A-Za-z0-9_-]{16,}\b", "[REDACTED]"),
    (r"\bgh[pousr]_[A-Za-z0-9_]{16,}\b", "[REDACTED]"),
    (r"\bxox[baprs]-[A-Za-z0-9-]{16,}\b", "[REDACTED]"),
    (r"(?i)(api[_-]?key|access[_-]?token|bot[_-]?token|app[_-]?secret|password)\s*[:=]\s*[^\s,;]+", r"\1=[REDACTED]"),
]:
    message = re.sub(pattern, replacement, message)
message = message[:8000]
if not message:
    message = f"Codex turn {status}。"
timestamp = str(pick("timestamp", "completedAt", "completed_at") or datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"))
identity = ":".join(part for part in (event, project, thread_id, turn_id, timestamp) if part)
title = "Codex 完成" if event == "agent-turn-complete" else "Codex 失败"
body = f"项目：{project}\n状态：{status}\n时间：{timestamp}\n"
if thread_id:
    body += f"线程：{thread_id}\n"
body += f"\n{message}"
subprocess.run([notify_script, "--event-key", f"codex:{identity}", "--source", "codex", "--title", title, "--message", body, "--outbox-dir", "/DATA/AppData/openclaw/notifications", "--remote-machine", os.environ.get("OPENCLAW_REMOTE_MACHINE", "ubuntu")], timeout=5, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    with open(log_file, "a", encoding="utf-8") as handle:
        handle.write(f"{timestamp} event={event} project={project}\n")
except Exception:
    pass
PY
exit 0
