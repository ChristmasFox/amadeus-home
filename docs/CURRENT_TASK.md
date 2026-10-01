# Current Task — Amadeus Image Lifecycle Natural Persona Messaging 1.7.5

Date: 2026-10-01 (Asia/Shanghai).

Active Goal: `docs/AMADEUS_IMAGE_LIFECYCLE_NATURAL_PERSONA_MESSAGING_GOAL.md`.
Target release: **Amadeus 1.7.5**.
Status: `ROLLED_BACK_SOURCE_FIXES_VALIDATED_PENDING_COMMIT`.

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


The 1.7.5 source/version commit `a242570` is pushed, but its immutable candidate failed the required pre-switch runtime-version readability check (`/opt/amadeus/VERSION` mode 0600). The deployment script stopped before checkpoint creation or Compose apply. Production remains healthy on 1.7.4; do not claim the release deployed or retry the rejected candidate. The Goal remains incomplete pending a corrected source commit and a distinct candidate that passes every hard gate. The active Goal authorization still covers apply, but never waives a failed gate or permits reuse of the rejected candidate. Failure evidence: `.agent/checkpoints/2026-10-01-amadeus-image-persona-1.7.5-candidate-preflight-failed.md`; follow-up: `.agent/tasks/2026-10-01-amadeus-image-persona-1.7.5-rollout-halted.md`.


Remediation is committed and pushed as `431d90f`: both the Docker image and canonical version-bump script preserve mode 0644 for `/opt/amadeus/VERSION`, with regression assertions. The rejected candidate remains forbidden; a new candidate must use the new source commit and pass all gates. Production remains 1.7.4 until then.


A distinct corrected candidate from `e82f04d` was later applied after the version-marker preflight fix. The operator then reported a Chinese request receiving English accepted text and successful generation delivering only an image. Safe runtime telemetry confirmed the caption enricher omitted its caption on `model_error` (46 ms). The active source now adds strict request-language output matching and bounded same-operation retries for language mismatch and early transient caption-provider errors. Following the Goal's hard-gate policy, 1.7.5 was rolled back to the protected checkpoint source (1.7.4); OpenClaw health and Amadeus registration passed after rollback. The Goal remains active/incomplete and requires a new distinct candidate after source validation. Evidence: `.agent/checkpoints/2026-10-01-amadeus-image-persona-1.7.5-postapply-symptom-rollback.md`.


The latest language-lock/retry correction now passes `pnpm test:delivery` (80 tests plus pinned integration), `pnpm test:amadeus` (114 tests), `pnpm typecheck:amadeus`, `pnpm build:amadeus`, architecture, version, candidate-deploy fixture, secrets and diff checks. These fixes are still uncommitted; the next candidate must come from the reviewed pushed commit and must pass all gates.
