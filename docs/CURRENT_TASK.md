# Current Task — Amadeus Image Generation Lifecycle + Caption UX

Date: 2026-10-01 local.

Active Goal: `docs/AMADEUS_IMAGE_GENERATION_LIFECYCLE_CAPTION_UX_GOAL.md`.
Prerequisites: `docs/AMADEUS_IMAGE_GENERATION_BACKGROUND_COMPLETION_FIX_GOAL.md` and
`docs/AMADEUS_DELIVERY_ENVELOPE_MEDIA_CUTOVER_GOAL.md` remain historical source/architecture evidence.

Status: `SOURCE_IMPLEMENTATION_VALIDATED_NOT_APPLIED` (source/tests/required validation passed;
owner-channel Gates A–F remain pending until a separately authorized deployment).

Read-only live check on 2026-10-01 observed the healthy CasaOS OpenClaw image
`local/openclaw-amadeus:git-d7f2847d82f4-20260930154020`, OpenClaw `2026.9.4`, on OrbStack
`nyannyan`; Gateway logs confirm Amadeus registration. This is the prior corrective background-completion
candidate, not the lifecycle/caption implementation in the worktree. No production apply/build/switch is authorized or performed for this task.

The source uses one version/digest/AST-anchored integration module for the pinned OpenClaw image:
accepted is attached to `notifyMediaGenerationAsyncTaskStarted` after the detached task is scheduled;
success/failure are attached to typed `wakeMediaGenerationTaskCompletion(params)` status and the original
requester route. `ImageGenerationLifecycleCoordinator` holds bounded taskId state; successful persisted
OpenClaw `attachments[]` are imported once into the registry, described through bounded multimodal caption
enrichment using the verified registry image, then settled as DeliveryEnvelope v2 inline attachments.
Caption failure uses deterministic fallback and does not block media settlement. WhatsApp uses one native
`sendMedia({image, mimetype, caption})`; Telegram uses native `sendPhoto` caption. Start/failure use typed
lifecycle notifications and never parse prose or expose raw provider failures. The image-generation Skill
makes the ordinary accepted interim Agent reply silent to prevent duplicate acknowledgements.

The task state and delivery ledger are bounded process-local state, not a durable cross-restart journal.
The protected image asset registry persists; cross-restart exactly-once lifecycle behavior is not claimed
without the future deployed restart/replay gates. The source-level exact pinned integration contract and
focused tests pass. Real WhatsApp Gates A–F have not been performed for this candidate and remain required
after separately authorized apply.

## Separate request — upscale default 2x (candidate applied)

The requested default is now 2x in the Amadeus tool boundary and host image
service source; an explicitly identified current-turn user 4x request remains
4x. The tool ignores model-supplied scale when trusted current-turn scale
metadata is absent, so a model-proposed 4x cannot defeat the 2x default. Focused DeliveryEnvelope/Amadeus tests, host service tests, typecheck/build,
diff check and secrets scan passed. Candidate image and Mac host LaunchAgent are
now updated and verified. OpenClaw health and Amadeus registration passed; host
service health is ready and the installed code returns 2 for omitted scale and
4 for explicit 4. The image service install had a transient launchctl bootstrap
exit 5; retry succeeded and service health recovered. No actual image was
upscaled as a live smoke. Checkpoints: `.agent/checkpoints/2026-09-30-upscale-default2-candidate-applied.md`,
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930154020`, and
`/Volumes/Avalon/backups/operation-skuld/image-service/amadeus-image-service-default2x-20260930T154020Z`.

## Earlier attempts and plugin-index recovery (historical audit only)

**Authorized apply in progress:** first candidate stopped before Compose switch;
the old config was restored from protected checkpoint
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930074729`, and the old
immutable image is healthy. The pinned npm installer now invokes the existing
Node binary directly and extracts the signed tar archive in-process; retry
only from a new committed source, new immutable image and new protected checkpoint. Evidence: `.agent/checkpoints/2026-09-30-delivery-envelope-first-apply-failure.md`.

A second candidate passed the pinned WhatsApp installer but was stopped in
plugin inspection before Compose switch: the non-root runtime could not read
`amadeus/dist/index.js` copied with a private umask. The second protected
checkpoint `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930080024`
was used to atomically restore OpenClaw/Product Radar definitions, OpenClaw
config and the WhatsApp monitor; the old image is healthy and TTS config is
again `tagged`. Source now explicitly sets plugin bundle 0644 and checks
node-user image readability before runtime writes. See
`.agent/checkpoints/2026-09-30-delivery-envelope-second-apply-failure.md`.

A third candidate passed image readability and pinned WhatsApp installation,
but the out-of-process Amadeus CLI inspector blocked before switch. The **same**
CLI inspector fails on the previous healthy image, whose running Gateway logs
show actual Amadeus registration. Third protected checkpoint
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930081212` restored all
staged definitions/config and the old WhatsApp module. Deployment now checks
candidate image/manifest before switch and **real Gateway registration** after
health; any missing registration remains a hard failure with rollback. See
`.agent/checkpoints/2026-09-30-delivery-envelope-third-apply-failure.md`.

A fourth candidate's offline Skill CLI omitted Amadeus Skills, while uid-1000
inspection of that exact immutable image read all 14 manifest-declared Skill
files and 27 tool declarations. The protected checkpoint
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930084057` restored the
staged definitions/config and previous WhatsApp monitor before any switch.
The candidate preflight now checks every Skill inside the image; the actual
Gateway registration log remains a hard post-switch gate. Evidence:
`.agent/checkpoints/2026-09-30-delivery-envelope-fourth-apply-failure.md`.

A fifth candidate briefly switched to the new image but its real Gateway
did not register Amadeus. The attempt was rolled back to checkpoint
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930085757`. Recreating
the old image also exposed a corrupted **persisted plugin index**: 63 entries,
Amadeus absent. After a consistent protected SQLite backup at
`/DATA/AppData/openclaw/backups/amadeus-plugin-registry-recovery-20260930T093520Z`,
the official `plugins registry --refresh` rebuilt 64 entries including Amadeus.
The old Gateway now registers Amadeus, its Skills are visible, and it is healthy.
The candidate remains unapplied. See
`.agent/checkpoints/2026-09-30-amadeus-plugin-registry-recovery.md`.

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

Only the Goal named by `docs/CURRENT_TASK.md` is active; it is currently `docs/AMADEUS_IMAGE_GENERATION_LIFECYCLE_CAPTION_UX_GOAL.md`. Historical Goals/checkpoints are evidence, not live instructions. Before implementation, re-read Git and live runtime as the source of truth and follow `AGENTS.md` validation/deployment boundaries.
