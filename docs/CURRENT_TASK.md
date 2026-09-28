# Current Task — Typed voice reply modality (Completed)

Date: 2026-09-28 local. The typed text to voice reply fix is complete on `main` at `89826fd` and is deployed as the candidate image `local/openclaw-amadeus:git-89826fd8e5cc-20260928035547`. The turn-scoped `replyModality` classifier, deterministic `voice-reply` Skill injection, gated missing-marker recovery, and inbound voice lease preservation passed focused tests and real WhatsApp inbound acceptance. Rollback checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260928035547`. Evidence: `.agent/checkpoints/2026-09-28-typed-voice-modality-candidate-live.md`.

The previously paused TTS Boundary Rebaseline V2 pointer follows for historical continuity.

# Previous Task — Amadeus TTS Boundary Rebaseline V2 (Paused)

Date: 2026-09-27 local. Goal: `docs/AMADEUS_TTS_BOUNDARY_REBASELINE_V2_GOAL.md`. The owner requested delivery of only the complete 25/50/100/150-codepoint report and to stop promptly. The broader 25–600 Goal is paused, not complete.

Production TTS control `prod-1.6.2-a-mlx-auto-interactive` was not changed, restarted, or redeployed. The current host check returned `/healthz=ready`, LaunchAgent PID `50062`; no benchmark process was active.

## Preserved V2 runs

- Primary root: `/Volumes/Avalon/backups/operation-skuld/qwen3-tts/boundary-rebaseline-v2-2026-09`. B-250 hit the unchanged 110-second watchdog (`110002.4 ms`); the dataset stopped, and its partial rows were not pooled or resumed. Original report remains `docs/reports/AMADEUS_TTS_BOUNDARY_REBASELINE_V2_2026_09.md`.
- Safe-prefix root: `/Volumes/Avalon/backups/operation-skuld/qwen3-tts/boundary-rebaseline-v2-safe-25-200-2026-09`. Owner stopped after 99 persisted client rows. Lengths 25/50/100/150 each have 20/20 successes; 200 has 19/19 persisted rows. The later service success for A-200 lacked a persisted client timing row and is excluded. No synthesis request was submitted after the stop. Four verified fixture-A listening artifacts for the requested lengths remain outside Git.
- Requested extract: `docs/reports/AMADEUS_TTS_BOUNDARY_REBASELINE_V2_25_50_100_150_2026_09.md` and `docs/reports/data/AMADEUS_TTS_BOUNDARY_REBASELINE_V2_25_50_100_150_2026_09.json`. The extract uses only 25/50/100/150; no cross-run pooling and no production policy recommendation.
- A later empty fresh-root preparation remains protected at `/Volumes/Avalon/backups/operation-skuld/qwen3-tts/boundary-rebaseline-v2-safe-25-200-completion-2026-09`. Control capture refused before writing a control manifest because this branch is based on `63d3b79` / VERSION 1.6.2 while `origin/main` advanced to `1401e49` / VERSION 1.6.4. No TTS request was sent from that root.

The full 25–600 matrix, soak, contention, and recovery requirements remain incomplete. Do not infer completion from the four-bucket extract or change production policy.

## Previous completed task — Amadeus Model Capability Adapter

Date: 2026-09-27 local. Completed Goal: `docs/AMADEUS_MODEL_CAPABILITY_ADAPTER_GOAL.md`.

Final release `Amadeus 1.6.5` is deployed through the existing release workflow on M204 OrbStack `nyannyan`. Source commit `fb7dd74` is pushed on `codex/model-capability-adapter-2026-09`; immutable OpenClaw image `local/openclaw-amadeus:git-fb7dd742b609-20260927142412` is healthy.

The owner confirmed the repaired typed-to-voice behavior: one audio reply plus visible text in the exact `中文：...` / `日本語：...` format. The stable OpenClaw-facing image capability is `openai/amadeus-image`, with 9Router-owned strict GPT Image 2.5 → Gemini 3.1 Flash Image fallback. `arthur-combo`, ASR, TTS, unrelated permissions, native TTS service and 9Router process were preserved. Group image access is narrowly scoped to admitted WhatsApp/Telegram group members; sensitive tools remain restricted.

Protected release rollback and post-deploy evidence are recorded in `.agent/checkpoints/2026-09-27-amadeus-model-capability-final-release.md` and `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260927142412`.

No further work is in scope for that Goal. Do not expand into 9Router source changes or ASR/TTS Combo work.
