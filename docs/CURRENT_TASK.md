# Current Task — Kurisu GPT-SoVITS Character Voice PoC (Active Goal)

Date: 2026-09-29 local.

Active Goal: `docs/AMADEUS_KURISU_GPT_SOVITS_POC_GOAL.md`.

The owner wants to deploy and validate `bysq/TTS-KurisuMakise` (GPT-SoVITS-v2Pro) on the current macOS host because the target is not generic voice similarity but an immediately recognizable Makise Kurisu voice.

Execute the Goal as an isolated host-native PoC. The existing production TTS chain must remain unchanged during validation:

```text
qwen-audio-3.1-tts-flash
  -> qwen-audio-3.0-tts-flash
  -> existing OminiX Qwen3-TTS fallback :18792
```

Cloud `default` remains the accepted zero-delta pure-clone baseline. Do not change its instruction/persona/style behavior, cloud model order, protected voice IDs, OpenClaw, channel behavior or ReplyEnvelope while evaluating GPT-SoVITS.

First prove the candidate with pinned upstream GPT-SoVITS v2Pro on the Mac, Japanese synthesis and a clean neutral Kurisu reference. Then generate controlled Qwen 3.1 vs GPT-SoVITS A/B samples from identical Japanese text. Character identity is the primary acceptance criterion; latency/RTF and memory are secondary viability evidence. The owner listening verdict gates all further work.

OminiX/MLX GPT-SoVITS is a follow-up feasibility target only after the candidate clearly wins the voice-quality A/B. Do not spend the main PoC on MLX conversion or production integration before that gate.

Model checkpoints, pretrained weights, reference WAVs, generated audio, caches and secrets stay outside Git. Bind the PoC locally, run non-root, discover a free port, and do not assume `18793` is available because the existing Kurisu tuner already owns a host endpoint.

This Goal does **not** authorize adding GPT-SoVITS to `amadeus-tts` production routing. A successful outcome is `ACCEPTED_FOR_FURTHER_INTEGRATION`, followed by a separate integration/MLX decision.

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

The isolated GPT-SoVITS v2Pro candidate loaded on MPS and produced Japanese audio. An 8-line, identical-text Qwen 3.1 versus GPT-SoVITS A/B set and a five-run warm benchmark are stored outside Git under `/Volumes/Avalon/backups/operation-skuld/kurisu-gpt-sovits-poc-20260929/`. Production `com.amadeus.qwen3-tts` remains unchanged and healthy on PID `18387`; the PoC is loopback-only on `127.0.0.1:19870`. Current status is `WAITING_FOR_OWNER_LISTENING`; do not integrate or mark this Goal complete before the owner gives the character-identity verdict.
