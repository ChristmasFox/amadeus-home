# Current Task — Amadeus Image Lifecycle Natural Persona Messaging 1.7.5

Date: 2026-10-01 (Asia/Shanghai).

Active Goal: none.
Last completed Goal: `docs/AMADEUS_IMAGE_LIFECYCLE_NATURAL_PERSONA_MESSAGING_GOAL.md`.
Target release: **Amadeus 1.7.5**.
Status: `COMPLETE_AUTO_VERIFIED_MANUAL_OWNER_ACCEPTANCE_WAIVED`.

Amadeus 1.7.5 is deployed in immutable OpenClaw 2026.9.4 image
`local/openclaw-amadeus:git-4e514a361bec-20261001064552` from source commit
`4e514a361becb9183b9208a5c8b764d5eb70c65d`. `/opt/amadeus/VERSION` reports 1.7.5;
OpenClaw health and real Gateway Amadeus registration pass.

The final correction enforces current request language on lifecycle/caption output,
uses typed bounded request/session/channel context, and permits only bounded
same-operation retries within one ~30-second semantic deadline. Caption failure
omits the caption but preserves the authoritative image and native single-bubble
media delivery. DeliveryEnvelope v2, asset validation, idempotency, Telegram,
document/upscale, text, voice and TTS contracts remain intact.

Automated evidence and protected rollback details are in
`.agent/checkpoints/2026-10-01-amadeus-image-persona-1.7.5-release.md`. The prior
candidate behavior failure and rollback are retained in
`.agent/checkpoints/2026-10-01-amadeus-image-persona-1.7.5-postapply-symptom-rollback.md`;
the initial version-marker preflight failure is retained in
`.agent/checkpoints/2026-10-01-amadeus-image-persona-1.7.5-candidate-preflight-failed.md`.

Manual owner WhatsApp/image-experience acceptance was **operator-waived and not
performed**. Deployment notification/outbox smoke is not represented as manual
acceptance. Do not infer cross-restart exactly-once beyond the existing bounded
process-local coordinator/ledger.
