# Current Task — Amadeus ReplyEnvelope architecture migration (Active)

Date: 2026-09-29 local.

Canonical Goal: `docs/AMADEUS_REPLY_ENVELOPE_ARCHITECTURE_MIGRATION_GOAL.md`.

## Current state

The ReplyEnvelope contract, strict planner/resolver, run scoped origin context,
delivery idempotency, OpenClaw lifecycle bridge, and shared deadline TTS bridge
are implemented in Git. The retired modality marker, text protocol, registry,
scrub/recovery policy, and old policy module are removed from active source.

Source evidence passing:

- Amadeus and root typechecks; full `pnpm test`; `pnpm check:secrets`.
- ReplyEnvelope policy, lifecycle, TTS (including shared-deadline timeout,
  URL-download and ffmpeg timeout fallback), bilingual contract, module bundle,
  and architecture fixture tests.
- `pnpm check:architecture` and `git diff --check`.

## Candidate runtime checkpoint

The user authorized a controlled candidate deployment. Candidate image
`local/openclaw-amadeus:git-182417e8c4a2-20260929125242` is healthy and the
WhatsApp account is linked and connected. The deployment checkpoint is
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260929125242`; post-deploy
evidence is stored at
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260929125242`.
The first candidate exposed a real `deliveryChannel` reference error during
dispatch; the route-derived channel fix is in `735ee01`. A real group-chat
check then exposed stale volume patch code that bypassed ReplyEnvelope and
sent structured JSON verbatim. The boundary cleanup and no-run-id resolver
fallback are in `b64a8d4`; the redeployed candidate has no stale WhatsApp
compatibility symbols in the runtime. The group `message` action had a second
raw-payload path; `182417e` patches that final boundary and the candidate
runtime contains `amadeus-message-action-reply-envelope-v1`.

Real WhatsApp evidence from the candidate log at 20:54–20:55 local time:

- Group typed voice request `发语音说喵喵`: one `auto-reply sent (media)` with
  visible bilingual text and one audio file; no structured JSON was sent.
- Group ordinary text `欸 好了`: one outbound text send with
  `hasMedia=false`.
- Group inbound voice: one inbound `audio/ogg` event and one `auto-reply sent
  (media)` with visible bilingual text and one audio file.
- No old marker or compatibility symbol appears in the live WhatsApp module.

## Remaining work

1. Record real WhatsApp evidence for internal heartbeat/cron silence, duplicate
   ingress, and TTS fallback. Until that evidence exists, this Goal remains
   incomplete.
2. Preserve the candidate checkpoint and collect enough message/log evidence to
   support rollback or an explicit production release decision.

This is a candidate runtime only. No production release, VERSION bump, release
notification, or production promotion has occurred. Do not mark the Goal
complete before real WhatsApp acceptance and dated rollback evidence are
recorded.

Historical task records remain in `docs/PROJECT_STATE.md` and dated
`.agent/checkpoints/`; they are audit evidence only.
