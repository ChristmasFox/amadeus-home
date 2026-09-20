#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/amadeus-owner-notify-test.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT

event_key='amadeus-release:test-notify-owner'
bash "$ROOT_DIR/scripts/notify-owner.sh" \
  --outbox-dir "$fixture" \
  --event-key "$event_key" \
  --source amadeus-release \
  --headline 'Amadeus test · 世界线收束' \
  --summary 'structured deployment notification test' \
  --severity success \
  --significance major \
  --theme worldline_convergence \
  --fact-label 版本 \
  --fact-value 1.4.2 \
  --worldline-closing

event_id="$(printf '%s' "$event_key" | shasum -a 256 | cut -c1-40)"
pending="$fixture/$event_id.pending.json"
test -f "$pending"
python3 - "$pending" <<'PY'
import json
import sys
from pathlib import Path

event = json.loads(Path(sys.argv[1]).read_text())
assert event['type'] == 'owner_notification'
assert event['eventType'] == 'amadeus-release'
assert event['severity'] == 'success'
assert event['significance'] == 'major'
assert event['theme'] == 'worldline_convergence'
assert event['worldLineClosing'] is True
assert event['facts'] == [{'label': '版本', 'value': '1.4.2', 'evidenceRefs': []}]
assert not event['summary'].endswith('El Psy Kongroo.')
PY

before="$(find "$fixture" -maxdepth 1 -type f -name '*.pending.json' | wc -l | tr -d ' ')"
bash "$ROOT_DIR/scripts/notify-owner.sh" \
  --outbox-dir "$fixture" \
  --event-key "$event_key" \
  --source amadeus-release \
  --headline 'Amadeus test · 世界线收束' \
  --summary 'structured deployment notification test' \
  --severity success \
  --significance major \
  --theme worldline_convergence \
  --fact-label 版本 \
  --fact-value 1.4.2 \
  --worldline-closing
after="$(find "$fixture" -maxdepth 1 -type f -name '*.pending.json' | wc -l | tr -d ' ')"
[[ "$before" == 1 && "$after" == 1 ]]

grep -Fq -- 'for owner_outbox in "$CHECKPOINT_DIR/owner-smoke" "$OPENCLAW_DATA_DIR/notifications"' "$ROOT_DIR/scripts/deploy-openclaw.sh"
grep -Fq -- 'Owner release notification remained pending after 30 seconds.' "$ROOT_DIR/scripts/deploy-openclaw.sh"

printf '%s\n' 'NOTIFY_OWNER_TEST=passed'
