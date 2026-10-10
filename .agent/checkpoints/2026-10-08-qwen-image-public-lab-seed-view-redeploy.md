# Image Lab task image viewer and seed precision redeploy — 2026-10-08

## Scope

Add a task-history image viewer for successfully saved PNG output and preserve
large seeds across browser input, API submission, task history and result
display. Redeploy only the macOS Image Lab UI. The VPS Caddy/frps and HomeLab
frpc route did not need changes.

## Protected rollback checkpoint

The previous installed Mac UI files and LaunchAgent plist are preserved outside
Git at:

```text
~/Library/Application Support/Amadeus/backups/qwen-image-public-lab-ui-before-seed-view-20261008T082412Z
```

The directory is `0700`; its files and `SHA256SUMS` are `0600`. It contains no
bridge token or password verifier.

## Source changes

- Added `查看图片` for completed tasks with a saved image. The server reads only
  the PNG linked to the exact in-memory task ID, enforces the configured output
  directory, no-follow file opens, regular-file and 20 MiB limits, and PNG
  signature validation. The public route requires the existing session and
  never returns local paths.
- Replaced the numeric seed input with decimal text and BigInt validation,
  supporting `-1` through `9223372036854775807`. The browser submits the exact
  decimal string; the debug server validates and converts it to an integer
  before forwarding to the bridge. Unsafe JavaScript integer values are
  serialized as decimal strings for task/result display.
- The LaunchAgent manager now retries `bootstrap` up to ten times at one-second
  intervals after `bootout`, addressing a reproducible transient macOS launchd
  error 5 on an immediate reload.

## Validation and apply evidence

- `pnpm workflow:plan`: FAST; no Docker build or CasaOS deployment.
- `PYTHONPATH=apps/qwen-image-service python3 -m unittest test_bridge`: 15 passed.
- `PYTHONPATH=apps/qwen-image-service python3 -m unittest test_debug_ui`: 16 passed.
- Python compilation, both Qwen macOS manager shell syntax checks, secret scan
  and `git diff --check`: passed.
- `infra/macos/manage-qwen-image-debug-ui.sh --apply`: completed after the
  bounded bootstrap retry; LAN page and local model-discovery smoke passed.
- Local served UI contains the viewer and large-seed control.
- `https://image.example.com/`: valid HTTPS, password login page, HTTP 200.
  Unauthenticated `/api/health`, `/api/models`, `/api/tasks` and
  `/api/generations` each return HTTP 401.
- No public login, authenticated public API call or public image generation was
  performed; the operator will verify their own session.

## Known remaining acceptance

The earlier local Quality 1024x1024 fixed-seed smoke timed out at 600 seconds
after 15/16 steps and returned HTTP 504. It is not running. Fast smoke and
operator-authenticated public image acceptance remain open. The production
OpenClaw image route was not modified.

## Rollback

Restore `debug_ui.py`, `debug-ui.html` and
`com.amadeus.qwen-image-debug-ui.plist` from the protected directory above into
their original installed paths, preserving `0700` for the Python file and
`0600` for the HTML and plist. Then reload only
`com.amadeus.qwen-image-debug-ui` through the GUI launchd domain, allowing the
manager's bounded retry interval. Keep the public route behind the existing
password-authenticated UI; do not restore an unauthenticated public surface.
