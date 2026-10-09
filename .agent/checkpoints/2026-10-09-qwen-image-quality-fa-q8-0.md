# Qwen Image Lab Quality Flash Attention with q8_0 prefix cache

Date: 2026-10-09 (Asia/Shanghai)

## Request and change

The operator clarified that the requested configuration is full Flash
Attention (`--fa`) with the 8-bit `q8_0` prefix cache. Quality remains the
base 16-step profile at CFG 1, without Fun-Acc/PDD arguments or adapter. Fast
remains unchanged.

Source-managed change:

- `infra/macos/qwen-image-engine.json`: `flashAttentionMode: full` and
  `prefixCacheType: q8_0`.
- `infra/macos/qwen-image-fast-engine.json`: unchanged.
- `apps/qwen-image-service/bridge.py`: unchanged; it maps `full` to `--fa`
  and passes the configured cache type as model arguments.

## Apply and verification

- Before the final restart, bridge health was ready and the local Image Lab
  task list was empty. No generation was submitted.
- A first restart briefly installed a config without prefix cache after the
  initial request was misunderstood. The operator corrected the setting before
  any image generation; the final source and runtime target are `q8_0`.
- `infra/macos/manage-qwen-image.sh --restart --apply` completed. The bridge
  reports ready/idle with no active profile; the local task list is empty.
- Installed bridge and both profile JSON files match Git source. The installed
  Quality config reports `full`, `q8_0`, 16 steps and CFG 1.
- Local UI and `https://image.nyannyan.top/` return HTTP 200. JSON validation,
  `git diff --check`, and `pnpm check:secrets` passed. No image was generated.

## Protected pre-deploy snapshot

`/Users/nyannyan/Library/Application Support/Amadeus/backups/qwen-image-quality-fa-no-cache-before-q8-0-20261009T035146Z`
contains the installed bridge, Quality and Fast JSON configs, and LaunchAgent
plist from immediately before the final `q8_0` restart. The directory is mode
`0700`; snapshot files and SHA-256 manifest are mode `0600`. No runtime secrets
are included.

## Rollback

Restore the snapshot's `bridge.py`, `qwen-image-engine.json`,
`qwen-image-fast-engine.json`, and LaunchAgent plist to their corresponding
paths under `~/Library/Application Support/Amadeus/QwenImage` and
`~/Library/LaunchAgents`, then run
`infra/macos/manage-qwen-image.sh --restart --apply`. The original `--fa` plus
`auto` trial snapshot is also preserved at
`~/Library/Application Support/Amadeus/backups/qwen-image-quality-fa-prefix-auto-before-20261009T024240Z`.
