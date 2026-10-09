# Qwen Image Lab Quality CFG 1 comparison deployment

Date: 2026-10-08 (Asia/Shanghai)

## Request and change

The operator requested a public Image Lab comparison using Quality at the
existing 16-step limit with CFG changed from 6 to 1. The Quality model, VAE,
sampler, base schedule, resolution limits, seed handling and 900-second
generation deadline are unchanged. Fast remains Fun-Acc/PDD at 4 steps and
CFG 1. No generation was submitted during this deployment; the operator will
review the result.

Source-managed values:

- `infra/macos/qwen-image-engine.json`: `baseline-16step`, 16 steps, CFG 1.
- `apps/qwen-image-service/bridge.py`: validates and reports Quality CFG 1.
- `infra/macos/qwen-image-fast-engine.json`: unchanged at 4 steps, CFG 1.

## Verification

- Focused bridge/UI suite: 32 tests passed.
- `pnpm check:secrets`: passed.
- Python compilation, macOS manager `bash -n`, and `git diff --check`: passed.
- Mac LaunchAgent restart completed; bridge health is `ready`, `idle`,
  `activeProfile=none`, with a 900000 ms generation deadline.
- Installed bridge and both engine configs match Git source. Installed Quality
  is 16 steps / CFG 1; installed Fast is 4 steps / CFG 1.
- No Image Lab task is active and no `sd-server` remains running. Public root
  and local UI each return HTTP 200. No login or image-generation request was
  made during deployment.

During restart, an idle Fast `sd-server` child from the previous bridge
survived as an orphan because it had been started in its own process group. The
task panel was empty, CPU use was 0%, its process group contained only that
engine, and port 18795 belonged to it. The child received SIGTERM and exited;
the loopback bridge is healthy and port 18795 is free. The next request will
load its selected profile normally.

## Protected pre-deploy snapshot

`/Users/nyannyan/Library/Application Support/Amadeus/backups/qwen-image-quality-cfg-before-20261008T101256Z`
contains the previously installed `bridge.py`, Quality config and Fast config,
each mode `0600`, plus a mode `0600` SHA-256 manifest inside a mode `0700`
directory. It excludes tokens and public-auth data.

## Rollback

Restore `bridge.py` and `qwen-image-engine.json` from the protected snapshot to
their Git source paths. Restore the corresponding Quality CFG validation,
health value, focused test expectation and documentation to CFG 6, then run
the focused checks and
`infra/macos/manage-qwen-image.sh --restart --apply`. Fast does not need to be
changed. The existing public UI route and authentication remain unchanged.
