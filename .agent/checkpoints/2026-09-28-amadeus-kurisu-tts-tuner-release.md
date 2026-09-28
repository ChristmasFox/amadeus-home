# Amadeus Kurisu TTS Tuner — 1.6.7 completion checkpoint

Date: 2026-09-28 local (Asia/Shanghai)

## Scope and source

- Release: `1.6.7`; exactly one patch bump from the `1.6.6` production baseline.
- Source commit: `8d34857` (`release(amadeus): 1.6.7`).
- Canonical style source: `apps/qwen3-tts-service/kurisu_style.json`.
- Runtime drafts, history and audio remain outside Git under the protected tuner directory.

The original Goal accepted a loopback tuner. During finalization the owner explicitly requested LAN access. The released tuner therefore binds `0.0.0.0:18793`; Host/Origin allowlists include `127.0.0.1`, `localhost` and `192.168.5.3`. No public, mobile, 9Router, OpenClaw or channel route was added.

## Protected checkpoints

- Final pre-release protected checkpoint: `/Volumes/Avalon/backups/operation-skuld/qwen3-tts-tuner/final-pre-release-20260928T152346Z`.
- LAN bind pre-change checkpoint: `/Volumes/Avalon/backups/operation-skuld/qwen3-tts-tuner/lan-bind-prechange-20260928T154017Z`.
- Both are external to Git with protected directory/file permissions; reference media, model assets and tokens remain outside the repository.

## Runtime evidence

- `GET http://192.168.5.3:18793/api/v1/status`: `ready`, `bind=0.0.0.0`, `port=18793`, `residentModelCount=1`, `referenceEmbedding=cached`, `releaseVersion=1.6.7`.
- LAN UI root returned HTTP 200; an unexpected Host returned HTTP 403.
- Loopback status also succeeds; `lsof` shows one wildcard IPv4 listener on `*:18793`.
- Production `http://127.0.0.1:18792/healthz`: ready, model `qwen3-tts-1.7b`, voice `kurisu-v1`.
- The native process reports the pinned OminiX/model revisions and uses the same resident worker for production and Lab.
- Production remains priority over Lab samples; the observed interleaving was Lab → production → Lab while a two-sample Lab batch was active.
- Real controlled PROD/A/B style and sampling comparisons returned audio with prefill/generation/decode timings, frame counts and RTF.
- Production Lab-only fields continue to fail closed with `unsupported_production_field`.

## Promotion and notification evidence

- Hash-bound proposal `1435c4caa95449349a779ebc9955202a` passed dry-run/apply and hot style reload without a model reload.
- A stale proposal was rejected with HTTP 409.
- Candidate deployment owner outbox marker was observed sent; final release marker is `665604f5ef57f8aed59bbadd6e6788f3fa683837.sent.json` for `amadeus-release:1.6.7`.
- Final OpenClaw release deployment used image `local/openclaw-amadeus:git-8d34857de2aa-20260928152634` and reported health, Product Radar, NAS read-only smoke, owner notification and outbox smoke passed.

## Verification

- `python3 -m unittest discover -s apps/qwen3-tts-service/tests -v`: 46 tests, 1 skipped, all passed.
- Pinned OminiX Rust worker `cargo check`: passed.
- `scripts/accept-voice.sh --apply`: TTS health ready, WhatsApp linked/running/connected, technical voice runtime passed.
- `node scripts/check-architecture.mjs`: passed.
- `pnpm check:secrets`: passed.
- `./scripts/amadeus-version.sh check`: passed.
- `git diff --check`: passed before this documentation checkpoint was added.

This checkpoint contains no spoken text, audio, reference media, credentials or private runtime desired state.
