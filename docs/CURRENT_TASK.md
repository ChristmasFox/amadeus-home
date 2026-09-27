# Current Task — Stable Amadeus 1.6.4

Date: 2026-09-27 local. No active product/engineering Goal. `docs/AMADEUS_DEFAULT_IMAGE_GENERATION_GOAL.md` is completed history, not a standing instruction.

Canonical image-generation source is in the local Git branch `codex/amadeus-default-image-generation-2026-09`, commits `ac021ae` and `b389e86`. Amadeus 1.6.4 is deployed on the M204 `nyannyan` CasaOS OpenClaw runtime. The default model uses the existing 9Router-backed `openai` provider and key source; the owner-approved shared private-network opt-in is active. No Google key/path, custom provider, keyword router, or second sender was added.

The owner confirmed real acceptance on 2026-09-27: “已验收 一切正常可以收尾”. Current live OpenClaw and Product Radar health passed; host TTS health remains HTTP 200/ready (LaunchAgent PID 50062, exit 0). Protected checkpoints and the detailed content-safe release/acceptance record are in `.agent/checkpoints/2026-09-27-amadeus-default-image-generation-release.md`. No generated image/base64 is committed. The historical CLI-only test sessions are not treated as owner-inbound proof; the owner’s real-channel acceptance is the acceptance evidence.

No active Goal remains. For future work, keep model switching in `agents.defaults.mediaModels.image`; multi-model routing, local generation, editing policy, and fallback remain out of scope unless a new Goal is opened.
