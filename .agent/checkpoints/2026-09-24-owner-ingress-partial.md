# Amadeus 1.4.8 — Phase 12 passed, owner ingress partial

Date: 2026-09-24

## Authorized source runtime handling

The user authorized stopping and disabling the old Mac `ai.openclaw.gateway`. It was stopped with `launchctl disable` and `launchctl bootout` in the user GUI domain. The plist was not deleted and remains available for rollback-only recovery. A fresh check confirms no process and no listener on the old Mac loopback port `18789`.

## Unique runtime gate

```text
OLD_SOURCE_OPENCLAW_RUNNING_COUNT=0
OLD_SOURCE_OPENCLAW_PROCESS_COUNT=0
OLD_SOURCE_OWNER_INGRESS=disabled
M204_PRODUCTION_CANDIDATE_COUNT=1
OPENCLAW_ACTIVE_RUNTIME_COUNT=1
MIGRATION_SAFE_CANDIDATE=passed
```

## Phase 13 state

- Rollback checkpoint: `/DATA/AppData/openclaw/backups/owner-ingress-pre-switch-20260923T174635Z`.
- M204 was switched from the temporary migration-safe Compose overlay to the canonical Compose and is healthy.
- Canonical effective config uses `/home/node/.openclaw/openclaw.json`, `gateway.bind=lan`, `tools.sessions.visibility=self`, `session.dmScope=per-account-channel-peer`, and `session.groupScope=per-group`.
- Telegram and WhatsApp are enabled in canonical config; owner delivery is enabled.
- Telegram account `default` is `ready/connected` with polling active.
- WhatsApp account `secondary` is configured but `not-linked`/`logged-out` after the restored session received a server-side connection failure. A persistent `channels login --channel whatsapp --account secondary` process is waiting for a QR scan.
- Restored OpenClaw secret files were found as `root:root 0600`, unreadable by the `node` runtime user. They were changed to `1000:1000 0600` on M204; no secret contents were printed. The restore script now normalizes this owner during future restores; source fix is commit `2ba9541`.

## Not complete

No real WhatsApp inbound/final-reply acceptance, no duplicate-response comparison across channels, and no final source retirement were claimed. `COMMIT_SKULD_CUTOVER_1_4_8` has not been executed. The old Mac rollback plist/config/logs and the M204 pre-switch checkpoint remain retained.
