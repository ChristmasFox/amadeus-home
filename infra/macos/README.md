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

## M204 native Qwen3-TTS (1.5.3 candidate)

`infra/macos/manage-qwen3-tts.sh` defaults to dry-run. `--prepare-apply` installs the pinned venv/model outside Git; `--apply` requires the protected external voice pair and token, installs the user LaunchAgent `com.amadeus.qwen3-tts` and binds authenticated speech on port 18792. User-session launchd keeps MPS available. `--status` reports launchd and `/healthz`; `--uninstall` removes the agent without erasing voice/model/token. Before any apply with new user-supplied audio, `infra/macos/backup-qwen3-tts-profile.sh --apply` copies the reference pair and TTS token to a mode-0700 Avalon checkpoint and stores integrity hashes only in its protected manifest. Never upload reference media, transcript, embeddings or token to Git or a public route.

M204 currently has a personally approved interim reference and the service was launched only after protected backup. Local Mandarin/Japanese synthesis, auth/format checks, guest-to-host health and launchd restart recovery are engineering acceptance, **not** 9Router or real WhatsApp voice acceptance. The original-voice requirement in the Goal remains a separate product-quality decision.
