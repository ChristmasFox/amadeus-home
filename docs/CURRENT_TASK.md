# Current Task — Amadeus Image Lifecycle Natural Persona Messaging 1.7.5

Date: 2026-10-01 (Asia/Shanghai).

Active Goal: `docs/AMADEUS_IMAGE_LIFECYCLE_NATURAL_PERSONA_MESSAGING_GOAL.md`.
Target release: **Amadeus 1.7.5**.
Status: `ROLLED_BACK_ORIGINAL_REQUEST_CONTEXT_REMEDIATION_IN_PROGRESS`.

The `4e514a3` candidate was automatically rolled back after an audit found that the pinned OpenClaw core derives `handle.taskLabel` from `request.prompt` (the model-produced image prompt), not guaranteed original inbound user text. That can misclassify a Chinese request if the model prompt is English. Production is healthy and Gateway-registered on `local/openclaw-amadeus:git-628703c803e7-20260930184906` (source Amadeus 1.7.4).

The current source captures bounded inbound text from `before_dispatch`, snapshots it per runtime taskId, and carries a separate language hint derived only from original user text alongside the image prompt to accepted, failed and caption enrichment. Context remains untrusted data and never controls runtime routing/identity/asset ownership. The correction is not yet committed or deployed; a fresh candidate must pass all hard gates.

Earlier applied behavior failure and rollback: `.agent/checkpoints/2026-10-01-amadeus-image-persona-1.7.5-postapply-symptom-rollback.md`. Original-request source audit and latest rollback: `.agent/checkpoints/2026-10-01-amadeus-image-persona-1.7.5-original-request-context-rollback.md`. Prior deployment checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20261001064552`. The active Goal authorization covers a new corrected apply, but does not waive any technical gate. Manual owner WhatsApp acceptance remains waived, not performed.
