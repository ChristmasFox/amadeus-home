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

## Release runtime checkpoint

The user authorized formal release deployment. Release `1.7.3` image
`local/openclaw-amadeus:git-bd4736661f5e-20260929130719` is healthy and the
WhatsApp account is linked and connected. The deployment checkpoint is
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260929130719`; post-deploy
evidence is stored at
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260929130719`.
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
- The 9Router log records one successful ASR request for the group audio and
  one successful cloud TTS request for each voice reply; no duplicate send is
  associated with either group correlation id.
- Formal release post-deploy checks passed: OpenClaw and Product Radar health,
  NAS SSH read-only smoke, owner outbox smoke, and post-deploy maintenance.

## Remaining work

1. Record real WhatsApp evidence for internal heartbeat/cron silence, duplicate
   ingress, and TTS fallback. Until that evidence exists, this Goal remains
   incomplete.
2. Preserve the candidate checkpoint and collect enough message/log evidence to
   support rollback or an explicit production release decision.

Release `1.7.3` is live. The Goal remains active until the remaining real
WhatsApp acceptance evidence and dated rollback audit are complete; no further
production promotion is implied by this checkpoint.

Historical task records remain in `docs/PROJECT_STATE.md` and dated
`.agent/checkpoints/`; they are audit evidence only.
