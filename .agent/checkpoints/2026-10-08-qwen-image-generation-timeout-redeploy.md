# Qwen Image Lab generation timeout redeployment

Date: 2026-10-08 (Asia/Shanghai)

## Trigger

Quality task `d944ea5200d3` failed after 610003 ms with
`qwen_ui_timeout` / HTTP 504. The prior bridge generation deadline was 600
seconds and the UI proxy stopped waiting after 610 seconds. The task was no
longer active before restart and was not retried automatically.

## Change

- Quality and Fast engine generation deadlines are 900000 ms.
- The UI-to-bridge generation proxy deadline is 910 seconds, leaving 10 seconds
  to return the bridge response to the browser.
- Model load remains separately limited to 600000 ms.
- The bridge LaunchAgent manager now retries `launchctl bootstrap` up to ten
  times at one-second intervals after the first apply returned macOS error 5.
- The timeout is server-side only; it is not exposed as a UI control.

## Verification

- `PYTHONPATH=apps/qwen-image-service python3 -m unittest test_bridge`: 15 passed.
- `PYTHONPATH=apps/qwen-image-service python3 -m unittest test_debug_ui`: 17 passed.
- Python compilation, both macOS manager `bash -n` checks,
  `pnpm check:secrets`, `git diff --check` and `pnpm workflow:plan` passed.
- The workflow planner selected FAST; no Docker build or CasaOS deployment was
  required for this Mac-local Image Lab update.
- Bridge health is `ready`, `idle`, and reports `deadlineMs: 900000`.
- Both installed engine configs report a 900000 ms generation deadline and a
  600000 ms load deadline. Bridge, UI Python/HTML and config files match Git
  source bytes.
- The UI LaunchAgent is loaded; local root and model-discovery smoke passed.
- `https://image.nyannyan.top/` returned 200 with the login page. Unauthenticated
  `/api/health`, `/api/models`, `/api/tasks`, and a generation POST carrying the
  exact public Origin returned 401. No login attempt or public generation was
  made; the operator will validate the session.

## Protected pre-deploy snapshot

`~/Library/Application Support/Amadeus/backups/qwen-image-timeout-before-20261008T084228Z`
contains seven mode-0600 runtime files and a SHA-256 manifest, inside a
mode-0700 directory. The snapshot is outside Git and excludes credentials.

## Rollback

Use the protected snapshot above to restore the prior bridge/UI files, engine
configs and LaunchAgent plists. Boot out the affected LaunchAgents, restore the
files with their recorded permissions, then bootstrap the saved plists. This
returns the generation deadline to 600 seconds and the UI proxy deadline to
610 seconds. Keep bridge/model ports loopback-only and leave the public route
and production GPT-only image path unchanged.

## Remaining acceptance

The timed-out Quality task remains failed; it was not resumed automatically.
Fast smoke, a new Quality image request, the operator's authenticated public
session and one public image request remain pending. Amadeus production image
routing remains GPT-only, with Qwen fallback disabled.
