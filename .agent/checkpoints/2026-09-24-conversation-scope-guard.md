# Amadeus 1.4.8 — conversation-scoped recall guard

Date: 2026-09-24
Destination: M204 / migration-safe OpenClaw candidate
Goal: `docs/AMADEUS_1_4_8_OPERATION_SKULD_FINAL_CUTOVER_AND_MEMORY_CONTINUITY_GOAL.md`

## Requirement

The operator supplied two visibility-scoped facts: one must be available only in a direct/private
conversation, and the other only in a group conversation. Neither fact may be written to global
`MEMORY.md` or returned from an unrelated session.

## Source and runtime change

- Commit: `238bb65`
- Image: `local/openclaw-amadeus:git-238bb65-20260923171901`
- M204 image digest: `4c726c0a7d5992b53d55591c45455e1a45000e45e8d53c829cdb8a3b2ce8ffb9`
- `tools.sessions.visibility=self` is required in the config template, enforced by the migration-safe
  overlay, and checked by the deployment validator.
- Workspace and Identity Skill rules state that direct facts stay in the current direct session, group
  facts stay in the current group session, and unavailable scope must be treated as unavailable.
- No scoped fact was added to tracked files or global `MEMORY.md`.

## Verification

- M204 Avalon UUID/sentinel preflight: passed.
- Candidate health: `healthy`.
- Gateway bind: `loopback`.
- Published ports: none.
- Telegram/WhatsApp/public ingress: disabled.
- Owner notification delivery: disabled.
- No-scope probe for the private-only fact: did not return data from another session.
- Tool order in the no-scope probe: `identity_resolve(reference=alias)` then `sessions_search`.
- No-scope probe did not call `memory_search` or `ls`.
- Migration-safe config, session-isolation, typecheck, syntax, diff, and secret tests: passed.

Read-only SQLite counts after the probes were `session_nodes=60`, `transcript_events=5,838`,
`session_transcript_active_events=5,649`, `session_transcript_archives=1`, and
`session_transcript_fts=2,849`.

## Remaining acceptance

The isolation guard is active, but a real direct-message probe and a real group probe are still required
to confirm that each fact is stored and recalled only in its intended conversation scope. Those probes
must use trusted channel metadata and must not be replaced by a synthetic WebChat session. Destination
authority remains `NO`; no owner/public ingress or cutover was performed.
