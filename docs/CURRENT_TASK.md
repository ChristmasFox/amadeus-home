# Current Task — DeliveryEnvelope v2 + Media Delivery Cutover

Date: 2026-09-30 local.

Active Goal: `docs/AMADEUS_DELIVERY_ENVELOPE_MEDIA_CUTOVER_GOAL.md`.

Status: `SOURCE_CUTOVER_COMPLETE_AWAITING_PRODUCTION_APPLY` (no production apply).

The Git source implements the typed v2 contract, one structured decoder and
one settlement ledger, tool image asset parts, a narrow pinned WhatsApp plan
integration, and no independent Amadeus auto/pending tool-media sender. Source
checks and the scoped Git commit must pass before treating this source phase
as complete. Production still runs the previous immutable image.

**Next authorized phase:** only after a separate explicit `--apply`, take a
protected runtime checkpoint, build/tag a fresh immutable OpenClaw image,
restore the pinned WhatsApp module and install the typed plan, switch CasaOS,
run health/smoke and real owner-channel Gates A–F. Download both PNG/JPEG upscale
documents and compare received SHA-256 and byte size with registry/host assets;
then restart/recreate and repeat a new upscale. Do not close the Goal on local
tests alone or weaken any rollback/secret boundary.

Independent 9Router maintenance on 2026-09-30 (not this Goal): CasaOS 9Router
was upgraded to npm `0.5.91`; the version-guarded `gpt-image-2.5` account
allowlist and Next.js Server Actions `20mb` limit are live. The permitted
account returned `429` in a real image smoke, and `amadeus-image` used its
existing Gemini **model** fallback rather than another Codex account. See
`.agent/checkpoints/2026-09-30-9router-0.5.91-image-account.md` for exact
image, preservation checks, protected rollback points and evidence. This
maintenance does not change the DeliveryEnvelope phase or authorize its apply.

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
