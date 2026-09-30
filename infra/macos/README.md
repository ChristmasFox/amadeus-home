# MacHostAgent

`machostagent.py` is a fixed-surface, bearer-authenticated, read-only HTTP service for the real
`Amadeus-M204` macOS host. It exposes only `/health`, `/v1/status`, and
`/v1/processes`; it has no shell, arbitrary path, or sudo endpoint. Set a
random token outside Git and install the example launchd plist as a LaunchAgent
or LaunchDaemon according to the existing M204 trust boundary. The OpenClaw
container only receives the two bounded telemetry tools.

The base user agent reports `power.telemetry=degraded` until the optional
privileged sampler is installed. For estimated Apple Silicon SoC power, run
`install-machostagent.sh --apply --accurate-power`; this installs a fixed,
root-owned LaunchDaemon that invokes `/usr/bin/powermetrics` with the current
macOS plist format and atomically publishes a fresh snapshot at
`/var/run/amadeus-machostagent-power.json`. The user agent reads only that
bounded snapshot and rejects samples older than 30 seconds. The API reports
`powerWatts`, CPU/GPU/ANE milliwatts, sample duration, `scope=soc`, and
`accuracy=estimated_soc_not_wall_input`. This is a short-window macOS SoC estimate, not accumulated energy. Missing subsystem values
remain null rather than being coerced to zero. Do not infer clock state from CPU load or
convert utilization into watts; whole-device input W and kWh require timestamped readings
from an external wall meter.

`install-machostagent.sh` is dry-run by default. It checks the M204 hostname and
only an explicit `--apply` installs the collector and user-level launchd job;
the token must already exist at
`~/Library/Application Support/Amadeus/machostagent.token` with mode 0600.
Add `--accurate-power` to the same apply only when the logged-in user can
authorize the one-time root LaunchDaemon installation. The HTTP service and
token remain in the user boundary; the root helper has no HTTP surface,
request handling, shell, or caller-controlled path.

Longbridge authorization is a separate operator action on M204. Use
`scripts/longbridge-oauth-authorize.mjs start`, open the printed URL, complete
the browser approval, and save the complete callback URL outside Git. Pipe that
callback URL to the `exchange` mode; the operator flow stores the short-lived
PKCE verifier and validates the returned OAuth `state` before exchanging the
code. The resulting OAuth state is written with mode 0600 to the external
`/DATA/AppData/openclaw/data` path; normal OpenClaw restarts only reuse that
state.

## M204 native Qwen3-TTS production rebaseline

`infra/macos/manage-qwen3-tts.sh` defaults to dry-run and reads the selected
engine from `infra/macos/qwen3-tts-engine.json`. Production is pinned Qwen3-TTS
1.7B Base through community `mlx-audio` 0.5.6, MLX 8-bit, the protected
original ~46s `kurisu-v1` A reference pair, and Auto language. The service
binds authenticated speech on loopback `127.0.0.1:18794`; the single
`com.amadeus.qwen3-tts` LaunchAgent owns that port. The local synthesis contract
is pure ICL with no prompt/style/speed/pitch mutation, one worker and a bounded
queue. The official PyTorch/MPS backend remains source-level emergency recovery
only and is not an automatic fallback.

Before `--apply`, verify the pinned protected MLX assets with
`infra/macos/verify-qwen3-mlx-assets.py` and confirm the reference pair/token
are mode 0600. `--prepare-apply` is only needed to construct missing pinned
assets or the protected token; it is not needed for an already verified
installation. `--apply` installs the selected source and LaunchAgent, waits for
real model warmup, and refuses to overlap another model worker. `--status`
reports the current agent/health; `--uninstall` removes only that agent and
preserves protected assets. Never add the reference audio, transcript,
embeddings, generated speech, or token to Git.

Read-only Phase 0 found that `127.0.0.1:18792` is already owned by the
separate ImageAssets LaunchAgent and used by OpenClaw. Preserve that endpoint
and avoid restarting OpenClaw; the Goal's explicit collision exception puts
Qwen TTS on free loopback port `18794`.

The authenticated local bridge at 9Router container loopback `:20130` routes
default requests to local MLX first and then Qwen Audio 3.1 and 3.0. Explicit
non-default styles bypass local cloning and use the cloud instruction path.
Configuration/auth/contract failures do not fall through. The active voice
path and destructive retirement sequence are specified by
`docs/AMADEUS_QWEN3_TTS_MLX_REBASELINE_GOAL.md`; this Goal waives new human
listening and WhatsApp acceptance while retaining automated health,
synthesis, fallback, rollback and cleanup gates.
