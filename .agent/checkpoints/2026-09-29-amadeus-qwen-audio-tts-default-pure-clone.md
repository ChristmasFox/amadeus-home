# Qwen Audio TTS default pure voice clone — deployed

Date: 2026-09-29 (Asia/Shanghai)

## Source

- Source commit: `cc1ebfd` (`feat: make default qwen tts pure voice clone`)
- Runtime image: `local/9router:git-cc1ebfdeec3b-20260929T081836Z`
- Deployment worktree: temporary clean detached worktree at the source commit; the operator worktree's unrelated ReplyEnvelope changes were not touched.

## Request contract

For cloud `default`, `buildCloudRequest` sends only the protocol and cloning
inputs: `text`, model-bound `voice`, `format`, `sample_rate`, and
`language_hints: ["ja"]`. It does not add `instruction`, persona, style, speed,
or pitch controls. Non-default emotions continue to add the bounded emotion
instruction. The two model-bound cloned voice files and all keys remain in the
protected 9Router runtime and are not recorded here.

## Verification

- `node infra/docker/casaos/9router/test-tts-bridge.mjs` — passed.
- `python3 -m py_compile scripts/smoke-qwen-audio-tts.py` — passed.
- `node --check infra/docker/casaos/9router/tts-bridge.mjs` — passed.
- `python3 scripts/smoke-qwen-audio-tts.py --dry-run --target-model qwen-audio-3.1-tts-flash` — passed.
- `pnpm check:secrets` — passed.
- Live 9Router, ASR bridge, and TTS bridge health checks — HTTP 200.
- Live default request returned cloud MP3 audio (HTTP 200, 28,411 bytes, ID3 header) with `X-Amadeus-TTS-Provider: cloud`.

## Rollback

Protected runtime checkpoint created before the switch:
`/DATA/AppData/9router/backups/qwen-audio-tts-deploy-20260929T081836Z`.
Restore its compose/env/secrets snapshot and the exported previous image if a
rollback is required. No secrets or audio samples are stored in Git.
