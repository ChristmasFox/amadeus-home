# MacHostAgent

`machostagent.py` is a fixed-surface, bearer-authenticated, read-only HTTP service for the real
`Amadeus-M204` macOS host. It exposes only `/health`, `/v1/status`, and
`/v1/processes`; it has no shell, arbitrary path, or sudo endpoint. Set a
random token outside Git and install the example launchd plist as a LaunchAgent
or LaunchDaemon according to the existing M204 trust boundary. The OpenClaw
container only receives the two bounded telemetry tools.

`powermetrics` is optional. If the helper lacks the required privilege, the
agent remains healthy and reports `power.telemetry=degraded` while CPU, memory,
disk, network, process, and service facts continue to be collected.

`install-machostagent.sh` is dry-run by default. It checks the M204 hostname and
only an explicit `--apply` installs the collector and launchd job; the token
must already exist at the protected path outside Git.

Longbridge authorization is a separate operator action on M204. Use
`scripts/longbridge-oauth-authorize.mjs start`, open the printed URL, complete
the browser approval, and save the complete callback URL outside Git. Pipe that
callback URL to the `exchange` mode; the operator flow stores the short-lived
PKCE verifier and validates the returned OAuth `state` before exchanging the
code. The resulting OAuth state is written with mode 0600 to the external
`/DATA/AppData/openclaw/data` path; normal OpenClaw restarts only reuse that
state.
