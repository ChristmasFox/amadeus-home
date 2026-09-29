# Current Task — Kurisu GPT-SoVITS MPS Production Cutover

Date: 2026-09-29 local.

Active Goal: `docs/AMADEUS_KURISU_GPT_SOVITS_MPS_PRODUCTION_CUTOVER_GOAL.md`.

Status: `IN_PROGRESS_GROUP_CHANNEL_FIX`.

Owner verdict on 2026-09-29: `GPT-SoVITS 明显比 Qwen 3.1 更像牧濑红莉栖，Gate B 通过。`

The accepted PoC is now being promoted to the production `amadeus-tts` boundary. GPT-SoVITS v2Pro MPS is the only intended resident local TTS; the normal order is GPT-SoVITS MPS -> Qwen Audio 3.1 -> Qwen Audio 3.0. OminiX Qwen3-TTS remains a protected rollback asset only.

The production cutover must preserve OpenClaw, ReplyEnvelope, channel behavior, protected Qwen voice IDs and bounded request contracts. It must not perform MLX conversion.

Production apply completed on 2026-09-29. GPT-SoVITS v2Pro MPS is the only
resident local TTS (`127.0.0.1:19870` API plus authenticated adapter on
`127.0.0.1:19871`). OminiX `com.amadeus.qwen3-tts` is uninstalled and neither
`:18792` nor `:18793` is listening. The live primary route returned
`gpt-sovits-mps`; a controlled adapter outage returned
`qwen-audio-3.1-tts-flash`, and the executable bridge test proves the exact
`qwen-audio-3.1-tts-flash` -> `qwen-audio-3.0-tts-flash` order. Full evidence is
under `/Volumes/Avalon/backups/operation-skuld/kurisu-gpt-sovits-cutover-postapply-20260929T171128Z/`.
The owner confirmed direct-message behavior but reported that the group-chat
behavior is wrong. The first diagnosis is retained at
`/Volumes/Avalon/backups/operation-skuld/kurisu-gpt-sovits-cutover-postapply-20260929T171128Z/group-chat-diagnosis-20260929T173255Z/`:
GPT-SoVITS and ASR both completed, while concurrent group arrivals allowed a
later text run to overlap the voice run and win the final WhatsApp delivery
boundary. A repo-only candidate fix now serializes every inbound WhatsApp
arrival per session in `scripts/openclaw-voice-lease.mjs`; focused lifecycle,
bundle, policy, voice-failure, bilingual-envelope, group-policy, syntax, diff,
and secrets checks pass. This fix is not deployed yet, so the live production
image and MPS runtime remain unchanged. Keep the Goal open until the patch is
explicitly applied and real group-channel acceptance passes.

Reference update on 2026-09-29: the active production reference is now
`WAV/crs_0695.WAV_0000000000_0000224000.wav` with the matching transcript
`裸の得意点が作られていないなら、つまり被験者はブラックホールに放り込まれるのと同じだから。`.
The change is applied through
`infra/macos/manage-kurisu-gpt-sovits-tts.sh --apply`. Per owner request, the
active model directory retains only this one reference WAV; the GPT-SoVITS
weights remain, and the prior reference remains only in protected rollback
evidence as hashes/configuration at
`/Volumes/Avalon/backups/operation-skuld/kurisu-gpt-sovits-reference-20260929T184957Z-0695/`.

```text
GPT-SoVITS v2Pro MPS :19871
  -> qwen-audio-3.1-tts-flash
  -> qwen-audio-3.0-tts-flash
```

The protected pre-cutover rollback checkpoint is
`/Volumes/Avalon/backups/operation-skuld/kurisu-gpt-sovits-cutover-20260929T164028Z`.
The post-apply evidence and resource samples are retained outside Git; the
MPS PoC runtime, model, reference audio, generated audio and A/B evidence are
also retained unchanged.

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

The GPT-SoVITS v2Pro MPS production apply is live on M204. LaunchAgents
`com.amadeus.kurisu-gpt-sovits-api` and
`com.amadeus.kurisu-gpt-sovits-tts` are loaded and ready; the warm direct
sample measured 2.581646 seconds for 3.312 seconds of audio (RTF 0.7795).
The host showed stable encrypted swap usage of 2202 MiB and 62–78% free memory
across the short resource sample. The protected OminiX rollback manifest
verified 2823 files with no missing, changed or symlinked entries and mode
0700. Current status is `WAITING_FOR_OWNER_CHANNEL_ACCEPTANCE`; the owner must
试听 the real production path and confirm Japanese pronunciation, Kurisu
identity, visible text behavior and typed-text isolation before the Goal can
close.
