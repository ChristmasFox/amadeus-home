# Amadeus 1.4.8 — Kurisu natural-prompt recall acceptance passed

Date: 2026-09-24
Destination: M204 / migration-safe OpenClaw candidate
Goal: `docs/AMADEUS_1_4_8_OPERATION_SKULD_FINAL_CUTOVER_AND_MEMORY_CONTINUITY_GOAL.md`

## Candidate

- Source commit: `e7c3de0`
- Image: `local/openclaw-amadeus:git-e7c3de0-20260923170152`
- M204 image digest: `deb17964d88ba963a4f3c76c82f9f878b46e93cfac30d1efeb1c052a47f9f6f6`
- Candidate health: `healthy`
- Gateway bind: `loopback`
- Published ports: none
- Telegram/WhatsApp/public ingress: disabled
- Owner notification delivery: disabled
- Restart policy: `no`
- Avalon UUID and sentinel preflight: passed
- 9Router `/v1/models`: accepted expected `401`

## Natural-prompt acceptance

The original three-question prompt was run in a fresh safe-mode session without a channel and without
`--deliver`. No tool-routing instructions were included in the user prompt.

The bounded transcript audit shows this order:

1. `identity_resolve(reference=alias)` for supplied alias A;
2. `identity_resolve(reference=self)` for the first-person question;
3. `identity_resolve(reference=alias)` for supplied alias B;
4. `sessions_search` followed by `sessions_history` for alias B because it was not registered in Identity.

There was no `memory_search`, no filesystem-listing fallback, and no tool failure. The final response
correctly recalled the confirmed global alias and the historical conversation context for the unregistered
alias. The synthetic WebChat session had no trusted sender metadata, so the self result remained `unbound`
and did not default to Arthur/owner.

## Continuity metrics

Read-only SQLite counts after the acceptance run:

- `session_nodes`: 57
- `transcript_events`: 5,791
- `session_transcript_active_events`: 5,605
- `session_transcript_archives`: 1
- `session_transcript_fts`: 2,843

The memory-file vector index remains dirty/empty/mismatched. It was not reindexed because the configured
external embedding provider may receive private memory text. This does not block the accepted identity and
local transcript-search path.

## Remaining cutover gates

`KURISU_ACCEPTANCE=passed` for Phase 11. The destination remains non-authoritative. The old Mac host-local
`ai.openclaw.gateway` LaunchAgent still requires operator authority classification and a fresh unique-runtime
gate. Exact `APPROVE_OWNER_INGRESS_SWITCH_1_4_8` and the later cutover commit token remain required before
owner ingress, public ingress, or final source retirement can be enabled.
