# Qwen Image Lab full Flash Attention for both profiles

Date: 2026-10-09 (Asia/Shanghai)

## Request and change

The operator requested full Flash Attention (`--fa`) for both Quality and
Fast. Both profiles retain the 8-bit `q8_0` prefix cache. Quality remains the
base model at 16 steps / CFG 1; Fast remains 4 Fun-Acc/PDD steps / CFG 1.

Source-managed change:

- `infra/macos/qwen-image-engine.json`: remains `flashAttentionMode: full`,
  `prefixCacheType: q8_0`.
- `infra/macos/qwen-image-fast-engine.json`: adds `flashAttentionMode: full`,
  preserving `prefixCacheType: q8_0`, Fun-Acc/PDD, mmap and all other settings.
- `apps/qwen-image-service/bridge.py`: unchanged; `full` maps to `--fa` for
  either profile.

## Apply and verification

- Before restart, bridge health was ready/idle, the local task list was empty,
  and there were no established engine connections.
- The service was restarted from source with
  `infra/macos/manage-qwen-image.sh --restart --apply`.
- Post-deploy bridge health is ready/idle and the local task list is empty.
- Installed bridge and both profile JSON files match Git source. The installed
  Fast config reports `full`, `q8_0`, 4 steps, CFG 1 and `fun-acc-4step`.
- Local UI and `https://image.nyannyan.top/` return HTTP 200. JSON validation,
  `git diff --check`, and `pnpm check:secrets` passed.
- No image generation was submitted.

## Protected pre-deploy snapshot

`/Users/nyannyan/Library/Application Support/Amadeus/backups/qwen-image-fast-full-fa-before-20261009T040018Z`
contains the installed bridge, Quality and Fast JSON configs, and LaunchAgent
plist from before the change. The directory is mode `0700`; snapshot files and
SHA-256 manifest are mode `0600`. No runtime secrets are included.

## Rollback

Restore the snapshot's `bridge.py`, `qwen-image-engine.json`,
`qwen-image-fast-engine.json`, and LaunchAgent plist to their corresponding
paths under `~/Library/Application Support/Amadeus/QwenImage` and
`~/Library/LaunchAgents`, then run
`infra/macos/manage-qwen-image.sh --restart --apply`. This restores Fast to
its previous `--diffusion-fa` setting while Quality remains on `--fa` and
`q8_0`.
