# M204 native Qwen3-TTS MLX service

The production local engine is the owner-accepted Qwen3-TTS 1.7B Base through
pinned `mlx-audio` 0.5.6 with the 8-bit
`mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit` model. It uses the original
operator-owned `kurisu-v1/reference.wav` + matching `reference.txt` profile,
`lang_code="auto"`, pure ICL cloning, one model worker, and a bounded FIFO
queue. The local engine does not receive persona/instruction/style/speed/pitch
controls. Non-default style requests are handled by the 9Router cloud path.

`infra/macos/qwen3-tts-engine.json` is the declarative source for pinned source,
model, and dependency revisions. The protected MLX assets remain under the
historical `~/Library/Application Support/Amadeus/speech/mlx-poc/` path to
avoid copying the prepared model or venv. `verify-qwen3-mlx-assets.py` checks
that source, model files, dependency versions, and private permissions match
the protected manifest before service apply.

The authenticated OpenAI-compatible service binds **only** to
`127.0.0.1:18794`; the OrbStack 9Router guest reaches the host loopback through
`host.docker.internal`. `/healthz` exposes readiness and provider/model identity;
`/v1/audio/speech` and `/v1/voices` require the protected Bearer token. The
logical bridge order is local `qwen3-tts-mlx`, Qwen Audio 3.1, then Qwen Audio
3.0. Configuration/auth/contract errors fail closed; operational local errors
may fall through to cloud.

The live host has a separate Amadeus ImageAssets listener on
`127.0.0.1:18792`, so the Goal's explicit collision exception selects the
verified-free TTS port `127.0.0.1:18794`. ImageAssets and OpenClaw configuration
remain unchanged; the Qwen endpoint is still loopback-only.

Run `infra/macos/manage-qwen3-tts.sh --dry-run` to inspect the selected MLX
profile and protected paths. `--apply` installs the checked service source and
LaunchAgent; `--prepare-apply` is only needed if pinned assets or the token must
be prepared. The exact historical voice acceptance is documented at commit
`c8f9261d1c093a8188db802c73a38a998d018944`; this Goal does not claim new human
listening acceptance.
