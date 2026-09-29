# Current Task — Kurisu GPT-SoVITS MPS Production Cutover

Date: 2026-09-29 local.

Active Goal: `docs/AMADEUS_KURISU_GPT_SOVITS_MPS_PRODUCTION_CUTOVER_GOAL.md`.

Status: `IN_PROGRESS`.

Owner verdict on 2026-09-29: `GPT-SoVITS 明显比 Qwen 3.1 更像牧濑红莉栖，Gate B 通过。`

The accepted PoC is now being promoted to the production `amadeus-tts` boundary. GPT-SoVITS v2Pro MPS is the only intended resident local TTS; the normal order is GPT-SoVITS MPS -> Qwen Audio 3.1 -> Qwen Audio 3.0. OminiX Qwen3-TTS remains a protected rollback asset only.

The production cutover must preserve OpenClaw, ReplyEnvelope, channel behavior, protected Qwen voice IDs and bounded request contracts. It must not perform MLX conversion.

```text
GPT-SoVITS v2Pro MPS :19871
  -> qwen-audio-3.1-tts-flash
  -> qwen-audio-3.0-tts-flash
```

Phase 0 dry-run has verified the current OminiX service and tuner on `:18792`/`:18793`, the validated GPT-SoVITS runtime on `:19870`, and the PoC proxy on `:56708`. The protected rollback checkpoint must be created before any service mutation.

The earlier PoC Goal is closed as `ACCEPTED_FOR_FURTHER_INTEGRATION`; its MPS runtime, model/reference assets and external A/B evidence remain retained outside Git.

---

# Paused Task — Image Asset + On-Demand Upscale

Date: 2026-09-29 local.

Paused Goal: `docs/AMADEUS_IMAGE_ASSET_AND_ON_DEMAND_UPSCALE_GOAL.md`.

The image asset/on-demand upscale Goal remains valid but is temporarily paused because the owner explicitly chose to validate the Kurisu GPT-SoVITS character voice first. Do not delete or reinterpret that Goal. Resume it only after the owner returns to the image work.

---

# Recent production TTS baseline — deployed

The current cloud `default` request is a pure voice-clone baseline: `text`, model-bound `voice`, `format`, `sample_rate`, and Japanese `language_hints`, with no instruction/persona/style/speed/pitch controls. Non-default emotions retain bounded instructions.

The protected `amadeus-tts` bridge uses the bounded order `qwen-audio-3.1-tts-flash` -> `qwen-audio-3.0-tts-flash` -> M204 OminiX local fallback. Production health/owner acceptance and rollback evidence are recorded in `docs/PROJECT_STATE.md` and the dated `.agent/checkpoints/` entries.

Older completed Goals/checkpoints remain historical evidence, not live instructions.

## Latest live checkpoint — 2026-09-29

The isolated GPT-SoVITS v2Pro candidate loaded on MPS and produced Japanese audio. An 8-line, identical-text Qwen 3.1 versus GPT-SoVITS A/B set and a five-run warm benchmark are stored outside Git under `/Volumes/Avalon/backups/operation-skuld/kurisu-gpt-sovits-poc-20260929/`. Production `com.amadeus.qwen3-tts` remains unchanged and healthy on PID `18387`; the PoC is loopback-only on `127.0.0.1:19870`. Current status is `ACCEPTED_FOR_FURTHER_INTEGRATION`; do not execute the next production cutover Goal until a new `/goal` request.
