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

The owner handset screenshot exposed a legacy `tts:mood` leak. The repository now maps that bounded legacy alias, strips control markers before WhatsApp delivery, and keeps the seven-value emotion contract in the pinned provider patch. CLI `agent --deliver` was excluded from voice evidence because it bypasses the channel TTS finalizer.

Manual acceptance passed on 2026-09-28: a real owner WhatsApp inbound event at 20:33:50 (Asia/Shanghai) produced one channel media reply at 20:34:04. The channel log records `auto-reply sent (media)` with the generated file `voice---2d373ae5-edd8-432d-9d6d-20b708ee2db6.mp3`, `mediaSizeBytes=92188`, and `durationMs=1746`. The same outbound record contains only the visible Chinese/Japanese reply and `mediaUrl`; no `tts:mood`, `tts:emotion`, or `amadeus:reply-modality` control marker appears in that final channel record. Historical marker counts in the persistent session database are expected from earlier rejected CLI probes and are not used as acceptance evidence.

## 1.6.6 style optimization deployment

- Source pushed: `6d99e1f` (style instructions), followed by `306c39e` (voice acceptance marker alignment).
- Native Mac apply: `ENGINE=ominix`, LaunchAgent running, `/healthz=200`, installed `kurisu_emotion.py` matches the pushed source.
- Same-version candidate OpenClaw image: `local/openclaw-amadeus:git-6d99e1f999e8-20260928125615`.
- Candidate checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260928125615`; post-deploy evidence: `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260928125615`.
- Candidate owner notification sent marker: `/DATA/AppData/openclaw/notifications/c5a7d98ce9719d18df7e97bbb818df0d2331bcb3.sent.json` for `amadeus-candidate-deploy:amadeus-openclaw-20260928125615`.
- Technical speech smoke: native `default` MP3 returned HTTP 200 (46,700 bytes); 9Router `amadeus-tts` `default` and `soft` both returned HTTP 200 with distinct audio lengths/hashes. `scripts/accept-voice.sh --apply` passed with TTS ready and WhatsApp linked/running/connected. No new A/C matrix was run and sampling parameters were unchanged.

## 1.6.6 WhatsApp modality-marker leak fix

- Source commits pushed: `3bb1da1` (final-delivery scrub) and `857fbf1` (upgrade existing marked monitors in place).
- Same-version candidate OpenClaw image: `local/openclaw-amadeus:git-857fbf184dcf-20260928134856`.
- Candidate checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260928134856`; post-deploy evidence: `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260928134856`.
- Candidate owner notification sent marker: `/DATA/AppData/openclaw/notifications/adfba409312025a5ba387ee646e7c12b4819341e.sent.json` for `amadeus-candidate-deploy:amadeus-openclaw-20260928134856`.
- Root cause: a pinned OpenClaw `delivery.deliver()` path could bypass `preparePayload`, leaving `[[amadeus:reply-modality=default]]` in visible WhatsApp text. The final `deliverNormalizedPayload()` path now sanitizes and sends the cleaned payload; existing persistent monitors are upgraded when the old patch marker is present.
- Verification: lifecycle and pure voice-policy fixtures passed; `pnpm check:secrets` passed; live OpenClaw, Product Radar, and 9Router are healthy; the running WhatsApp monitor contains the final `safeDeliveryPayload` scrub at lines 3518–3561. No model, x-vector, router, sampling parameter, version target, or emotion architecture changed.
