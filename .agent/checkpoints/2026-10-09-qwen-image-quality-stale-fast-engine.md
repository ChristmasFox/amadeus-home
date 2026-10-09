# Qwen Image Lab incomplete Quality result and stale Fast engine

Date: 2026-10-09 (Asia/Shanghai)

## Observation and diagnosis

The operator reported that a Quality 1024x1024 output looked visibly
incomplete despite being returned after about 1.5 minutes. The local task
record `bb4ea81b0097` says `quality`, `succeeded`, and 92,169 ms.

The engine listener on `127.0.0.1:18795` was PID 87616, started at 11:39:09,
well before the 12:00 bridge restart. Its command line was the old Fast
configuration: four steps, `--diffusion-fa`, Fun-Acc/PDD enabled and `q8_0`
prefix cache. The engine log contains PDD warnings forcing the sample to four
steps and VAE decode failures. The bridge's `start()` spawned the selected
engine, then treated any 200 response from the shared `/v1/models` endpoint as
readiness without confirming that the response came from its own child. This
allowed an orphaned server to be mistaken for the requested profile and is
consistent with the incomplete result.

## Source change

- `apps/qwen-image-service/bridge.py` now probes the configured loopback engine
  port before spawning. If another process owns it, startup fails closed rather
  than routing a request to that process.
- The bridge handles SIGTERM by unwinding through `finally` and `bridge.close()`,
  which stops the bridge-owned engine process group during LaunchAgent restart.
- `apps/qwen-image-service/test_bridge.py` covers the occupied-port refusal.
- Quality and Fast inference settings remain unchanged: full `--fa`, `q8_0`,
  Quality 16 steps and Fast 4 Fun-Acc/PDD steps.

Focused bridge tests (18), Python syntax compilation, secrets scan and
`git diff --check` passed. No image generation was submitted during this fix.

## Protected pre-deploy snapshot

`/Users/nyannyan/Library/Application Support/Amadeus/backups/qwen-image-stale-engine-fix-before-20261009T043141Z`
contains the installed bridge, both profile JSON files and the LaunchAgent
plist. The directory is mode `0700`; files and SHA-256 manifest are mode
`0600`. Runtime secrets and logs are not included.

## Apply, cleanup and verification

`infra/macos/manage-qwen-image.sh --restart --apply` installed the bridge fix.
Post-restart health is ready/idle. The stale Fast PID was revalidated as the
sole listener on `127.0.0.1:18795`, with no established engine connection and
no active task, then stopped with SIGTERM. The engine port is now free; no
`sd-server` process is resident until the next request selects a profile.

The installed bridge and profile JSON files match Git source. The local task
list is empty, and the local UI and `https://image.nyannyan.top/` return HTTP
200. The next Quality/Fast request will start its configured engine; no image
generation was submitted to validate the rendered output.

## Rollback

Restore `bridge.py`, both profile JSON files and the LaunchAgent plist from the
protected snapshot to their installed paths, then run
`infra/macos/manage-qwen-image.sh --restart --apply`. The snapshot predates the
SIGTERM cleanup and port ownership guard; a stale process must be stopped before
using the restored bridge.
