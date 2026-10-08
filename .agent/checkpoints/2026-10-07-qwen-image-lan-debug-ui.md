# Qwen image LAN debug UI — 2026-10-07

The operator requested a local web page for direct Qwen image generation and
reference-image editing from trusted LAN devices. The production Amadeus image
route remains GPT-only; this UI is a separate, manual diagnostic surface and
does not change OpenClaw, 9Router, or any fallback configuration.

Before activation, the stable authenticated Qwen bridge was listening only on
127.0.0.1:18793. A paused Fun-Acc candidate listener was present on
127.0.0.1:18796 and must remain untouched. Port 18798 was not listening and
the debug UI LaunchAgent was not loaded. Current Mac LAN addresses were
192.168.5.3 (en0) and 192.168.5.112 (en1).

Focused UI tests, Python compilation, shell syntax, plist lint, secrets scan,
and `git diff --check` passed before activation. The UI proxy is pinned to the
loopback bridge, keeps the bridge bearer token server-side, allows private or
loopback clients without a UI login, checks private/loopback Host addresses,
and accepts only same-origin writes. The UI supports one image generation or
one PNG/JPEG/WebP reference edit at a time. No real image generation or edit
request is part of activation acceptance.

Activation is performed with
`infra/macos/manage-qwen-image-debug-ui.sh --apply`. Rollback is
`infra/macos/manage-qwen-image-debug-ui.sh --stop --apply`; this unloads only
the debug UI LaunchAgent and leaves the stable bridge and paused candidate
unchanged. The temporary UI access-code file from the first implementation is
removed during the no-login update; no UI login secret is needed.

After the operator clarified that all private-LAN clients should be allowed
without a login, the login flow was removed. The first `--apply` encountered a
transient `launchctl bootstrap` error 5 after unloading the prior UI agent; a
manual bootstrap of the installed plist succeeded. The agent is now running,
`/` returns HTTP 200, and unauthenticated `/api/models` returns the expected
local model over loopback and both current LAN addresses. The bridge remains
`ready/idle` with reference edits enabled. No actual generation/edit was
started from the UI. The old access-code file was removed after successful
unauthenticated model-discovery checks.
