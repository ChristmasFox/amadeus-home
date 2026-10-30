# MacHostAgent

`machostagent.py` is a fixed-surface, bearer-authenticated, read-only HTTP service for the
operator-configured macOS host. It exposes only `/health`, `/v1/status`, and
`/v1/processes`; it has no shell, arbitrary path, or sudo endpoint. Set a
random token outside Git and install the example launchd plist as a LaunchAgent
or LaunchDaemon according to the operator host profile. The OpenClaw
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

`install-machostagent.sh` is dry-run by default. It checks the configured host
name and storage path, and only an explicit `--apply` installs the collector and user-level launchd job;
source those values from the operator profile as `MAC_HOST_NAME` and
`MACHOSTAGENT_STORAGE_PATH` before applying;
the token must already exist at
`~/Library/Application Support/Amadeus/machostagent.token` with mode 0600.
Add `--accurate-power` to the same apply only when the logged-in user can
authorize the one-time root LaunchDaemon installation. The HTTP service and
token remain in the user boundary; the root helper has no HTTP surface,
request handling, shell, or caller-controlled path.

Longbridge authorization is a separate operator action on the configured Mac. Use
`scripts/longbridge-oauth-authorize.mjs start`, open the printed URL, complete
the browser approval, and save the complete callback URL outside Git. Pipe that
callback URL to the `exchange` mode; the operator flow stores the short-lived
PKCE verifier and validates the returned OAuth `state` before exchanging the
code. The resulting OAuth state is written with mode 0600 to the external
`/DATA/AppData/openclaw/data` path; normal OpenClaw restarts only reuse that
state.

## Native Qwen3-TTS production rebaseline

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
all production requests to local MLX first, normalizing valid styles/emotions
to the default voice, then Qwen Audio 3.1 and 3.0 only on operational local
failure. Future emotion handling remains behind the disabled
`AMADEUS_TTS_EMOTIONS_ENABLED` opt-in. Configuration/auth/contract failures do
not fall through. The active voice
path and destructive retirement sequence are specified by
`docs/AMADEUS_QWEN3_TTS_MLX_REBASELINE_GOAL.md`; this Goal waives new human
listening and WhatsApp acceptance while retaining automated health,
synthesis, fallback, rollback and cleanup gates.

## Fish Audio S2 Pro TTS (replaces the Qwen3-TTS LaunchAgent on `127.0.0.1:18794`)

`com.amadeus.fish-tts` serves the same authenticated OpenAI-compatible
`/v1/audio/speech` contract as the Qwen service (same `service.py`, selected with
`AMADEUS_TTS_ENGINE=fish`), so the 9Router TTS bridge and its cloud fallback are unchanged.
It clones `voices/kurisu-v1` (46 s reference + transcript) with
`mlx-community/fish-audio-s2-pro-8bit`; the 8-bit checkpoint only loads because
`fish_engine.py` overrides mlx-audio's `model_quant_predicate` (the loader skipped
embeddings and `fast_*` layers that the checkpoint had quantized). Output stays mp3 so the
WhatsApp plugin transcodes it to Opus. Fish emotion tags (`[angry]`, `[whisper]`, ...) pass
through the input text; nothing adds them automatically and the `style` field stays `default`.

Runtime layout (not in Git): `~/Library/Application Support/Amadeus/speech-fish/{venv,service.py,engine_contract.py,fish_engine.py}`,
venv from `requirements-fish-tts.txt` (separate from the Qwen MLX venv), token shared with
`speech/tts.token`, log `~/Library/Logs/Amadeus/fish-tts.log`, `HF_HUB_OFFLINE=1`.

Roll back to Qwen3-TTS (models and venv are kept):

```sh
launchctl bootout gui/$(id -u)/com.amadeus.fish-tts
rm ~/Library/LaunchAgents/com.amadeus.fish-tts.plist
cp "$HOME/Library/Application Support/Amadeus/speech/rollback/com.amadeus.qwen3-tts.plist" ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.amadeus.qwen3-tts.plist
```
