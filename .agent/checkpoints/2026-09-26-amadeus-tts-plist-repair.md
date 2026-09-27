# Amadeus TTS LaunchAgent plist same-value repair — 2026-09-26

## Scope and authorization

Runtime recovery only, not a product release. The owner explicitly authorized a same-value plist repair and controlled reload after the production LaunchAgent file was found invalid. The released `1.6.2` TTS engine, model, A reference, language, `ProcessType`, port/bind, worker/admission policy, timeout, response format, and `MAX_TEXT` were not changed.

## Pre-change evidence

- Git `HEAD`/`main`/`origin/main`: `858eaea783d51a2183732697bce059d8c03c8137`; `VERSION=1.6.2`.
- On-disk `~/Library/LaunchAgents/com.amadeus.qwen3-tts.plist` was a JSON array of two path strings; `plutil -lint` failed. `manage-qwen3-tts.sh --status` used its `|| printf mps` fallback and therefore misreported `ENGINE=mps`.
- The already-loaded launchd job was healthy and showed `AMADEUS_TTS_ENGINE=mlx`, `spawn type=interactive (4)`, PID `26512`, `runs=1`; `/healthz` returned ready. `libmlx.dylib` was mapped, Torch libraries were not. Installed service source matched Git SHA-256 `de6780fc0b96a6dea1be790a64b9f9c72bc299f433f968ef5bfb5ade16ce393a`.
- The original protected A reference pair still matched the protected pre-MLX baseline. Pinned MLX assets verified. The 9Router-to-host TTS health route passed.
- Protected pre-change copy and validated same-value candidate: `/Volumes/Avalon/backups/operation-skuld/qwen3-tts/boundary-plist-repair-2026-09-26` (directory `0700`, files `0600`). It contains the invalid plist copy, the valid Git-rendered candidate, and a sanitized before/after manifest; no token value, voice reference bytes/text, or user content.

## Action

```sh
infra/macos/manage-qwen3-tts.sh --apply-plist-only --engine mlx
```

The candidate was rendered from `infra/macos/com.amadeus.qwen3-tts.plist.example`, validated with `plutil -lint`, and compared against the already-loaded MLX/Interactive job before apply. Only the malformed on-disk declaration was restored to those same effective values; the manager retired the old LaunchAgent and bootstrapped the same single backend. No second process was overlapped.

## Post-change verification

- Disk plist is valid and byte-identical to the prevalidated candidate.
- LaunchAgent is `running`, spawn type `interactive (4)`, PID `50062`, `runs=1`; active environment reports MLX.
- `/healthz`: ready, model `qwen3-tts-1.7b`, voice `kurisu-v1`.
- Installed service source still matches Git; MLX library mapping verified and no Torch library mapping observed.
- `ProcessType=Interactive`, `AMADEUS_TTS_ENGINE=mlx`, bind `0.0.0.0`, port `18792`; A reference remains unchanged; 9Router-to-host health route passed.
- Post-reload sample: memory free `71%`; swap `7168 MiB total / 5758.81 MiB used / 1409.19 MiB free`; physical footprint `3.3 GiB`, process-lifetime peak `17.1 GiB`.
- No TTS boundary benchmark request was sent as part of the plist repair itself. The earlier two excluded 50-character warmups and both safety-stopped runs remain separate, preserved evidence; they are not combined with a future run.

## Recovery

If the TTS LaunchAgent later fails, keep MLX selected. Restore/re-render only from the Git template and `infra/macos/manage-qwen3-tts.sh --apply-plist-only --engine mlx`, then verify the same health, source SHA, profile integrity, launchd spawn type, and 9Router route. Do not switch to MPS or change production policy under the active boundary Goal.
