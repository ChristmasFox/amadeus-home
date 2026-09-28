# Current Task — Kurisu A/C Emotion PoC (Active)

Date: 2026-09-28 local. Goal: `docs/AMADEUS_KURISU_AC_EMOTION_POC_GOAL.md`.
The owner explicitly activated this Goal after confirming the previous MacHost Telemetry V1 Goal is complete.

Execution scope is limited to the isolated A/C listening PoC defined by that Goal: generate A0 from the current accepted production Base 1.7B ICL path, generate C0-C5 from the pinned OminiX Qwen3-TTS MLX Base x-vector / clone+instruct path, deliver the labeled seven-sample set plus objective timing metrics to the configured owner WhatsApp target, preserve production TTS unchanged, stop the temporary OminiX process, and leave subjective quality as `pending_owner_listening`.

Do not promote C to production, change `amadeus-tts`, change 9Router/OpenClaw TTS routing, restart or replace the production TTS service, substitute CustomVoice, add model fallback, or expand into dynamic emotion inference. Follow the Goal stop conditions and preserve all private audio/model/owner-target assets outside Git.

The following completed task remains for historical continuity.

# Previous Task — MacHost Telemetry V1 (Complete)

Date: 2026-09-28 local. Based on latest `origin/main` (`6d82598`), the
MacHost Telemetry V1 implementation is complete. The MacHostAgent source,
SQLite history/anomaly engine, HomeLab adapter, mobile report format, group
read-only query boundary, existing owner outbox bridge, and 09:30/23:00 cron
jobs are implemented and verified. M204 runtime acceptance covers status,
history, anomalies, the candidate HomeLab report, owner outbox delivery, and
anomaly dedupe. The retired Glances runtime was stopped and removed after its
compose was preserved at
`/DATA/AppData/openclaw/backups/amadeus-glances-retired-20260928081939`.
Candidate image: `local/openclaw-amadeus:git-ef4c9ff39b7d-20260928083101`.
Rollback checkpoint:
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260928083101`.
Implementation evidence: `docs/MAC_HOST_TELEMETRY_V1_IMPLEMENTATION.md`.

The following previous task remains for historical continuity.

# Previous Task — Typed voice reply modality heartbeat isolation (Candidate live)

Date: 2026-09-28 local. Commit `bce1cc6` is pushed to `origin/main` and deployed as candidate image `local/openclaw-amadeus:git-bce1cc67fc8a-20260928054649`. Runtime inspection traced the leaked `[[amadeus:reply-modality=default]]\nNO_REPLY` to OpenClaw heartbeat turns: the native `inputProvenance.kind=internal_system` heartbeat shared the WhatsApp route, while the previous hook injected the typed-user protocol based only on `channel=whatsapp`. The hook now admits the protocol only for `inputProvenance.kind=external_user`; inbound voice still follows the verified lease. The WhatsApp postprocessor also suppresses a marked `NO_REPLY` after stripping the marker, preserving core silent delivery if a stale/model-generated marker appears. Focused tests, Amadeus full tests, OpenClaw 2026.9.4 patch fixtures, architecture, secrets, and build passed. Rollback checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260928054649`. Candidate health passed, and a manual run of the same heartbeat completed with exact plain `NO_REPLY` and no WhatsApp outbound log. Evidence: `.agent/checkpoints/2026-09-28-typed-voice-heartbeat-isolation-candidate-live.md`.

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
