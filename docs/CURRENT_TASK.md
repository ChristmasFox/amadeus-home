# Current Task — Amadeus Image Lifecycle Natural Persona Messaging 1.7.5

Date: 2026-10-01 (Asia/Shanghai).

Active Goal: `docs/AMADEUS_IMAGE_LIFECYCLE_NATURAL_PERSONA_MESSAGING_GOAL.md`.
Target release: **Amadeus 1.7.5**.
Status: `AUTHORIZED_AUTO_APPLY`.

The previous Qwen3-TTS MLX rebaseline/default-only follow-up is complete and remains historical evidence only.

This active corrective Goal fixes image-generation accepted/failure/caption semantics without changing the accepted typed media transport architecture:

- preserve bounded request/session/channel context for lifecycle semantic generation;
- use current Kurisu persona and the user's current language when clear;
- replace the old ~2s lifecycle and ~7–8s caption limits with bounded ~30s semantic budgets;
- remove canned success fallback `图已经生成了。` and send the successful image without caption when caption enrichment fails;
- keep generation, asset registry, DeliveryEnvelope v2, single settlement, WhatsApp same-bubble native caption, Telegram media caption, upscale document, 2x/4x, text/voice/TTS semantics intact.

The operator explicitly authorizes unattended source implementation, version bump to 1.7.5, validation, commit/push, protected checkpoint, immutable candidate build, production apply and automated post-deploy verification.

Manual owner WhatsApp acceptance is waived for this run. Do not stop for a second deployment confirmation or manual channel test. If any hard technical gate fails, rollback is mandatory and the Goal remains incomplete.

Git and live runtime are the source of truth. Follow `AGENTS.md` for checkpoint, deployment, rollback, validation and evidence requirements.
