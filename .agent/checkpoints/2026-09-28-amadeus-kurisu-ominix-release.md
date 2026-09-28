# Amadeus Kurisu OminiX release checkpoint

- Date: 2026-09-28 (Asia/Shanghai)
- Release: Amadeus 1.6.6
- Release source commit: `4fb9f16`
- Protected A rollback checkpoint: `/Volumes/Avalon/backups/operation-skuld/qwen3-tts-a/a-20260928T115919Z` (`QWEN3_TTS_A_ROLLBACK_SCRIPT=syntax-passed`)
- OminiX source: `OminiX-ai/OminiX-MLX` at `4988a3fcfa48b8cb5d0780a501b92c6a41401523`; `qwen3-tts-mlx`; model `mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit` at `e7dd0585652209fa0d7783659aad4e8a324de11c`
- Mac TTS runtime: `ENGINE=ominix`, port `18792`, health `200`, stable model alias `amadeus-tts` accepted; final direct sample was MP3, 24 kHz, mono, 96 kbps with `style=soft`.
- 9Router image: `local/9router:git-daf9750b538c-20260928T120725Z`; protected checkpoint `/DATA/AppData/9router/backups/voice-1.5.3-deploy-20260928T120725Z`; live style marker present.
- OpenClaw release image: `local/openclaw-amadeus:git-4fb9f1604eaa-20260928123236`; checkpoint `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260928123236`; post-deploy evidence `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260928123236`.
- Live checks: OpenClaw and Product Radar healthy, WhatsApp linked/running/connected, NAS read-only smoke passed, OpenClaw emotion marker present, release owner outbox smoke passed.
- Release notification sent marker: `/DATA/AppData/openclaw/notifications/6d7ac2a89edc2cbffb3542935665500372c8db3a.sent.json` for `amadeus-release:1.6.6`.
- Verification: TTS unit suite `41 tests, 1 skipped`; focused OpenClaw/9Router fixtures, architecture check, diff check, and secrets scan passed.

The owner handset screenshot exposed a legacy `tts:mood` leak. The repository now maps that bounded legacy alias, strips control markers before WhatsApp delivery, and keeps the seven-value emotion contract in the pinned provider patch. CLI `agent --deliver` was excluded from final voice evidence because it bypasses the channel TTS finalizer; a fresh owner handset inbound voice turn remains the final manual acceptance step.
