# Checkpoint — Amadeus Qwen3-TTS MLX production rebaseline

Date: 2026-10-01 (Asia/Shanghai)
Status: **runtime cleanup and automated gates A–G passed; final Phase 6 push pending**
Product `VERSION`: `1.7.4` (unchanged)

## Source and deployment

- Rebaseline/deployment source commit: `0fdfdbb` (`feat(amadeus): rebaseline TTS on pinned Qwen3 MLX`).
- Final retirement/source-cleanup commit: `45f96a9` (`chore(amadeus): retire legacy TTS engines`).
- The image-only bridge deploy uses immutable CasaOS image
  `local/9router:git-0fdfdbbd91f2-20260930T211901Z`, image ID
  `sha256:c6c2bf40c95d62a49c14cd7ec7c8188002a35352bedc7cc911397e857f1caf7b`.
  Only 9Router was rebuilt/recreated; OpenClaw and Product Radar were not
  restarted or rebuilt.
- The deploy command included `--allow-qwenai-upstream` solely because the
  existing ASR endpoint is the previously configured QwenAI platform. ASR
  configuration and behavior were not changed.

## Production steady state

```text
Amadeus TTS
  -> Qwen3-TTS 1.7B Base / mlx-audio 0.5.6 / pinned MLX 8-bit
  -> Qwen Audio 3.1 TTS Flash
  -> Qwen Audio 3.0 TTS Flash
```

- MLX source revision: `4ab7e6f7dedd69a136cfaa318c5dc8aed5119446`.
- Model: `mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit`, revision
  `e7dd0585652209fa0d7783659aad4e8a324de11c`.
- The `kurisu-v1` original A `reference.wav` is 46.000 seconds, 2,208,078
  bytes, SHA-256
  `fb1ed35df7a872cea3e12d77546e9d7ba885df562214d320007b5e5d1b4482fa`.
  Its matching `reference.txt` remains mode 0600 and is represented here only
  by its hash in the protected Phase 0 record; transcript contents are not
  recorded.
- The native service is authenticated and loopback-only at
  `127.0.0.1:18794`; LaunchAgent `com.amadeus.qwen3-tts` reports provider
  `qwen3-tts-mlx`, engine `mlx`, the pinned model and `language=auto`.
- **Port collision exception:** ImageAssets already owned
  `127.0.0.1:18792` and remains there, unchanged. OrbStack reachability was
  verified on the chosen free local TTS port. OpenClaw was not restarted for
  an unrelated image-service port migration.
- 9Router preserves one `selfhosted-tts` provider connection with a clean
  Qwen3-MLX label and the stable alias
  `amadeus-tts -> selfhosted-tts/qwen3-tts-1.7b/kurisu-v1`.
  Bridge health reports the exact local-first provider/model and the 3.1 → 3.0
  cloud order. No retired provider or fourth fallback remains active.
- A deliberate service restart returned to ready in 7.1 seconds. Local WAV and
  MP3 synthesis passed; MP3 decoded successfully. Unauthenticated local speech
  returned HTTP 401.

## Automated acceptance evidence

- The actual logical `amadeus-tts` 9Router route returned valid MP3; the
  sidecar event recorded `tts_provider=qwen3-tts-mlx`, success, and no fallback.
- A controlled local `busy` response exercised the production bridge against
  the real Qwen Audio 3.1 cloud endpoint. It returned valid cloud MP3 with
  `fallback=cloud`; the local MLX service stayed healthy. The executable
  bridge test also forced local + 3.1 operational failure and proved 3.0 is
  attempt 2.
- Focused Python tests passed: service (12, one encoder-dependent skip),
  engine boundary (2), MLX deployment (4), MLX ICL semantics (1), and
  9Router provisioning (8). The Node TTS bridge contract test passed.
- `pnpm test:amadeus` passed (100 tests); `pnpm typecheck:amadeus`,
  `pnpm build:amadeus`, `pnpm check:secrets`, and `git diff --check` passed.
  Pinned MLX source/model/dependency verification and manager/bridge dry-runs
  passed. Final source search found no retired engine implementation or route
  in active `apps/`, `infra/`, `plugins/`, `scripts/`, or README sources.
- Post-warmup resource snapshot: Qwen process physical footprint 3,380 MiB
  (peak 17.2 GiB); system-wide free-memory percentage 70%; swap used
  5,223 MiB; OrbStack host-process RSS about 5,272 MiB; CasaOS 9Router about
  147 MiB and OpenClaw about 1,051 MiB. No instability or severe memory
  pressure was observed; historical swap allocation was not treated as a
  failure.
- The owner explicitly waived listening, owner-channel and manual WhatsApp
  acceptance gates for this run. No human voice-quality acceptance is claimed.

## Retired assets and protected sample archive

After automated gates passed, the exact dedicated GPT-SoVITS/Kurisu package,
OminiX runtime/cache, tuner files/state, GPT launchd plists, adapter token and
logs, legacy source/tests/deploy helpers, duplicate 9Router TTS provider
connections, temporary task-specific router DB checkpoints, and old router
image tag were removed. No shared parent directory, Qwen MLX model/venv, MPS
source-level recovery assets, ImageAssets data, cloud secrets or cloud voice
IDs were deleted.

The only Kurisu `.wav` sample belonging to the retired GPT-SoVITS package was
preserved outside Git at
`/Volumes/Avalon/backups/operation-skuld/amadeus-kurisu-wav-archive-20261001`.
Its mode-0600 manifest SHA-256 is
`e1362946d7d04abb4d22faa4ed65e93acbeb97045445c955992ebfd58e75a6c9`; the
archived file SHA-256 is
`75d1e6a72bada93909409cea0563324f8b422bc732a4c004b6f673f373d583f0`.
The canonical A profile, MLX weights, credentials, voice IDs and generated
media remain outside Git.

The protected content-safe Phase 0 manifest remains at
`/Volumes/Avalon/backups/operation-skuld/qwen3-tts-rebaseline-20261001/baseline.json`.
Temporary rollback database/config copies and the retired image tag were
removed after A–G passed; only small audit facts and hashes remain.
