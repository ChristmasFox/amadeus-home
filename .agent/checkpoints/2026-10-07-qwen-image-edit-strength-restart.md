# Qwen image edit strength correction — 2026-10-07

The operator reported successful color edits but three pose/camera edits with
little visible change and authorized a commit and local service restart. The
WhatsApp requests reached the local single-reference edit endpoint, returned
HTTP 200, and each delivered one result. This was not a resend of the original
file. The pinned `sd-server` reads `strength` in `sd_cpp_extra_args`, whereas
the bridge previously supplied `denoising_strength`; the effective value was
its default 0.75 rather than the bridge's intended 0.9.

Commit `6b7623e` changes the native extra argument to `{"strength":0.9}` and
adds a test asserting the exact wire payload. The 11 bridge tests, secrets
scan, and diff check passed before restart. No OpenClaw/9Router image rebuild,
Compose switch, or version bump was needed.

Before the authorized restart, the previous installed bridge/config/plist
were copied to the protected local directory
`~/Library/Application Support/Amadeus/QwenImage/backups/edit-strength-20261006T193713Z`.
The first `launchctl bootstrap` immediately after `bootout` failed with launchd
error 5, briefly making the bridge unavailable. A subsequent manual bootstrap
succeeded. The new LaunchAgent process started, verified its pinned model
assets (about two minutes before opening the listener), and reported
`ready/idle`, `referenceEdits=true`, deadline 600000 ms on loopback port 18793.
The installed bridge SHA-256 matched the Git source. An authenticated request
from the running OpenClaw container to `/v1/models` returned HTTP 200 and
`local/qwen-image-2.1-uncensored`. OpenClaw remained healthy with
`AMADEUS_QWEN_IMAGE_LOCAL_ONLY=1`; 9Router was not restarted.

This proves installation, startup and authenticated reachability, not that the
stronger edit will satisfy a pose change. The operator will perform the real
WhatsApp visual acceptance. If it fails, inspect the generated result and
prompt before changing parameters again. The protected pre-restart copies
provide local bridge rollback; the existing OpenClaw candidate checkpoint
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261006185442` remains the
route rollback boundary.
