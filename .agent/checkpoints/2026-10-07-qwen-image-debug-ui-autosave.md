# Qwen LAN debug UI automatic image saving — 2026-10-07

The requested debug-page update automatically saves successful PNG generation
and edit results under `~/Pictures/Amadeus/QwenImage`. The directory is mode
`0700`, image files are created exclusively with mode `0600`, and each result
path is shown in the response, recent task history, and page status. Save
failures remain visible without discarding the generated image response. The
production GPT-only route, stable model bridge, and paused Fun-Acc candidate
are not changed.

Before deployment, focused UI tests (9), Python compilation, inline JavaScript
syntax, manager shell syntax, the FAST workflow plan, `pnpm check:secrets`, and
`git diff --check` passed. No real generation/edit was issued for acceptance.

Pre-update installed UI files and LaunchAgent were copied with restrictive
permissions to
`~/Library/Application Support/Amadeus/backups/qwen-image-debug-ui-autosave-20261007T2354`;
that directory contains `SHA256SUMS` for the protected copies. Rollback is to
restore those three files into `~/Library/Application Support/Amadeus/QwenImageDebugUI`
and `~/Library/LaunchAgents`, then reload only
`com.amadeus.qwen-image-debug-ui`.

The operator directly authorized deployment while a local generation request
was connected through UI port 18798 to the stable bridge and `sd-server` port
18795. `infra/macos/manage-qwen-image-debug-ui.sh --apply` completed and
restarted only the debug UI LaunchAgent; the bridge/model process was not
stopped or reconfigured. `/`, `/api/tasks`, unauthenticated `/api/models`, and
both current LAN addresses returned HTTP 200. Installed Python/HTML SHA-256
values match the repository files, the output directory is mode `0700`, and
the LaunchAgent arguments include that output directory. No real generation
was issued as a deployment smoke test.

After deployment, the bridge-to-engine connection was still established, but
the old UI-to-bridge socket was closed. The new UI task history is empty because
it is memory-only and reset on restart; the in-flight result could not be
confirmed or retrieved by the new page. Let that model request finish before
submitting another image request. The output directory will retain future
successful PNGs across UI restarts.
