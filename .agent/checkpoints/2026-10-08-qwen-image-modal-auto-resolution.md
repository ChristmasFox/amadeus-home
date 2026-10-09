# Qwen Image Lab task image modal and automatic edit sizing

Date: 2026-10-08 (Asia/Shanghai)

## Request and change

The operator asked to open task-history images in a modal without replacing the
main result preview, and to choose edit resolution automatically from the
reference image. Quality remains 16-step CFG 1; Fast and all model settings are
unchanged.

The Image Lab UI now fetches task-bound saved images into an independent modal
object URL. Reference edits send `resolution=auto`; the bridge preserves a
valid reference geometry or proportionally adapts it to the 1024px edge / 1MP
limit and 32px alignment. Reference image bytes and MIME remain unchanged. The
response and completed task record use the actual generated PNG dimensions.

## Pre-deploy verification

- Focused bridge and UI suite: 35 tests passed with the bundled Python 3.12.
- Python compilation, JavaScript syntax check, `git diff --check`, and
  `pnpm check:secrets` passed.
- Both Mac manager dry-runs passed. Bridge health was `ready` and `idle`; task
  status had no active task. Local UI and public HTTPS root returned HTTP 200.
- No login or image-generation request was made for this change.

The Command Line Tools Python 3.9 lacks `hashlib.scrypt`; the UI test suite was
therefore run with the Codex workspace Python 3.12 runtime, which provides it.

## Protected pre-deploy snapshot

`/Users/nyannyan/Library/Application Support/Amadeus/backups/qwen-image-modal-auto-before-20261008T2016+0800`
contains the installed bridge, UI Python, UI HTML, both LaunchAgent plists, and
a SHA-256 manifest. The directory is mode `0700`; files and manifest are mode
`0600`. It contains no authentication or bridge secrets.

## Rollback

Restore the three application files from the protected snapshot to their Git
source paths with mode `0644`, then run
`infra/macos/manage-qwen-image.sh --restart --apply` and
`infra/macos/manage-qwen-image-debug-ui.sh --apply` to sync and restart both
LaunchAgents. This returns Git source and runtime to the pre-deploy version.
Verify bridge health is ready and the local UI returns HTTP 200. Keep the
snapshot outside Git.

## Deployment result

`infra/macos/manage-qwen-image.sh --restart --apply` and
`infra/macos/manage-qwen-image-debug-ui.sh --apply` completed. The bridge is
`ready`/`idle`, local task status has no active task, the UI LaunchAgent serves
HTTP 200, and installed `bridge.py`, `debug_ui.py` and `debug-ui.html` match
their Git source hashes. The public HTTPS root returns 200 and its
unauthenticated task API returns 401. No login or generation request was made;
the operator can verify both behaviors with their own session.
