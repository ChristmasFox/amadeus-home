#!/usr/bin/env bash
# Write one channel-free owner event to the OpenClaw notification outbox.
# The OpenClaw Amadeus plugin is the only component that performs owner delivery.
set -u

OUTBOX_DIR="${OWNER_NOTIFICATION_OUTBOX_DIR:-${CODEX_NOTIFICATION_OUTBOX_DIR:-/tmp/openclaw-owner-notifications}}"
REMOTE_MACHINE=""
EVENT_KEY=""
SOURCE=""
HEADLINE=""
SUMMARY=""
SEVERITY="info"
SIGNIFICANCE="notable"
THEME="worldline_observation"
FACT_LABEL=""
FACT_VALUE=""
WORLD_LINE_CLOSING=0

usage() {
  cat <<'USAGE'
Usage: scripts/notify-owner.sh --event-key KEY --source SOURCE --headline HEADLINE --summary SUMMARY [--severity LEVEL] [--significance LEVEL] [--theme THEME] [--fact-label LABEL --fact-value VALUE] [--worldline-closing] [--outbox-dir DIR] [--remote-machine NAME]

The command only creates an idempotent local event. It has no channel,
recipient, bot token, or network option.
USAGE
}

while (($#)); do
  case "$1" in
    --event-key) (($# >= 2)) || { usage >&2; exit 2; }; EVENT_KEY="$2"; shift 2 ;;
    --source) (($# >= 2)) || { usage >&2; exit 2; }; SOURCE="$2"; shift 2 ;;
    --headline) (($# >= 2)) || { usage >&2; exit 2; }; HEADLINE="$2"; shift 2 ;;
    --summary) (($# >= 2)) || { usage >&2; exit 2; }; SUMMARY="$2"; shift 2 ;;
    --severity) (($# >= 2)) || { usage >&2; exit 2; }; SEVERITY="$2"; shift 2 ;;
    --significance) (($# >= 2)) || { usage >&2; exit 2; }; SIGNIFICANCE="$2"; shift 2 ;;
    --theme) (($# >= 2)) || { usage >&2; exit 2; }; THEME="$2"; shift 2 ;;
    --fact-label) (($# >= 2)) || { usage >&2; exit 2; }; FACT_LABEL="$2"; shift 2 ;;
    --fact-value) (($# >= 2)) || { usage >&2; exit 2; }; FACT_VALUE="$2"; shift 2 ;;
    --worldline-closing) WORLD_LINE_CLOSING=1; shift ;;
    --outbox-dir) (($# >= 2)) || { usage >&2; exit 2; }; OUTBOX_DIR="$2"; shift 2 ;;
    --remote-machine) (($# >= 2)) || { usage >&2; exit 2; }; REMOTE_MACHINE="$2"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -z "$EVENT_KEY" || -z "$SOURCE" || -z "$SUMMARY" ]]; then
  usage >&2
  exit 2
fi

if ! command -v python3 >/dev/null 2>&1; then
  exit 0
fi

if [[ -n "$REMOTE_MACHINE" ]]; then
  if ! command -v orb >/dev/null 2>&1; then exit 0; fi
  orb -m "$REMOTE_MACHINE" -u root python3 - "$OUTBOX_DIR" "$EVENT_KEY" "$SOURCE" "$HEADLINE" "$SUMMARY" "$SEVERITY" "$SIGNIFICANCE" "$THEME" "$FACT_LABEL" "$FACT_VALUE" "$WORLD_LINE_CLOSING" <<'PY' >/dev/null 2>&1 || true
import hashlib
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

outbox, event_key, source, headline, summary, severity, significance, theme, fact_label, fact_value, closing_flag = sys.argv[1:]
def clean(value: str, limit: int) -> str:
    return value.replace("\x00", "").replace("\r", "").strip()[:limit]

clean_summary = clean(summary, 16000)
world_line_closing = closing_flag == "1" or clean_summary.endswith("El Psy Kongroo.")
clean_summary = clean_summary[:-len("El Psy Kongroo.")].rstrip() if clean_summary.endswith("El Psy Kongroo.") else clean_summary
facts = []
if clean(fact_label, 200) and clean(fact_value, 1000):
    facts.append({"label": clean(fact_label, 200), "value": clean(fact_value, 1000), "evidenceRefs": []})
event = {
    "version": 1,
    "type": "owner_notification",
    "eventType": clean(source, 128),
    "severity": clean(severity, 32),
    "significance": clean(significance, 32),
    "theme": clean(theme, 64),
    "eventKey": clean(event_key, 256),
    "source": clean(source, 128),
    "headline": clean(headline, 200) or clean(source, 128),
    "facts": facts,
    "summary": clean_summary,
    "occurredAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    **({"worldLineClosing": True} if world_line_closing else {}),
}
if not event["eventKey"] or not event["source"] or not event["summary"]:
    raise SystemExit(2)
directory = Path(outbox)
directory.mkdir(parents=True, exist_ok=True)
os.chmod(directory, 0o700)
os.chown(directory, 1000, 1000)
event_id = hashlib.sha256(event["eventKey"].encode()).hexdigest()[:40]
pending = directory / f"{event_id}.pending.json"
sent = directory / f"{event_id}.sent.json"
if pending.exists() or sent.exists():
    raise SystemExit(0)
fd, temporary = tempfile.mkstemp(prefix=f".{event_id}.", suffix=".tmp", dir=directory)
try:
    os.fchmod(fd, 0o600)
    os.chown(temporary, 1000, 1000)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(event, handle, ensure_ascii=False, separators=(",", ":"))
        handle.write("\n")
    os.replace(temporary, pending)
except Exception:
    try:
        os.unlink(temporary)
    except FileNotFoundError:
        pass
    if not pending.exists():
        raise
PY
  exit 0
fi

python3 - "$OUTBOX_DIR" "$EVENT_KEY" "$SOURCE" "$HEADLINE" "$SUMMARY" "$SEVERITY" "$SIGNIFICANCE" "$THEME" "$FACT_LABEL" "$FACT_VALUE" "$WORLD_LINE_CLOSING" <<'PY'
import hashlib
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

outbox, event_key, source, headline, summary, severity, significance, theme, fact_label, fact_value, closing_flag = sys.argv[1:]
def clean(value: str, limit: int) -> str:
    return value.replace("\x00", "").replace("\r", "").strip()[:limit]

clean_summary = clean(summary, 16000)
world_line_closing = closing_flag == "1" or clean_summary.endswith("El Psy Kongroo.")
clean_summary = clean_summary[:-len("El Psy Kongroo.")].rstrip() if clean_summary.endswith("El Psy Kongroo.") else clean_summary
facts = []
if clean(fact_label, 200) and clean(fact_value, 1000):
    facts.append({"label": clean(fact_label, 200), "value": clean(fact_value, 1000), "evidenceRefs": []})
event = {
    "version": 1,
    "type": "owner_notification",
    "eventType": clean(source, 128),
    "severity": clean(severity, 32),
    "significance": clean(significance, 32),
    "theme": clean(theme, 64),
    "eventKey": clean(event_key, 256),
    "source": clean(source, 128),
    "headline": clean(headline, 200) or clean(source, 128),
    "facts": facts,
    "summary": clean_summary,
    "occurredAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    **({"worldLineClosing": True} if world_line_closing else {}),
}
if not event["eventKey"] or not event["source"] or not event["summary"]:
    raise SystemExit(2)

directory = Path(outbox)
directory.mkdir(parents=True, exist_ok=True)
os.chmod(directory, 0o700)
event_id = hashlib.sha256(event["eventKey"].encode()).hexdigest()[:40]
pending = directory / f"{event_id}.pending.json"
sent = directory / f"{event_id}.sent.json"
if pending.exists() or sent.exists():
    raise SystemExit(0)

fd, temporary = tempfile.mkstemp(prefix=f".{event_id}.", suffix=".tmp", dir=directory)
try:
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(event, handle, ensure_ascii=False, separators=(",", ":"))
        handle.write("\n")
    os.replace(temporary, pending)
except Exception:
    try:
        os.unlink(temporary)
    except FileNotFoundError:
        pass
    if not pending.exists():
        raise
PY
exit 0
