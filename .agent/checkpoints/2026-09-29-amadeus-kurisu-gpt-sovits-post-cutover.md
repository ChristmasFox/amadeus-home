# Kurisu GPT-SoVITS MPS post-cutover checkpoint — 2026-09-29

## State

- Source commit: `606270b` (`fix: validate GPT-SoVITS adapter files correctly`).
- Production apply: complete on M204; no OpenClaw, ReplyEnvelope, channel,
  ASR, voice-ID or MLX changes were made during the apply.
- Goal status: `WAITING_FOR_OWNER_CHANNEL_ACCEPTANCE`.
- Remaining gate: real owner-channel Japanese voice acceptance, including
  character identity, visible text behavior and typed-text isolation.

## Live route

```text
GPT-SoVITS v2Pro MPS :19871
  -> qwen-audio-3.1-tts-flash
  -> qwen-audio-3.0-tts-flash
```

- GPT-SoVITS API LaunchAgent `com.amadeus.kurisu-gpt-sovits-api`: loaded,
  loopback `127.0.0.1:19870`, API health HTTP 200.
- GPT-SoVITS adapter LaunchAgent `com.amadeus.kurisu-gpt-sovits-tts`:
  loaded, loopback `127.0.0.1:19871`, health `ready`, backend `mps`, model
  `gpt-sovits-v2pro-mps`, voice `kurisu-v1`.
- Live primary bridge smoke returned HTTP 200, valid MP3 and
  `X-Amadeus-TTS-Provider: gpt-sovits-mps`.
- The deployed immutable 9Router image is
  `local/9router:git-606270b6bed3-20260929T165759Z`; provider and alias
  reconciliation completed before the live smoke.
- A controlled adapter stop returned HTTP 200 valid cloud MP3; the 9Router
  audit log recorded `qwen-audio-3.1-tts-flash`, `tts_attempt=1`, and
  `fallback_reason=provider_unavailable`.
- The executable bridge test recorded `qwen-audio-3.1-tts-flash` attempt 1
  followed by `qwen-audio-3.0-tts-flash` attempt 2, and passed.
- OminiX `com.amadeus.qwen3-tts` is uninstalled. No listener remains on
  `:18792` or `:18793`; no OminiX process is resident.

## Direct evidence

- External evidence directory:
  `/Volumes/Avalon/backups/operation-skuld/kurisu-gpt-sovits-cutover-postapply-20260929T171128Z/`.
- Direct GPT adapter smoke: MP3 HTTP 200, `X-Amadeus-TTS-Provider:
  gpt-sovits-mps`, 3.600-second audio.
- Warm direct sample: 2.581646 seconds wall time for 3.312 seconds audio,
  RTF `0.7794824879`.
- Controlled bridge test: `TTS_BRIDGE_TEST=passed`.
- Adapter test: `KURISU_GPT_SOVITS_ADAPTER_TEST=passed`.
- Current source and route evidence contain no raw secret values.

## Resource evidence

- API process RSS sample: `2,157,296 KiB`.
- Adapter process RSS sample: `20,352 KiB`.
- Encrypted swap was stable at `2202 MiB used / 3072 MiB total` across the
  30-second sample; system-wide free memory samples were `62%`, `77%`, `78%`.
- The resource sample is retained in `resource-trend.txt`; the non-zero swap
  is recorded for owner review rather than silently treated as absent.

## Rollback

- Protected pre-cutover checkpoint:
  `/Volumes/Avalon/backups/operation-skuld/kurisu-gpt-sovits-cutover-20260929T164028Z`.
- Manifest verification: 2823 files, zero missing, zero changed, zero
  symlinks, root mode `0700`.
- The checkpoint retains OminiX source/worker, MLX model, Kurisu reference,
  token, service source, tuner source and original LaunchAgent plist.
- The MPS PoC runtime, model, reference, generated audio, benchmarks and A/B
  evidence remain retained outside Git.

## Next action

Ask the owner to exercise the real production voice path once. Do not close
this Goal or start the deferred MLX optimization Goal until that result is
recorded. If the owner rejects the sound or resource behavior, restore the
protected pre-cutover route using the rollback checkpoint before stopping the
GPT-SoVITS runtime.
