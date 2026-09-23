# Amadeus 1.4.8 — owner ingress approval received, unique-runtime gate blocked

Date: 2026-09-24

## Result

The operator supplied the exact `APPROVE_OWNER_INGRESS_SWITCH_1_4_8` token. The approval was recorded, but Phase 12 did not pass and no owner/public ingress or canonical-config mutation was performed.

## Fresh read-only evidence

- Old Mac `ai.openclaw.gateway` is an active `RunAtLoad=true`, `KeepAlive=true` LaunchAgent listening only on loopback `127.0.0.1:18789`/`::1:18789`.
- Its host-local configuration exposes only the iMessage channel/plugin. Message contents were not read; its relationship to this migration's production authority remains unclassified.
- M204 has exactly one healthy OpenClaw candidate and no published container ports.
- The unique-runtime probe returned:

```text
OLD_SOURCE_OPENCLAW_RUNNING_COUNT=0
OLD_SOURCE_OPENCLAW_PROCESS_COUNT=1
M204_PRODUCTION_CANDIDATE_COUNT=1
OPENCLAW_ACTIVE_RUNTIME_COUNT=2
UNIQUE_RUNTIME_GATE=BLOCKED
BLOCKER=old source OpenClaw or Gateway is still active
```

- M204's effective configuration is `/run/openclaw-migration/openclaw.json`, SHA-256 `e25d8008fc29aac6958d2064ae48861d174a645036ebbd17373f7e8b314bf674`; it is loopback-only, `tools.sessions.visibility=self`, Telegram/WhatsApp disabled, and owner delivery disabled. The restored `/home/node/.openclaw/openclaw.json` is not the effective safe overlay path.

## Required next action

The operator must explicitly classify or authorize handling of the old Mac Gateway. After that decision, rerun the unique-runtime gate; only a passing gate may precede the owner ingress switch. `COMMIT_SKULD_CUTOVER_1_4_8` has not been supplied and is not implied by the owner-ingress approval.

## Safety state

`DESTINATION_AUTHORITY=NO`; source and destination owner ingress remain off; no source cleanup, source retirement, or cutover was performed.
