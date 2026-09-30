# Current Task — DeliveryEnvelope v2 + Media Delivery Cutover

Date: 2026-09-30 local.

Active Goal: `docs/AMADEUS_DELIVERY_ENVELOPE_MEDIA_CUTOVER_GOAL.md`.

Status: `PLANNED_NOT_IMPLEMENTED`.

The owner has explicitly selected a clean one-time cutover. The current production defects are internal structured reply JSON leaking into Kurisu-visible WhatsApp messages and upscaled image assets being delivered through WhatsApp's compressed image path instead of document/file delivery.

The implementation must replace the split ReplyEnvelope/tool-media architecture with one typed `DeliveryEnvelope v2` settlement covering text, voice and attachments. Do not add another JSON cleanup regex, another `forceDocument` propagation hop, a legacy ReplyEnvelope compatibility translator, or a dual sender. The retired workaround paths must be deleted as part of the cutover after the new typed path is wired and tested.

The previous image asset/on-demand upscale Goal remains important implementation and deployment evidence, but it is no longer the live instruction pointer. Its host-native MLX upscale service, durable asset lineage, and image-resolution behavior must be preserved while delivery semantics are moved into the new contract.

---

# Historical Task — Amadeus Image Asset and On-Demand Upscale

Date: 2026-09-29 local.

Historical Goal: `docs/AMADEUS_IMAGE_ASSET_AND_ON_DEMAND_UPSCALE_GOAL.md`.

Status at supersession: `WAITING_FOR_OWNER_CHANNEL_ACCEPTANCE`.

The image Goal implementation, deployment, rollback checkpoint, and host smokes are recorded in `.agent/checkpoints/2026-09-29-amadeus-image-assets.md`. Real owner-channel use subsequently exposed the two delivery-boundary defects now owned by the active DeliveryEnvelope cutover Goal above. Do not solve them by extending the old patch chain.

---

# Historical Kurisu GPT-SoVITS MPS production cutover

Historical Goal: `docs/AMADEUS_KURISU_GPT_SOVITS_MPS_PRODUCTION_CUTOVER_GOAL.md`.

Status at last record: `IN_PROGRESS_GROUP_CHANNEL_FIX` / owner-channel acceptance evidence retained externally.

Owner verdict on 2026-09-29: `GPT-SoVITS 明显比 Qwen 3.1 更像牧濑红莉栖，Gate B 通过。`

The accepted PoC was promoted to the production `amadeus-tts` boundary. GPT-SoVITS v2Pro MPS is the intended resident local TTS; the normal fallback order is GPT-SoVITS MPS -> Qwen Audio 3.1 -> Qwen Audio 3.0. OminiX Qwen3-TTS remains a protected rollback asset only.

Production apply completed on 2026-09-29. GPT-SoVITS v2Pro MPS is the resident local TTS (`127.0.0.1:19870` API plus authenticated adapter on `127.0.0.1:19871`). OminiX `com.amadeus.qwen3-tts` is uninstalled and neither `:18792` nor `:18793` is listening. The live primary route returned `gpt-sovits-mps`; a controlled adapter outage returned `qwen-audio-3.1-tts-flash`, and the executable bridge test proves the exact `qwen-audio-3.1-tts-flash` -> `qwen-audio-3.0-tts-flash` order. Full evidence is under `/Volumes/Avalon/backups/operation-skuld/kurisu-gpt-sovits-cutover-postapply-20260929T171128Z/`.

The owner confirmed direct-message behavior but reported that the group-chat behavior was wrong. The diagnosis retained at `/Volumes/Avalon/backups/operation-skuld/kurisu-gpt-sovits-cutover-postapply-20260929T171128Z/group-chat-diagnosis-20260929T173255Z/` showed GPT-SoVITS and ASR both completed while concurrent group arrivals allowed a later text run to overlap the voice run and win the final WhatsApp delivery boundary. A repo-only candidate fix serializes every inbound WhatsApp arrival per session in `scripts/openclaw-voice-lease.mjs`; its historical deployment state must be re-verified from Git/live runtime before any future work.

Reference update on 2026-09-29: the last recorded active production reference was `WAV/crs_0695.WAV_0000000000_0000224000.wav` with transcript `裸の得意点が作れていないなら、つまり被験者はブラックホールに放り込まれるのと同じだから。`. Historical model/reference and rollback evidence remain outside Git.

```text
GPT-SoVITS v2Pro MPS :19871
  -> qwen-audio-3.1-tts-flash
  -> qwen-audio-3.0-tts-flash
```

The protected pre-cutover rollback checkpoint is `/Volumes/Avalon/backups/operation-skuld/kurisu-gpt-sovits-cutover-20260929T164028Z`.

---

# Current execution rule

Only `docs/AMADEUS_DELIVERY_ENVELOPE_MEDIA_CUTOVER_GOAL.md` is the active Goal unless the operator explicitly selects another task. Historical Goals/checkpoints are evidence, not live instructions. Before implementation, Codex must re-read Git and live runtime as the source of truth and follow `AGENTS.md` validation/deployment boundaries.
