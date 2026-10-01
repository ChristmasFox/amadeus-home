# Current Task — Amadeus TTS default-only local-first follow-up

Date: 2026-10-01 (Asia/Shanghai).

Most recent completed Goal: `docs/AMADEUS_QWEN3_TTS_MLX_REBASELINE_GOAL.md`.
Completed follow-up record: `.agent/tasks/2026-10-01-amadeus-tts-default-only-policy.md`.

Status: `COMPLETE`. Production normalizes valid styles/emotions to `default`,
always tries local Qwen3-TTS MLX first, and uses Qwen Audio 3.1 → 3.0 only
for operational local failure. Emotion code is retained behind the disabled
`AMADEUS_TTS_EMOTIONS_ENABLED` opt-in. The verified live container and direct
non-default-style smoke are recorded in
`.agent/checkpoints/2026-10-01-amadeus-tts-default-only-policy.md`.

No ASR, OpenClaw, ImageAssets, model/profile, cloud credential or voice-ID
configuration changed. The owner did not request human listening or WhatsApp
acceptance.
