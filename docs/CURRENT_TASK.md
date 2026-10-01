# Current Task — Amadeus Image Lifecycle Natural Persona Messaging 1.7.5

Date: 2026-10-01 (Asia/Shanghai).

Active Goal: `docs/AMADEUS_IMAGE_LIFECYCLE_NATURAL_PERSONA_MESSAGING_GOAL.md`.
Target release: **Amadeus 1.7.5**.
Status: `ROLLED_BACK_CORRECTED_SOURCE_PUSHED_PENDING_CANDIDATE`.

The `4e514a3` candidate was automatically rolled back after an audit found that the pinned OpenClaw core derives `handle.taskLabel` from `request.prompt` (the model-produced image prompt), not guaranteed original inbound user text. That can misclassify a Chinese request if the model prompt is English. Production is healthy and Gateway-registered on `local/openclaw-amadeus:git-628703c803e7-20260930184906` (source Amadeus 1.7.4).

The corrected source is pushed as `2e60797` and `d8442d6`: bounded inbound text is captured from `before_dispatch`, snapshotted per runtime taskId, and its separate language hint is derived only from original user text while the model image prompt remains context-only. Context cannot control runtime routing/identity/asset ownership. Current production remains 1.7.4; a fresh candidate from these commits must pass all hard gates.

Earlier applied behavior failure and rollback: `.agent/checkpoints/2026-10-01-amadeus-image-persona-1.7.5-postapply-symptom-rollback.md`. Original-request source audit and latest rollback: `.agent/checkpoints/2026-10-01-amadeus-image-persona-1.7.5-original-request-context-rollback.md`. Prior deployment checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20261001064552`. Latest local validation passes `pnpm test:delivery` (82 tests plus pinned integration), `pnpm test:amadeus` (116 tests), typecheck/build, architecture/secrets, version/candidate fixtures and diff checks. The active Goal authorization covers a new corrected apply, but does not waive any technical gate. Manual owner WhatsApp acceptance remains waived, not performed.
