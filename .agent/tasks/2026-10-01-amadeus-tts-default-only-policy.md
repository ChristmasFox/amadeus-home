# Amadeus TTS default-only local-first policy follow-up

Date: 2026-10-01 (Asia/Shanghai)
Status: `COMPLETE`

## Owner request

Current production TTS must not apply per-request emotions. Normalize every valid
style/emotion input to the accepted default voice, always try the local Qwen3-TTS
MLX service first, and use cloud only after an operational local failure. Keep
the emotion instruction implementation available for a future explicit opt-in,
but disabled in production.

## Scope and invariants

- Keep the current Qwen3-TTS MLX 1.7B Base / 8-bit / `kurisu-v1` A / Auto
  local service, port `18794`, loopback bind and protected token unchanged.
- Keep Qwen Audio 3.1 -> 3.0 only as operational local-failure fallback.
- Keep emotion/style instructions in source behind
  `AMADEUS_TTS_EMOTIONS_ENABLED`; production compose must explicitly set it to
  false. Health reports whether the opt-in is enabled.
- Invalid styles/contracts fail closed; a valid non-default emotion is
  normalized to `default` while the flag is false.
- Do not change ASR, OpenClaw, ImageAssets, profile/audio assets or provider
  credentials/voice IDs. Human listening and WhatsApp acceptance are not
  requested by this follow-up.

## Acceptance

1. Focused bridge tests prove a non-default valid request is sent to local MLX
   with `style=default`, and the future opt-in still selects the preserved cloud
   emotion implementation.
2. Existing local operational-failure and 3.1 -> 3.0 ordering tests remain
   green; configuration/auth/contract errors remain fail-closed.
3. Secrets scan, source integrity and `git diff --check` pass.
4. Dry-run, explicit 9Router `--apply`, bridge/local health and a logical
   non-default-style route smoke pass; the returned provider is local MLX.
5. Source/state documentation is committed and pushed to `main`.

## Completion evidence

Commit `5013800` is deployed in 9Router image
`local/9router:git-5013800c8de2-20261001T045604Z`
(`sha256:816eb335fb382a3d1b2ad0e4bb62d0aa3e43cf9c318fe230ecdf78fba4ce425f`).
Compose explicitly sets `AMADEUS_TTS_EMOTIONS_ENABLED=false`; bridge health
reports it disabled. A valid non-default `angry` request returned local
`qwen3-tts-mlx` audio and no cloud fallback. Bridge tests, secrets scan,
post-apply health and `git diff --check` passed. Detailed evidence is in
`.agent/checkpoints/2026-10-01-amadeus-tts-default-only-policy.md`.
