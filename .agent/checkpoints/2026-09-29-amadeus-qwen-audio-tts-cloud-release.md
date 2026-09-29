# Qwen Audio TTS cloud primary — owner accepted

Date: 2026-09-29 Asia/Shanghai.

## Source and runtime

- Source commits: `13ca03f` (Qwen Audio TTS cloud primary with M204 fallback) and
  `9347de1` (self-contained speech deployment checkpoint).
- Branch: `main`; Git source is clean and is two commits ahead of the recorded
  `origin/main` baseline.
- Host: OrbStack machine `nyannyan`.
- 9Router image: `local/9router:git-13ca03fa6fe0-20260929T051222Z`.
- OpenClaw image: `local/openclaw-amadeus:git-9e30a3dc08e8-20260928171059`.
- OpenClaw remains the sole Agent runtime and 9Router remains the speech
  control plane.

## Cloud voice and adapter

- Cloud model: `qwen-audio-3.0-tts-flash`.
- The cloned voice identity, API key, reference URL, sample, and generated
  media remain outside Git in protected runtime files.
- The 46-second authorized reference passed the 10–60 second validation.
- `amadeus-tts` sends one cloud request first and falls back at most once to
  the existing M204 OminiX endpoint only for transient/network/empty/invalid
  audio failures. Configuration and authorization failures remain failures.
- The existing `amadeus-asr` route was preserved.

## Verification

- Focused adapter, style, provisioning, smoke, OpenClaw lifecycle, architecture,
  secret, syntax and diff checks passed.
- Direct cloud smoke passed for default, angry, soft and embarrassed cases in
  MP3/WAV formats.
- Protected rollback checkpoint:
  `/DATA/AppData/9router/backups/qwen-audio-tts-deploy-20260929T051222Z`.
- Protected owner acceptance evidence:
  `/DATA/AppData/9router/backups/qwen-audio-tts-owner-acceptance-20260929T054329Z/evidence.json`.

## Real owner-channel acceptance

- A real typed explicit voice request produced one WhatsApp media reply. The
  9Router event was `provider=cloud`, and the owner confirmed playback.
- A real ordinary typed request produced text only; no `/v1/audio/speech`
  request occurred for that turn.
- A real inbound WhatsApp `audio/ogg; codecs=opus` message produced one media
  reply through `provider=cloud`; the owner confirmed playback.
- The CLI `openclaw agent --deliver` path was not used as acceptance because it
  bypasses the WhatsApp TTS lifecycle and can expose control tags as text.

No secrets, message bodies, phone numbers, audio files, voice IDs, or runtime
credentials are stored in this checkpoint.
