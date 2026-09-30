# Project State — 2026-10-01

## Image generation lifecycle + Kurisu caption UX — source validated; production apply pending

The current source candidate extends the existing OpenClaw 2026.9.4 typed background-completion bridge;
it has not been Docker-built or applied. One pinned integration module binds the accepted event to
`notifyMediaGenerationAsyncTaskStarted` after detached scheduling and terminal success/failure to the
structured `wakeMediaGenerationTaskCompletion(params)` state. `ImageGenerationLifecycleCoordinator`
keeps a 1,024-task bounded taskId state, claims one terminal state, and ignores failure after success.
Accepted/failure messages are typed and task-keyed; accepted send errors do not cancel generation. The
image-generation Skill keeps the ordinary accepted interim Agent reply silent to avoid a duplicate
acknowledgement.

On success, only OpenClaw's persisted generated `attachments[]` are imported to the asset registry. A
bounded multimodal CaptionEnricher receives the verified registered image path and current Kurisu
workspace persona and lets Kurisu choose natural wording without a fixed word-count target; the native
caption limit is 1024 characters. It returns only `{ caption }`. Timeout/model error/invalid/unavailable
captions use a safe deterministic fallback and never block the image. DeliveryEnvelope v2 attachment caption is bounded
normalized presentation data; WhatsApp maps inline image+caption to one native
`sendMedia({image, mimetype, caption})` call. Telegram maps through native `sendPhoto` caption.
`document` remains a document.
No `llm_input/historyMessages` recovery, media prose parsing or pending/automatic sender was restored.

Source checks passed: `pnpm workflow:plan` (reports `RELEASE_BUILD_REQUIRED`; no Docker/CasaOS build/apply
was run), `pnpm test:delivery` (66 focused tests including exact pinned source integration),
`pnpm test:amadeus` (100 tests), `pnpm typecheck:amadeus`, `pnpm build:amadeus`, `git diff --check`, and
`pnpm check:secrets`. The local build only produced the Amadeus plugin bundle.

The read-only live runtime remains the healthy parent candidate
`local/openclaw-amadeus:git-d7f2847d82f4-20260930154020` on OpenClaw `2026.9.4`; this source is not live.
Task coordinator and delivery settlement idempotency are bounded in-process state, not a durable
cross-restart journal; source tests do not prove restart/replay exactly-once. Real owner WhatsApp Gates
A–F after a separately authorized deployment remain pending. No production apply was authorized or
performed.

## 9Router 0.5.91 upgrade and strict GPT Image account — deployed

Independent of the pending OpenClaw DeliveryEnvelope release, CasaOS 9Router
runs immutable image `local/9router:git-499d53576169-20260930T071137Z`
from committed source `499d535`. `codex/gpt-image-2.5` now admits only the
configured owner email even when other Codex connections remain enabled.
The permitted account returned a usage-limit `429` in one authenticated live
smoke; the router reported one permitted account locked and generated via the
existing Gemini model fallback. No other Codex account was used. The Next.js
standalone Server Actions body limit is `20mb`; a real >1 MB action upload has
not yet been exercised. Sixteen account definitions, all aliases, and the
`amadeus-image` Combo were preserved. Upgrade/policy checkpoints and rollback
are in `.agent/checkpoints/2026-09-30-9router-0.5.91-image-account.md`.


## Amadeus image generation background completion — corrective candidate applied; owner gates pending

The healthy single OpenClaw runtime uses immutable candidate image
`local/openclaw-amadeus:git-d7f2847d82f4-20260930154020`, built from committed
source `d7f2847d82f4f1dc15f84589a8a5907890992cae`. OpenClaw and Product Radar
health passed, Amadeus registered, and the deployment's NAS read-only and owner
outbox smokes passed. Protected checkpoint:
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930154020`. Deployment
evidence path:
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260930154020/deployment-summary.md`.
This is a candidate apply, not a version release or owner-channel acceptance.

The corrective source is committed in `351b33e` and the exact-pinned handler
integration test in `8533713`. OpenClaw 2026.9.4's
`wakeMediaGenerationTaskCompletion(params)` has `status`, `handle`, and the
authoritative generated attachments/media URLs before it builds and hands off
the `task_completion` event. The version/digest-pinned bridge claims successful
WhatsApp/Telegram `image_generation` attachments there, before the completion
Agent. Amadeus imports the trusted attachment into the existing host image
registry, creates an inline DeliveryEnvelope v2 attachment, and settles through
the single delivery ledger and channel adapter. Native competing completion is
reported delivered only after this typed handoff/settlement succeeds; bridge
errors throw instead of silently cancelling. The async tool-start receipt is
not considered a generated image.

`pnpm workflow:plan`, `pnpm test:delivery` (including execution of the exact
pinned handler integration), `pnpm test:amadeus`, `pnpm typecheck:amadeus`,
`pnpm build:amadeus`, `git diff --check`, and `pnpm check:secrets` passed before
apply. Real owner WhatsApp tests for fallback success, LLM-independent delivery,
retry behavior, subsequent upscale, document integrity and text/voice regressions
remain required; the image-generation Goal is open until those gates have real
evidence. See `.agent/checkpoints/2026-09-30-image-background-completion-candidate.md`.

## Upscale default changed to 2x — candidate applied

The requested 2x default is deployed in both runtime boundaries. OpenClaw uses
`local/openclaw-amadeus:git-d7f2847d82f4-20260930154020`; the host image service
LaunchAgent was updated from Git source and is running/healthy. Runtime code
verification confirms omitted scale -> 2 and explicit scale 4 -> 4. The Amadeus
plugin defaults to 2 from trusted current-turn metadata and preserves explicit
user 4x; model-proposed 4x cannot override the default. No actual image was
upscaled as a production smoke. Protected rollback points and evidence are in
`.agent/checkpoints/2026-09-30-upscale-default2-candidate-applied.md`.

## DeliveryEnvelope v2 earlier source/rollback history (audit only)

Git source now defines one v2 typed user-facing settlement across text, voice and
registered image attachments. The retired text/voice-only contract and the two
JSON/document workaround scripts are removed from source. The source 2026.9.4
WhatsApp plan integration is an exact version/digest-pinned **single AST function
boundary**, not a multi-bundle JSON sanitizer or disposition hint chain.

**This is not production acceptance.** The first authorized candidate apply built
a new immutable image but stopped before the Compose switch because the pinned
container Node private-glibc environment could not execute npm via its shebang.
The old config was restored from protected checkpoint
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930074729`; the live
container remains the previous healthy immutable image. The source installer
was corrected and the next retry requires a new committed image/checkpoint.
See `.agent/checkpoints/2026-09-30-delivery-envelope-first-apply-failure.md`.

A second authorized candidate built and installed the typed WhatsApp boundary,
but non-root plugin inspection found the Amadeus image bundle unreadable (0600
root) before Compose switch. Protected checkpoint
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930080024` restored all
affected definitions/config and the previous WhatsApp module; the old image
remains healthy. The source build/image now set code artifact permissions 0644
and explicitly verify uid-1000 readability before a runtime write. Evidence:
`.agent/checkpoints/2026-09-30-delivery-envelope-second-apply-failure.md`.

The third candidate passed non-root readability and pinned module install but
stopped before switch at an out-of-process CLI inspector that also fails on the
previous healthy image. The Gateway's own startup log shows Amadeus registered
in that baseline. Checkpoint
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930081212` restored all
staged definitions and previous WhatsApp module; the source now gates on real
Gateway registration immediately after health. Evidence:
`.agent/checkpoints/2026-09-30-delivery-envelope-third-apply-failure.md`.

The fourth candidate also stopped before switch when the offline Skill CLI
omitted Amadeus; uid-1000 inspection of that exact image verified all 14
manifest-declared Skills and 27 tool declarations. Protected checkpoint
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930084057` restored
staged definitions and the previous WhatsApp module. The next candidate checks
bundle/Skill readability before switching, then real Gateway registration and
health immediately afterward. Evidence:
`.agent/checkpoints/2026-09-30-delivery-envelope-fourth-apply-failure.md`.

A fifth candidate briefly replaced OpenClaw but had no real Amadeus
registration, so the previous immutable image/config/module were restored from
checkpoint `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930085757`.
After restart, the old image also lacked Amadeus because a persisted SQLite
plugin index contained 63 entries without it. A separately protected,
consistent DB backup precedes the official registry refresh; the rebuilt
64-entry index includes Amadeus with no diagnostic. The old Gateway then
registered Amadeus twice on startup, its Skills returned, and health passed.
Source deployment now backs up this SQLite state and refreshes the index
before strict candidate plugin/Skill and post-switch Gateway gates. Evidence:
`.agent/checkpoints/2026-09-30-amadeus-plugin-registry-recovery.md`.

The previous immutable image and each failed attempt's protected runtime
snapshot remain external rollback evidence; they are not the current
production code path or a compatibility fallback.

# Historical Project State — 2026-09-29

## 2026-09-29 Amadeus image assets and on-demand upscale — deployed; owner-channel acceptance pending

The host-native image asset service is installed as launchd label
`com.amadeus.image-assets` and reports Apple MLX readiness on port `18792`.
The default Mac-local asset root, registry, model cache and token paths are
derived from the active `$HOME` host profile; no username or absolute personal
path is encoded in Git. The external volume remains an explicit override after
launchd write access is verified.

Source commits `849041e`, `d745e4f`, `6210c70`, and `7175240` add the opaque
`imageId` registry, native generation-result correlation, explicit-only
`amadeus_image_upscale`, Apple Silicon `realesrgan-mlx` runtime, CasaOS
read-only mount, and deployment Compose-path propagation. OpenClaw 1.7.4 is
healthy at image
`local/openclaw-amadeus:git-6210c70b0ca6-20260929215321`; the candidate
Compose environment is verified against the live host asset root and token.

Host acceptance passed for realistic 2x, anime 2x, explicit anime 4x, manual
`imageId`, authenticated controlled media reads, unauthenticated `401`, host
service restart durability, and OpenClaw container recreate durability. The
protected deployment checkpoints are
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260929215321` and the
candidate refresh
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260929215636`; post-deploy
evidence is retained under the matching external-volume deployment paths.

The remaining gate is a real owner WhatsApp inbound turn. Synthetic CLI runs
deliver through WhatsApp but lack trusted inbound sender metadata and therefore
see only the safe web tools; production sender policy was not weakened to make
the CLI probe pass. Do not claim owner-channel image-generation/upscale
acceptance until the owner sends a real inbound request and the reply/asset
correlation is recorded.

## 2026-09-29 Kurisu GPT-SoVITS v2Pro MPS production cutover — applied; owner acceptance pending

The production `amadeus-tts` cutover is applied from source commit `606270b`.
GPT-SoVITS v2Pro MPS is the only resident local TTS: the API listens on
loopback `127.0.0.1:19870` and the authenticated production adapter listens on
`127.0.0.1:19871`. The live bridge primary smoke returned
`X-Amadeus-TTS-Provider: gpt-sovits-mps` with valid MP3 audio. During a
controlled adapter stop, the same bridge returned valid cloud audio and the
container audit recorded `qwen-audio-3.1-tts-flash` as attempt 1 with
`provider_unavailable`; the executable bridge test records the exact
`qwen-audio-3.1-tts-flash` -> `qwen-audio-3.0-tts-flash` ordering.

The OminiX `com.amadeus.qwen3-tts` LaunchAgent is uninstalled and ports
`:18792` and `:18793` have no listeners. The complete rollback checkpoint is
retained at
`/Volumes/Avalon/backups/operation-skuld/kurisu-gpt-sovits-cutover-20260929T164028Z`;
its 2823-file manifest verifies with no missing, changed or symlinked entries.
Warm direct synthesis measured 2.581646 seconds for 3.312 seconds of audio
(RTF 0.7795); swap remained at 2202 MiB while sampled free memory was 62–78%.
All post-apply evidence is under
`/Volumes/Avalon/backups/operation-skuld/kurisu-gpt-sovits-cutover-postapply-20260929T171128Z/`.

On 2026-09-29 the latest active reference was changed through the
source-controlled MPS manager to
`WAV/crs_0695.WAV_0000000000_0000224000.wav`, using its matching dataset
transcript `裸の得意点が作れていないなら、つまり被験者はブラックホールに放り込まれるのと同じだから。`.
The source change is commit `fa434dc`, applied with
`infra/macos/manage-kurisu-gpt-sovits-tts.sh --apply`. Per owner request, the
active model directory retains only this one reference WAV alongside the
GPT-SoVITS weights. The previous active `crs_0274` WAV, before-change plist,
live health and final synthesis are retained in protected rollback/evidence at
`/Volumes/Avalon/backups/operation-skuld/kurisu-gpt-sovits-reference-20260929T200040Z-0695/`.
The earlier `crs_1373`, `crs_2263` and `crs_0274` reference evidence remains in
their respective external checkpoints. The NLTK `cmudict` and
`averaged_perceptron_tagger_eng` resources remain installed under the declared
`NLTK_DATA` runtime path.

The Goal remains open as `WAITING_FOR_OWNER_CHANNEL_ACCEPTANCE`. The owner
still needs to verify the real production voice turn for Japanese
pronunciation, Kurisu identity, visible text behavior and typed-text
isolation. MLX conversion remains a later independent Goal.

## 2026-09-29 Kurisu GPT-SoVITS v2Pro PoC — accepted for further integration

At the PoC checkpoint time, the isolated `bysq/TTS-KurisuMakise` v2Pro candidate loaded on MPS and passed
Japanese synthesis. An 8-line identical-text A/B set against the direct
`qwen-audio-3.1-tts-flash` model-bound voice, plus a five-run warm benchmark,
remain outside Git under
`/Volumes/Avalon/backups/operation-skuld/kurisu-gpt-sovits-poc-20260929/`.
The candidate then listened only on loopback `127.0.0.1:19870`; it was not
managed by launchd and had not been added to production routing. Production
`com.amadeus.qwen3-tts` was healthy at that checkpoint on PID `18387`, ports
`18792`/`18793`, and its Phase 0 file hashes were unchanged. The owner listened to the paired
files and judged `GPT-SoVITS 明显比 Qwen 3.1 更像牧濑红莉栖，Gate B 通过。`
The outcome was `ACCEPTED_FOR_FURTHER_INTEGRATION`; the MPS runtime and all
external evidence remain retained. The next planned Goal was
`docs/AMADEUS_KURISU_GPT_SOVITS_MPS_PRODUCTION_CUTOVER_GOAL.md`.
MLX conversion is deferred to a later independent optimization Goal.
Evidence and rollback scope are recorded in
`.agent/checkpoints/2026-09-29-amadeus-kurisu-gpt-sovits-poc-ab.md`.

## 2026-09-29 Qwen Audio TTS default pure voice clone — deployed

The cloud `default` request is now a pure voice-clone baseline. The bridge
sends only `text`, model-bound `voice`, `format`, `sample_rate`, and Japanese
`language_hints`; it omits instruction/persona/style, speed, and pitch.
Non-default emotions append the bounded emotion instruction.

Source commit `cc1ebfd` is deployed as
`local/9router:git-cc1ebfdeec3b-20260929T081836Z`. Focused bridge tests,
syntax checks, dry-run smoke, secrets scan, all three speech health checks,
and a real cloud default MP3 synthesis passed. The protected rollback
checkpoint is `/DATA/AppData/9router/backups/qwen-audio-tts-deploy-20260929T081836Z`;
source evidence is `.agent/checkpoints/2026-09-29-amadeus-qwen-audio-tts-default-pure-clone.md`.

# Project State — 2026-09-29

## 2026-09-29 Qwen Audio TTS model fallback — deployed

The protected `amadeus-tts` bridge now uses the bounded order
`qwen-audio-3.1-tts-flash` → `qwen-audio-3.0-tts-flash` → M204 OminiX local
fallback. The 3.1 and 3.0 cloned voices are separate protected files because
voice enrollment is model-bound. Source commit `13cbd55` is deployed as
`local/9router:git-13cbd559ab24-20260929T062044Z`; OpenClaw and ASR remain
unchanged.

3.1 voice enrollment from the authorized 46-second sample, four-case direct
cloud smoke, protected runtime preparation, live cloud bridge smoke, health/auth
checks, and the protected deployment checkpoint all passed. The temporary
`audio.nyannyan.top` Caddy/frp sample route was removed after enrollment; its
Cloudflare DNS record must be removed separately if it remains.

The protected deployment checkpoint is
`/DATA/AppData/9router/backups/qwen-audio-tts-deploy-20260929T062044Z`; the
dated source checkpoint is
`.agent/checkpoints/2026-09-29-amadeus-qwen-audio-tts-model-fallback.md`.

## 2026-09-29 Qwen Audio TTS cloud primary — owner accepted

The Qwen Audio TTS Goal is complete. Source commits `13ca03f` and `9347de1`
add the protected voice provisioning flow, the OpenAI-compatible 9Router
adapter, cloud-first `qwen-audio-3.0-tts-flash` synthesis, and one bounded
M204 OminiX fallback. The deployed 9Router image is
`local/9router:git-13ca03fa6fe0-20260929T051222Z`; OpenClaw remains on the
existing healthy `local/openclaw-amadeus:git-9e30a3dc08e8-20260928171059`
image. No second Agent/runtime or second resident local TTS model was added,
and the existing ASR route remains unchanged.

The protected 46-second reference and cloned voice identity stay outside Git.
Direct cloud smoke passed for the supported emotion cases and formats. The
real owner WhatsApp acceptance passed for all three required cases: typed
explicit voice produced one playable cloud media reply, ordinary typed text
produced no speech request and no media, and an inbound `audio/ogg; codecs=opus`
voice note produced one playable cloud media reply. No fallback was used in
these acceptance turns. The owner confirmed playback. The CLI
`openclaw agent --deliver` path is explicitly excluded from acceptance because
it bypasses the WhatsApp TTS lifecycle.

The protected deployment checkpoint is
`/DATA/AppData/9router/backups/qwen-audio-tts-deploy-20260929T051222Z`; the
owner acceptance evidence is
`/DATA/AppData/9router/backups/qwen-audio-tts-owner-acceptance-20260929T054329Z/evidence.json`.
The dated source checkpoint is
`.agent/checkpoints/2026-09-29-amadeus-qwen-audio-tts-cloud-release.md`.

## 2026-09-28 typed voice semantic modality heartbeat isolation — candidate live

Commit `bce1cc6` is pushed to `origin/main` and deployed as
`local/openclaw-amadeus:git-bce1cc67fc8a-20260928054649` on M204 OrbStack
`nyannyan`. Runtime SQLite/transcript evidence showed the reported private
message came from the 13:04 and 13:34 OpenClaw heartbeat polls, not an
inbound user message. Those turns carry native
`inputProvenance.kind=internal_system`, but the prior hook treated every
WhatsApp turn as typed input and caused `[[amadeus:reply-modality=default]]`
to prefix `NO_REPLY`, bypassing the core exact-token suppression.

The hook now injects typed reply modality only for
`inputProvenance.kind=external_user`. A marked `NO_REPLY` is also removed
before WhatsApp delivery as a narrow fail-closed guard. Existing inbound voice
lease handling and the sole voice-reply Skill are unchanged. Focused tests,
Amadeus tests, OpenClaw patch fixtures, architecture, secrets and build passed;
candidate health, Product Radar health and NAS read-only smoke passed. The
protected rollback checkpoint is
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260928054649`; post-deploy
evidence is under
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260928054649`.
The same heartbeat job was manually run after deployment. Its transcript
returned exact plain `NO_REPLY`, and the post-restart WhatsApp log contained no
outbound send for that run. Evidence:
`.agent/checkpoints/2026-09-28-typed-voice-heartbeat-isolation-candidate-live.md`.

## 2026-09-28 typed voice semantic modality candidate — owner-accepted

Commit `235387f` is pushed to `origin/main` and deployed as
`local/openclaw-amadeus:git-235387f23d2e-20260928043207` on M204 OrbStack
`nyannyan`. The previous fixed typed-text classifier was removed. Each typed
WhatsApp turn initializes a turn-scoped `replyModality=default`; the same
Agent turn semantically chooses `voice` or `default` and emits hidden control
metadata. The pinned OpenClaw TTS/WhatsApp patch records that metadata for the
current run/session, strips it globally before delivery, gates missing-marker recovery
on `voice`, and clears it at `agent_end`/TTL. The existing verified inbound
voice lease and sole `voice-reply` Skill remain unchanged.

The protected rollback checkpoint is
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260928043207`; health,
Product Radar, NAS read-only smoke, and WhatsApp linked/connected checks
passed. Focused tests, Amadeus full tests, OpenClaw 2026.9.4 patch fixtures,
architecture, secrets, and build passed. The owner confirmed the post-deploy
WhatsApp text and voice behavior is normal. Evidence:
`.agent/checkpoints/2026-09-28-typed-voice-semantic-modality-candidate-live.md`.

## Amadeus 1.6.5 model-capability adapter release — owner-accepted

Amadeus 1.6.5 is deployed on M204 OrbStack `nyannyan` with healthy immutable
OpenClaw image `local/openclaw-amadeus:git-fb7dd742b609-20260927142412`.
The owner confirmed the final repaired typed-to-voice behavior: one audio
attachment plus visible text in the exact `中文：...` / `日本語：...` format.

OpenClaw uses only the logical `openai/amadeus-image` capability. 9Router owns
strict GPT Image 2.5 → Gemini 3.1 Flash Image fallback; its Combo was
provisioned and reconciled through the existing management API, without source
or database edits. `arthur-combo`, `amadeus-asr`, `amadeus-tts`, `kurisu-v1`,
MP3, tagged TTS limits, global sensitive-tool denials, group admission and
unrelated service permissions remain preserved. Group image access is limited
to the existing admitted WhatsApp/Telegram groups plus the native
`image_generate` capability; direct non-owner access remains web-only.

Release gates, protected checkpoint, owner notification, health/smoke, real
transport/fallback evidence and post-deploy evidence are recorded in
`.agent/checkpoints/2026-09-27-amadeus-model-capability-final-release.md`.
The known pinned 9Router caveat remains: upstream HTTP 400 is
fallback-eligible, while missing-prompt 400 is rejected before Combo
 dispatch; no 9Router source change was introduced. The Goal is complete.

## Source and architecture

- Canonical `origin/main` contains the prior 1.6.4 released source and the new adapter Goal plan. Candidate source is on `codex/model-capability-adapter-2026-09`; its live image is not yet a final release. Keep source branch, candidate image tag, and release version distinct.
- OpenClaw 2026.9.4 is the **sole Agent runtime**. Native Amadeus/PUBG plugins, deterministic domain/presentation and one owner outbox remain; no retired runtime, keyword router, custom image provider, or sender fallback was introduced.

## Live release and rollback

- Previous released OpenClaw on M204 OrbStack `nyannyan` CasaOS: `local/openclaw-amadeus:git-b389e869d6a2-20260927084301` (Amadeus 1.6.4); Product Radar `local/product-radar:git-d988000e1c5d-20260924130631`; post-deploy OpenClaw and Product Radar health passed. WhatsApp remains linked. The protected pre-1.6.4 OpenClaw checkpoint is `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260927084301` (root chmod 0700; config copy 0600); post-deploy evidence is `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260927084301`. The 1.6.3 checkpoint `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260927082000` remains available. Preserve both for rollback.
- The previous released OpenClaw config had default image-generation model `openai/ag/gemini-3.1-flash-image`, a 180-second timeout, and the owner-approved shared `browser.ssrfPolicy.dangerouslyAllowPrivateNetwork=true` opt-in. It reuses the existing `OPENCLAW_9ROUTER_API_KEY` SecretRef/env source. No Google key/path was added. The owner confirmed real image-generation acceptance on 2026-09-27; see the acceptance record below.
- The **same** Mac `com.amadeus.qwen3-tts` LaunchAgent serves the original A (~46s) reference with pinned community MLX 1.7B Base 8-bit ICL, `language=Auto`, one bounded inference worker and `ProcessType=Interactive`. Post-1.6.4 read-only host health is HTTP 200/ready, LaunchAgent PID 50062, last exit 0. The matrix process PID 79839 is no longer present. No TTS service restart occurred; preserve the exact MPS rollback.
- The owner previously accepted real WhatsApp Japanese PTT/nonduplicated visible text/typed-without-voice and confirmed no pronunciation/naturalness/volume/rhythm anomaly after 1.6.2. This remains prior evidence, not post-1.6.3 acceptance.

## 1.6.4 image-generation rollout — owner-accepted

- The previous released 1.6.4 config had the native `image_generate` default path through the existing `openai` provider and 9Router. The bundled provider is loaded; `plugins/amadeus/skills/image-generation/SKILL.md` is eligible. The Skill uses semantic intent, with no fixed phrase router, duplicated model ID, or SOUL/global AGENTS change.
- A direct authenticated transport smoke from the OpenClaw container requested `ag/gemini-3.1-flash-image`, returned HTTP 200 and one JPEG (569,192 bytes), and handled the binary only in memory. This does not prove Agent selection or channel attachment delivery.
- CLI-driven agent turns were not real owner-inbound tests. The fresh explicit CLI session's exact `context.compiled` event offered only `web_fetch` and `web_search`; no `image_generate` call or attachment occurred. A factory reproduction under the configured owner sender rule includes `image_generate`, but this does not prove that CLI path. The owner subsequently confirmed real owner-channel image delivery, typed-text isolation, and inbound voice/TTS acceptance: “已验收 一切正常可以收尾”. Treat that owner attestation as the acceptance evidence; do not treat the CLI-only sessions as proof.
- Post-1.6.4 read-only host TTS health is HTTP 200/ready (LaunchAgent PID 50062, exit 0); no TTS or 9Router restart occurred.

## 1.6.2 stability cleanup release

- The historical 1.5.3 Voice remote branch had only an older Goal document and was retired after main-content comparison. MLX source terminology now says selected community backend, preserving the third-party caveat and explicit MPS rollback.
- Native LaunchAgent was applied with private launchd stderr, truncated above 1 MiB before each bootstrap. The previous native source/plist, protected A profile/token and exact MPS rollback remain outside Git. Same A/MLX/Auto/Interactive engine, model, timeout, worker and format are verified. Port 18792 remains deliberately wildcard for OrbStack/9Router; guest-to-host/LAN-address and authenticated 9Router speech succeeded, unauthenticated synthesis/inventory returned 401. No independent physical LAN peer test was available, so LAN exposure is conservatively assumed.
- A real WhatsApp audio inbound produced one media reply with Japanese TTS and a Chinese visible summary; an ordinary typed inbound produced a text-only reply. The owner replied “确认正常 通过” when asked to verify accepted Kurisu sound, visible text correctness/nonduplication and typed isolation. No Docker/CasaOS rebuild or new voice experiment was run. Protected native recovery and real acceptance: `.agent/checkpoints/2026-09-26-amadeus-1.6.2-stability-release.md`.

## Measured limits and operational watch

- Original single DM baseline: ASR 0.702s, Agent 3.471s, TTS+MP3 35.162s, end-to-end 42.462s. Fixed short HTTP A/MPS Interactive 20-run p50 4.48s/p95 5.28s; A/MLX 20-run p50 3.30s/p95 3.52s. A/MLX normal five-run p50 5.42s. MP3 encode remains minor; direct Opus not selected.
- MLX cold/real `vmmap` peak reached 18.4 GiB on 24 GiB Mac; swap rose from ~3.63 to ~6.75 GiB, reached ~7.03 GiB after a post-release real voice then fell to ~6.31 GiB; sampled memory pressure ~70–80% free. Idle footprint ~3.3 GiB; long-term memory safety is a monitoring gate, not a zero-risk claim. A/MPS before switch had ~9.3 GiB physical footprint. B ~15s reference hit four supervised 110s timeouts; its incomplete cells are explicitly documented, not filled with guessed p95.
- Docker cache patch-only candidate wall 39s→3s; plugin-dist-only 1s with OS/glibc/npm cached. Machine-checkable performance report and numeric data are in `docs/reports/`. Full local gates, immutable CasaOS release/checkpoint and owner notification passed. Known `LOG_POLICY=warning` and optional media adapter absence remain; post-release real WhatsApp owner acceptance and canonical `main` push passed. Four B configs remain safety-incomplete; owner explicitly cancelled further B tests after accepting released A+MLX (Goal §12). The numeric data remains incomplete, not fabricated; the performance Goal is complete as amended. Strict doctor has one known optional media-adapter failure; non-strict doctor exits 0.

Use `docs/CURRENT_TASK.md` for the next action and dated `.agent/checkpoints/2026-09-26-*` for evidence and rollback, not historical diaries as runtime instructions.
