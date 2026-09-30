# Current Task — Qwen3-TTS MLX Production Rebaseline

Date: 2026-10-01 local.

Active Goal: `docs/AMADEUS_QWEN3_TTS_MLX_REBASELINE_GOAL.md`.

Status: `COMPLETE` — runtime gates A–G passed, retired assets were removed, and clean source/evidence are pushed to canonical `main`..

The owner wants the production voice path returned to the previously accepted A/MLX/Auto baseline because that configuration produced the preferred Kurisu voice quality:

```text
Qwen3-TTS 1.7B Base
+ mlx-audio / MLX 8-bit
+ original operator-owned ~46s Kurisu A reference
+ Auto language
```

Historical acceptance evidence is anchored around commit `c8f9261d1c093a8188db802c73a38a998d018944`, where the owner accepted the A+MLX voice/typed behavior on real WhatsApp traffic.

Target provider order:

```text
local Qwen3-TTS MLX :18794 (18792 is occupied by ImageAssets; Phase 0 collision exception)
  -> qwen-audio-3.1-tts-flash
  -> qwen-audio-3.0-tts-flash
```

OminiX and GPT-SoVITS/GPT TTS active source/runtime/model/venv/service assets are now removed. The only local TTS engine is the Qwen3 MLX LaunchAgent; the 9Router TTS provider list contains one bridge connection. The canonical ~46s A reference pair and the retired package WAV sample are preserved outside Git.

The owner explicitly authorizes unattended deployment for this Goal. After repository tests, secrets checks, dry-run and technical health/fallback gates pass, Codex may invoke the repository's explicit `--apply` paths and complete the production cutover without another confirmation prompt. Human listening and manual WhatsApp acceptance are waived for this run; automated health, direct synthesis, provider identity, forced cloud fallback, source integrity, resource snapshot and cleanup verification remain mandatory.

Gate A–G evidence, the retired path list, resource snapshot and protected archive hashes are recorded in `.agent/checkpoints/2026-10-01-amadeus-qwen3-tts-mlx-rebaseline.md`. Human listening/owner-channel acceptance was waived and not performed.

Git and live runtime are the source of truth. Follow `AGENTS.md`, especially protected checkpoints, enumerated destructive paths, secret handling and rollback-before-cleanup requirements.

## Immediately preceding task

`docs/AMADEUS_IMAGE_GENERATION_LIFECYCLE_CAPTION_UX_GOAL.md` was owner-accepted through Gates A–F and is no longer the active Goal. Its implementation/deployment evidence remains in its dedicated Goal and `.agent/checkpoints/` records; do not treat it as live TTS instruction.

## Historical TTS evidence

- `docs/AMADEUS_KURISU_GPT_SOVITS_MPS_PRODUCTION_CUTOVER_GOAL.md` is historical-only and is superseded by the active rebaseline Goal.
- Earlier A/MLX performance/acceptance records and protected host checkpoints are evidence for reproducing the exact preferred baseline, not permission to restore unrelated old message architecture.
- Keep current DeliveryEnvelope/ReplyEnvelope/OpenClaw architecture intact while changing only the TTS provider/runtime boundary.
