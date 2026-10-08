# Qwen Image Service

This Mac-only service is the authenticated local boundary for Qwen-Image-2.1
generation and single-reference edits. It proxies only the two OpenAI image
endpoints, binds both bridge and `sd-server` to loopback, validates pinned
asset/runtime hashes before listening, permits one running generation plus
one bounded waiter, and shuts down the Metal model after three idle minutes.

The model and runtime files remain under `/Volumes/Avalon/models` and are not
stored in Git. Their pinned repository revisions, byte counts and SHA-256
values live in `infra/macos/qwen-image-engine.json` and the active Goal.

Run `infra/macos/manage-qwen-image.sh --dry-run` to inspect the intended local
setup. All LaunchAgent mutations require `--apply`; start and restart also
require the `Amadeus-M204` host. The manager refuses to start while the Krea
LaunchAgent is loaded. Uninstall preserves model files and the Qwen token.

The bridge applies the measured 16-step/CFG-6 setup and a 600-second image
request deadline. Edits default to strength 0.9, retain the exact uploaded
reference bytes and MIME type, and derive safe 32-pixel-aligned canvas geometry
from the reference rather than imposing a portrait default.

## LAN debug UI

`infra/macos/manage-qwen-image-debug-ui.sh` installs a lightweight Python
LaunchAgent serving a local text-to-image and reference-edit page on TCP
18798. It proxies only to the stable loopback bridge at 127.0.0.1:18793; the
separately paused acceleration candidate on 18796 is not used. The model bridge
and Metal engine remain loopback-only, and the UI does not add another model
process.

The UI binds the host interfaces and allows all private/loopback clients
without a login. Same-origin writes are required, while the model bridge token
stays server-side. Use the URL printed by the manager from any device on the
LAN. Do not forward port 18798 from the router.

Run `infra/macos/manage-qwen-image-debug-ui.sh` for a dry-run, then pass
`--apply` to install/start or update the LaunchAgent. Use `--status` to inspect,
and `--stop --apply` to stop. The UI supports PNG, JPEG, and WebP reference
edits up to 10 MB and single-image generation up to 1024 pixels per edge. The
first image request may take several minutes while the existing bridge loads
the Metal model; the model process still shuts down after its configured idle
time.

The page polls a LAN-readable task endpoint and shows tasks submitted through
the debug UI: active generation/edit, elapsed time, recent completion/failure
status, and a short failure summary. The last 30 task records live in the UI
process memory and remain visible across page reloads until the UI service
restarts; prompts and image bytes are not written to disk by this history
feature.

Successful PNG outputs are automatically saved to
`~/Pictures/Amadeus/QwenImage` with mode `0600`; the directory is restricted to
mode `0700`. The page and recent task history show each saved path. Images are
kept across UI restarts, while in-memory task history is reset.
