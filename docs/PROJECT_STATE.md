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
- Offline voice verification baseline is ~4s on the current Mac; `verify:voice` isolates unit/fixture/type/syntax checks from real hardware acceptance. Full `pnpm test` remains a separate full suite.
- Historical details and old task diaries are archived under `docs/history/`; dated checkpoints and follow-up tasks remain in `.agent/`. For current work follow `docs/CURRENT_TASK.md` and the performance Goal.
