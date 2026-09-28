# Current Task — Typed voice reply modality heartbeat isolation (Candidate live)

Date: 2026-09-28 local. Commit `bce1cc6` is pushed to `origin/main` and deployed as candidate image `local/openclaw-amadeus:git-bce1cc67fc8a-20260928054649`. Runtime inspection traced the leaked `[[amadeus:reply-modality=default]]\nNO_REPLY` to OpenClaw heartbeat turns: the native `inputProvenance.kind=internal_system` heartbeat shared the WhatsApp route, while the previous hook injected the typed-user protocol based only on `channel=whatsapp`. The hook now admits the protocol only for `inputProvenance.kind=external_user`; inbound voice still follows the verified lease. The WhatsApp postprocessor also suppresses a marked `NO_REPLY` after stripping the marker, preserving core silent delivery if a stale/model-generated marker appears. Focused tests, Amadeus full tests, OpenClaw 2026.9.4 patch fixtures, architecture, secrets, and build passed. Rollback checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260928054649`. Candidate health passed; the next scheduled heartbeat is the remaining live silence observation. Evidence: `.agent/checkpoints/2026-09-28-typed-voice-heartbeat-isolation-candidate-live.md`.

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
