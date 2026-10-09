# Qwen Image Lab engine configs restored from origin/main

Date: 2026-10-09 (Asia/Shanghai)

## Request and restored settings

After reviewing the Quality result, the operator requested the previous remote
configuration. `infra/macos/qwen-image-engine.json` and
`infra/macos/qwen-image-fast-engine.json` were restored exactly from
`origin/main`.

- Quality: base model, 16 steps / CFG 1; no explicit Flash Attention mode or
  prefix-cache type. The bridge's legacy defaults select `--diffusion-fa` and
  no prefix-cache model args.
- Fast: Fun-Acc/PDD, 4 steps / CFG 1; legacy `flashAttention: true` selects
  `--diffusion-fa`, with `q8_0` prefix cache and mmap.
- The bridge's stale-engine port guard and SIGTERM child cleanup are retained.

## Apply and verification

- A protected snapshot was made before restoring the engine configs.
- Both source JSON files match `origin/main`; the installed bridge and both
  installed profile files match Git source.
- Post-deploy bridge health is ready/idle, the local task list is empty, and no
  engine listener is resident until a profile request. Local UI and
  `https://image.nyannyan.top/` return HTTP 200. `git diff --check` passed.
- No image generation was submitted as part of this rollback.

## Protected pre-deploy snapshot

`/Users/nyannyan/Library/Application Support/Amadeus/backups/qwen-image-origin-config-before-20261009T053655Z`
contains the installed bridge, both engine JSON files, and LaunchAgent plist.
The directory is mode `0700`; files and SHA-256 manifest are mode `0600`. No
runtime secrets or logs are included.

## Rollback

Restore `qwen-image-engine.json` and `qwen-image-fast-engine.json` from the
snapshot to `~/Library/Application Support/Amadeus/QwenImage`, then run
`infra/macos/manage-qwen-image.sh --restart --apply`. Keep the installed bridge
from Git so the stale-engine port guard and SIGTERM child cleanup remain active.
