#!/usr/bin/env bash
# scripts/plan-skuld-rollback.sh
# Amadeus 1.4.6 — Operation Skuld rollback plan.
# Describes the rollback procedure if destination fails validation during cutover.
# This is PLAN-ONLY: does not execute any rollback actions.
#
# Usage: scripts/plan-skuld-rollback.sh [--fixture] [--output-dir DIR]
set -Eeuo pipefail

ROOT_DIR="${SKULD_ROOT_DIR:-$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT_DIR"

FIXTURE_MODE=0
OUTPUT_DIR=''

while (($#)); do
  case "$1" in
    --fixture) FIXTURE_MODE=1 ;;
    --output-dir) shift; OUTPUT_DIR="${1:?--output-dir requires a path}" ;;
    --help|-h)
      printf '%s\n' 'Usage: scripts/plan-skuld-rollback.sh [--fixture] [--output-dir DIR]'
      exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

print_plan() {
cat << PLAN
# Operation Skuld — Rollback Plan

Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)

## When is rollback applicable?

Rollback is triggered when destination health is NOT stable after cutover begins, and BEFORE
the rollback safety boundary is crossed (see below). Trigger conditions:
- Destination health check fails after compose start.
- Database checksum or row-count comparison does not match backup manifest.
- Identity resolution differs from source (wrong person/account binding).
- Required secret cannot be validated on destination.
- Owner outbox idempotency is broken (duplicate send attempt).
- Any inbound event is observed by BOTH runtimes simultaneously.
- Immich health or media equivalence fails after Avalon attachment.

## Rollback safety boundary (time jump is no longer safe after):

- New writes accepted by destination (owner outbox events, PUBG data, identity binds).
- Secrets rotated on destination without reverse copy to source.
- External routing (DNS, Telegram webhook, WhatsApp pairing) changed WITHOUT recorded reverse route.
- Avalon physically disconnected from source without verification at destination.

After the safety boundary is crossed: STOP. Do not guess. Perform a data-divergence review.

## Rollback checklist

Step R.1  IMMEDIATELY pause destination ingress.
  Action: stop OpenClaw on destination; block inbound Telegram/WhatsApp webhook if possible.
  Command: orb -m nyannyan -u root docker stop openclaw

Step R.2  Preserve destination logs, outbox, and a timestamped checkpoint.
  Action: copy /DATA/AppData/openclaw and logs to SKULD_BACKUP_ROOT/rollback-<stamp>/.
  NEVER overwrite source data with destination data.
  Command: tar -czf \${SKULD_BACKUP_ROOT}/rollback-\$(date +%Y%m%dT%H%M%SZ).tar.gz /DATA/AppData/openclaw

Step R.3  Verify source (old Mac) runtime is still operational.
  Command: orb -m ubuntu -u root curl http://127.0.0.1:18789/healthz
  If source is running: proceed to Step R.4.
  If source is not running: THIS IS A CRITICAL FAILURE — do not delete destination data.

Step R.4  Reactivate source.
  On source Mac: verify the last known-good CasaOS compose and immutable images.
  Command: orb -m ubuntu -u root bash -lc 'cd /var/lib/casaos/apps/openclaw && docker compose up -d --no-build'
  Wait for health: orb -m ubuntu -u root curl http://127.0.0.1:18789/healthz

Step R.5  Verify source owner outbox for any new events that may have arrived during cutover window.
  If destination accepted any events not present in source outbox:
    - Manually replay ONLY the events with original idempotency keys.
    - DO NOT send new events; idempotency keys prevent double-delivery.

Step R.6  Re-run source health and integrity checks.
  Command: scripts/doctor.sh
  Command: scripts/migration-readiness.sh

Step R.7  Reopen inbound traffic to source ONLY after all checks pass.
  Action: restore Telegram webhook to source endpoint.
  Action: restore WhatsApp pairing to source if changed.

Step R.8  Record the rollback event in the Operation Skuld state machine.
  Command: scripts/skuld-state-machine.sh --status

## What rollback does NOT do

- It does NOT delete data from the destination (preserve for analysis).
- It does NOT restart a second runtime in parallel.
- It does NOT reintroduce LangBot, n8n, or any retired service.
- It does NOT mark OPERATION_SKULD=READY after a failed rollback (re-audit required).
- It does NOT automatically recover from both runtimes having seen the same event.

## After successful rollback

A successful rollback ends at: SOURCE_ACTIVE=yes, DESTINATION_STOPPED=yes.
A new cutover window requires:
- Data-divergence analysis complete.
- Root cause of failure identified and fixed.
- Updated pre-cutover checklist run from SKULD_PHASE_9.
- New authorized cutover window.

## Source runtime state during this goal

SOURCE_FROZEN=NO (source continues running throughout this preparation goal)
DESTINATION_MUTATED=NO (destination not touched in this goal)
MAC_MINI_CUTOVER=NOT_EXECUTED

PLAN
}

plan_output="$(print_plan)"

if [[ -n "$OUTPUT_DIR" ]]; then
  mkdir -p "$OUTPUT_DIR"
  printf '%s\n' "$plan_output" > "$OUTPUT_DIR/rollback-plan.md"
  printf 'PLAN_FILE=%s/rollback-plan.md\n' "$OUTPUT_DIR"
else
  printf '%s\n' "$plan_output"
fi

printf 'ROLLBACK_PLAN=ready\n'
printf 'SOURCE_FROZEN=NO\n'
printf 'DESTINATION_MUTATED=NO\n'
printf 'MAC_MINI_CUTOVER=NOT_EXECUTED\n'
