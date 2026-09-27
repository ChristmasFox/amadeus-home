# Current Task — Amadeus Model Capability Adapter — completed

Date: 2026-09-27 local. Completed Goal:
`docs/AMADEUS_MODEL_CAPABILITY_ADAPTER_GOAL.md`.

Final release `Amadeus 1.6.5` is deployed through the existing release
workflow on M204 OrbStack `nyannyan`. Source commit `fb7dd74` is pushed on
`codex/model-capability-adapter-2026-09`; immutable OpenClaw image
`local/openclaw-amadeus:git-fb7dd742b609-20260927142412` is healthy.

The owner confirmed the repaired typed-to-voice behavior: one audio reply plus
visible text in the exact `中文：...` / `日本語：...` format. The stable
OpenClaw-facing image capability is `openai/amadeus-image`, with 9Router-owned
strict GPT Image 2.5 → Gemini 3.1 Flash Image fallback. `arthur-combo`, ASR,
TTS, unrelated permissions, native TTS service and 9Router process were
preserved. Group image access is narrowly scoped to admitted WhatsApp/Telegram
group members; sensitive tools remain restricted.

Protected release rollback and post-deploy evidence are recorded in
`.agent/checkpoints/2026-09-27-amadeus-model-capability-final-release.md` and
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260927142412`.

No further work is in scope for this Goal. Do not expand into 9Router source
changes or ASR/TTS Combo work.
