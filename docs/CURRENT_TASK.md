# Current Task — DeliveryEnvelope v2 + Media Delivery Cutover

Date: 2026-09-30 local.

Active Goal: `docs/AMADEUS_DELIVERY_ENVELOPE_MEDIA_CUTOVER_GOAL.md`.

Status: `CANDIDATE_LIVE_DEFAULT_4X_OWNER_ACCEPTANCE_PENDING` (Goal open).

The healthy single OpenClaw runtime now uses default-4x candidate
`git-9221fce0a519-20260930130737`; Amadeus is
registered and WhatsApp connected. The owner confirmed direct-message replies
work and later reported group replies recovered without a source/config change.
Two group arrivals earlier settled silent, so intermittent group behavior is not
proven resolved. Do not revert to the prior image on speculation. The previous protected checkpoint is
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930101930`.
Evidence: `.agent/checkpoints/2026-09-30-delivery-envelope-gate-a-fix-candidate.md`.

Real 4x request diagnosis: host asset registry and authoritative OpenClaw
transcript tool-call arguments both show `scale:2` for the owner's explicit
4x request. The host service supports 4x; the Agent selected 2 before the
plugin/service boundary. A bounded explicit multiplier constraint is now deployed in immutable image
`local/openclaw-amadeus:git-682c69a375b6-20260930110631` after focused
verification and a protected candidate apply. Checkpoint:
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930110631`; external
evidence: `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260930110631`.
A real owner 4x retest succeeded at the tool/host/sender boundary: despite
the Agent proposing `scale:2`, the native constraint sent `scale:4`; the host
produced 3412×7376 PNG (26,037,181 bytes), SHA-256 matching its own
registry, and one document attachment settled as `sent`. The recipient-
downloaded file hash remains unverified; do not claim full Gate completion.

Owner requested a new 4x default for unspecified upscale (explicit 2x remains 2x).
The native tool, Skill, host service and manual CLI source are aligned and live.
Host service is healthy/ready; the OpenClaw candidate is healthy and Amadeus
registered. Protected host checkpoint and source/apply evidence:
`.agent/checkpoints/2026-09-30-upscale-default4-candidate.md`. A real owner
unspecified-multiplier request is still required for acceptance.

Gates A–F, ordinary inline generation, JPEG/4x document delivery, recipient
SHA-256/byte-size equality, TTS fallback and restart acceptance remain open
where real evidence has not been recorded. Production apply requires the
explicit authorized, protected checkpoint flow; no VERSION bump or release.

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

Only `docs/AMADEUS_DELIVERY_ENVELOPE_MEDIA_CUTOVER_GOAL.md` is the active Goal unless the operator explicitly selects another task. Historical Goals/checkpoints are evidence, not live instructions. Before implementation, Codex must re-read Git and live runtime as the source of truth and follow `AGENTS.md` validation/deployment boundaries.
