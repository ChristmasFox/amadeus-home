# Qwen Image Lab Quality Flash Attention and prefix cache comparison

Date: 2026-10-09 (Asia/Shanghai)

## Request and change

The operator requested a Quality profile comparison using full Flash Attention
(`--fa`) and Qwen Image 2.1 prefix cache `auto`. Quality remains the base
16-step profile at CFG 1. It does not enable the Fun-Acc/PDD argument or adapter.
Fast remains unchanged at 4 steps / CFG 1 with its existing `--diffusion-fa`,
`q8_0` prefix cache, mmap and Fun-Acc/PDD settings.

Source-managed changes:

- `infra/macos/qwen-image-engine.json`: `flashAttentionMode: full` and
  `prefixCacheType: auto`.
- `apps/qwen-image-service/bridge.py`: validates the optional runtime values,
  maps `full` to the exact `--fa` argument, and sends prefix-cache model args
  without enabling Fun-Acc for Quality.
- `infra/macos/qwen-image-fast-engine.json`: unchanged.

## Apply and verification

- Pre-deploy service health was ready/idle and the Image Lab task list was empty.
- `infra/macos/manage-qwen-image.sh --restart --apply` completed after the
  LaunchAgent finished checking local model assets.
- Post-deploy bridge health is ready/idle with the 900000 ms generation
  deadline. The task list is empty and no `sd-server` process or listener on
  port 18795 remains; the next Quality request will load the selected profile.
- Installed bridge and both engine JSON files match the Git source.
- Local UI and `https://image.nyannyan.top/` each return HTTP 200.
- Python syntax, both profile JSON files and `git diff --check` passed. No
  image generation was submitted.

## Protected pre-deploy snapshot

`/Users/nyannyan/Library/Application Support/Amadeus/backups/qwen-image-quality-fa-prefix-auto-before-20261009T024240Z`
contains the previously installed bridge, Quality and Fast JSON configs, and
LaunchAgent plist. The directory is mode `0700`; each file and the SHA-256
manifest are mode `0600`. The snapshot contains no token or public-auth data.

## Rollback

Restore `apps/qwen-image-service/bridge.py` and
`infra/macos/qwen-image-engine.json` from commit `a4dfefd`, then run
`infra/macos/manage-qwen-image.sh --restart --apply`. This returns Quality to
the prior CFG 1 settings with its baseline acceleration behavior. Fast and the
public UI/auth configuration are unchanged.
