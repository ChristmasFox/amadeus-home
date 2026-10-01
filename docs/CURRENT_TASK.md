# Current Task — Amadeus Image Lifecycle Natural Persona Messaging 1.7.5

Date: 2026-10-01 (Asia/Shanghai).

Active Goal: `docs/AMADEUS_IMAGE_LIFECYCLE_NATURAL_PERSONA_MESSAGING_GOAL.md`.
Target release: **Amadeus 1.7.5**.
Status: `HALTED_HARD_GATE_FAILED_BEFORE_RUNTIME_SWITCH`.

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
