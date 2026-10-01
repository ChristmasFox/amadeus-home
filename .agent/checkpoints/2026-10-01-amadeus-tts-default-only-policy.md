# Checkpoint — Amadeus TTS default-only local-first policy

Date: 2026-10-01 (Asia/Shanghai)
Status: **applied and verified**

The owner requested that production stop applying per-request emotions: all
valid emotion/style values normalize to `default`, every request attempts local
Qwen3-TTS MLX first, and cloud is used only after an operational local failure.
Emotion instruction code remains available behind an explicit future opt-in;
the deployed setting is disabled.

## Applied state

- Source commit: `5013800` (`feat(amadeus): default TTS emotions off in production`).
- 9Router image:
  `local/9router:git-5013800c8de2-20261001T045604Z`, image ID
  `sha256:816eb335fb382a3d1b2ad0e4bb62d0aa3e43cf9c318fe230ecdf78fba4ce425f`.
- Live Compose has `AMADEUS_TTS_EMOTIONS_ENABLED=false`; bridge health reports
  `emotionControlsEnabled=false` and retains local MLX → Qwen Audio 3.1 → 3.0.
- A production-shaped bridge request carrying a non-default `angry` style
  returned valid MP3 from `qwen3-tts-mlx`, with no cloud fallback. The bridge
  sent `style=default` to the local service.
- The executable bridge suite passes both default-only local normalization
  and explicit test-only emotion opt-in; local operational fallback behavior
  and cloud 3.1 → 3.0 order remain covered.
- Local Qwen health stayed ready at `127.0.0.1:18794`. No ASR, OpenClaw,
  ImageAssets, model/profile, credential or voice-ID configuration changed.
  No human listening or WhatsApp gate was requested or performed.

Validation: `node --check`, `node infra/docker/casaos/9router/test-tts-bridge.mjs`,
`pnpm check:secrets`, and `git diff --check` passed before apply; post-apply
health and the non-default-style local route smoke passed. The completion
state/documentation commit is recorded in Git after this checkpoint.
