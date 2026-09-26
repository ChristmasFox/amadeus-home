# Project State — 2026-09-26

## Canonical source and runtime

- Canonical `main` now contains the complete Amadeus 1.5.9 Voice release history, fast-forwarded from `work/amadeus-1.5.3-voice-io` at `0658aa3`; `origin/main` was updated. New optimization work uses a short-lived branch.
- `VERSION=1.5.9`; production OpenClaw on OrbStack `nyannyan` CasaOS uses `local/openclaw-amadeus:git-3f9171f47b19-20260926043743`, healthy/restart 0. The image tag references the release commit, which is an ancestor of `main`; the live compiled bundle contains `amadeus-whatsapp-japanese-tts-input-v1`. Product Radar is healthy. The production Compose image line matches the running image.
- Protected rollback checkpoint exists at `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260926043743`; deploy evidence: `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260926043743`.
- OpenClaw is the only Agent runtime. Native PUBG/Amadeus plugins, deterministic domain/presentation, and the owner outbox remain the architecture. No retired LangBot/n8n/old Runtime fallback.

## Voice performance baseline and outstanding acceptance

- Real direct-DM sample: ASR 0.702s; one Agent call 3.471s; Qwen TTS+MP3 35.162s; inbound-to-PTT 42.462s. This is one observation, not p50/p95. Two separate synthetic samples had engine 15.840s/39.733s and encode 0.337s/0.205s; high variance prevents attribution beyond encoding being small in these samples.
- Qwen3-TTS currently uses resident 1.7B Base, PyTorch MPS FP16, reusable private ~46s ICL reference, `x_vector_only_mode=False`, `language="Auto"`, single inference lock. No optimization candidate has been chosen.
- 1.5.9 group Japanese TTS guard is deployed and a real group audio inbound was observed. Owner handset confirmation of exactly one Japanese audio and nonduplicated visible summary is still outstanding. Strict doctor has one known optional media-organizer-adapter failure.
- M204 Qwen service now runs Git instrumentation source `b4437bf` with protected pre-apply checkpoint `performance-instrument-20260926T081635Z`; health 200 after manual LaunchAgent bootstrap recovery. One synthetic short Japanese sample: model 11.07s, WAV 2.5ms, encode 0.366s, queue 0ms; this is not a performance distribution or quality acceptance.
- M204 TTS bounded worker source `6e531ea` is live; queue candidate checkpoint `performance-queue-20260926T082155Z`. Synthetic contention: first 200/12.48s, queued 503/5.2s, full queue 503/2ms; health 200. LaunchAgent bootstrap error 5 again required manual recovery; bounded wait/retry source follow-up awaits runtime validation.
- Candidate TTS LaunchAgent now has `ProcessType=Interactive` (source commit `6dae539`, plist-only apply); service SHA unchanged, health 200. Protected rollback `qos-ab-20260926T092129Z`. Five-request local HTTP A/B suggests p50 11.21s Background versus 4.55s Interactive for identical A/Auto/short fixture; 20-request Interactive batch p50 4.48s/p95 5.28s plus Background reversal p50 10.39s and Interactive reapply p50 4.50s strengthen attribution; no owner/WhatsApp acceptance yet.
- Isolated MLX 1.7B 8-bit PoC source `356901a` with pinned third-party backend/model completed 12 A/D comparison configs; direct MLX is faster, but peak memory/startup/dependency complexity higher and owner quality unverified. Production remains Qwen MPS/Auto/current private reference, with Interactive LaunchAgent candidate; no MLX production switch.
- Offline voice verification baseline is ~4s on the current Mac; `verify:voice` isolates unit/fixture/type/syntax checks from real hardware acceptance. Full `pnpm test` remains a separate full suite.
- Historical details and old task diaries are archived under `docs/history/`; dated checkpoints and follow-up tasks remain in `.agent/`. For current work follow `docs/CURRENT_TASK.md` and the performance Goal.
