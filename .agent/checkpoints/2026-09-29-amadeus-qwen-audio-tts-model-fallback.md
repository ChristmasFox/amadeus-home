# Amadeus Qwen Audio TTS model fallback — deployed

Date: 2026-09-29 Asia/Shanghai.

## Source and runtime

- Source commit: `13cbd55` (`feat: add qwen audio tts model fallback`).
- Runtime host: OrbStack machine `nyannyan`.
- Live image: `local/9router:git-13cbd559ab24-20260929T062044Z`.
- Protected rollback checkpoint: `/DATA/AppData/9router/backups/qwen-audio-tts-deploy-20260929T062044Z`.
- Existing OpenClaw image and ASR route were preserved.
- The upstream registry metadata pull stalled in the local BuildKit builder. The
  immutable tag was therefore built with the already deployed, protected
  9Router image as its local base and only the repository-owned TTS bridge was
  overlaid; the resulting image digest was loaded into the guest before the
  compose switch.

## Fallback contract

- Cloud order is `qwen-audio-3.1-tts-flash`, then
  `qwen-audio-3.0-tts-flash`, then the existing M204 OminiX local endpoint.
- Each cloud model has a separate protected cloned voice ID. The existing 3.0
  voice remains the second cloud attempt.
- Each cloud attempt is bounded to one request. Only timeout/network,
  408/429/5xx, empty audio, or invalid audio advances to the next provider;
  auth and configuration failures fail closed.
- Logs contain only model/provider/category and bounded size/timing buckets.

## Evidence

- The authorized 46-second sample passed voice enrollment for 3.1.
- Direct 3.1 smoke passed four emotion/format cases (MP3/WAV).
- Guest secrets for both cloud voice IDs are uid 1000/mode 0600.
- Live bridge smoke returned HTTP 200, provider `cloud`, valid MP3, and the
  container log recorded `model=qwen-audio-3.1-tts-flash attempt=1`.
- 9Router, ASR bridge, and TTS bridge health returned HTTP 200; unauthenticated
  published router access remained HTTP 401.
- Focused bridge/provisioning/smoke tests, workflow plan, secret scan, syntax,
  and diff checks passed.

## Temporary enrollment origin cleanup

The temporary guest HTTP server, frp proxy, and Caddy `audio.nyannyan.top`
site were removed after voice enrollment. The Cloudflare DNS record was not
changed because no Cloudflare credential is stored in the repository; remove
that record separately if it is still present. No sample bytes, API keys, voice
IDs, or runtime credentials are stored in this checkpoint.
