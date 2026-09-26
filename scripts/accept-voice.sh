#!/usr/bin/env bash
# Explicit hardware/runtime gate; never claim success from local fixtures alone.
set -euo pipefail
if [[ "${1:-}" != --apply ]]; then
  echo 'VOICE_ACCEPTANCE=not_run'
  echo 'PLAN=run on the production/candidate host with --apply, verify health and controlled MPS benchmark, then obtain owner handset quality/PTT confirmation; no automatic messages are sent.'
  exit 0
fi
printf '%s\n' 'VOICE_ACCEPTANCE=manual_runtime_required' >&2
printf '%s\n' 'Run the controlled benchmark matrix and owner listening/PTT acceptance; this entry cannot synthesize a fake pass.' >&2
exit 2
