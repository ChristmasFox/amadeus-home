# Canonical context — 2026-10-08

Read this with `docs/CURRENT_TASK.md`; Amadeus 1.9.9 is deployed on CasaOS
`nyannyan` as `local/openclaw-amadeus:git-b80f9a7882cc-20261008052549`.
The active Goal is `docs/AMADEUS_QWEN_IMAGE_PUBLIC_LAB_GOAL.md`; the public
Image Lab is planned, while production image generation remains GPT-only.
VPS subscription accounting is live from T0 `2026-10-08T04:58:07Z`; provider
and HY2/VLESS sources are healthy, all five Labmem identities have sampled
traffic on both protocols, and legacy credentials remain active. The existing
owner report jobs retain their IDs at 09:30 and 21:30 Asia/Shanghai and use the
owner outbox. Reconciliation remains `uncalibrated`.

The operator **closed** the VPS accounting Goal after reporting a normal direct
owner query and directing that the legacy token be preserved. All 24 public
subscription links returned HTTP 200 and matched the VPS files. Both report
Cron jobs remain enabled at 09:30/21:30 Asia/Shanghai; the 21:30 run was still
in the future at closure. Reconciliation remains `uncalibrated`, so no gap or
anomaly is claimed. A legacy subscription bearer-token path had previously
appeared in a tool output; it remains a documented residual and was not
addressed by rotation. See the Goal and deployment checkpoint for full details.

The dated Amadeus and 9Router entries below are historical snapshots unless
the current task pointer says otherwise. Re-read Git/live state before work.

## Current 9Router runtime — 0.5.95 deployed

On 2026-10-07, commit `cb223a0` was built from the protected Git snapshot and
deployed as immutable image
`local/9router:git-cb223a0bc9e4-20261007T065751Z` (manifest
`sha256:2e5f966f3b063f9d5045e0b75ace38758e9e5e6867505bbb39a2a5a9a1f966e4`).
The pinned base digest and Amadeus-managed npm package, TTS-style,
account-policy, and Combo-safety patches are preserved. Health, expected host
loopback auth rejection, live GPT Image Combo and policy checks passed. The
protected rollback checkpoint is
`/DATA/AppData/9router/backups/router-upgrade-20261007T065751Z`; full evidence
is in `.agent/checkpoints/2026-10-07-9router-0.5.95-upgrade.md`.

## Previous GPT-only image release — Amadeus 1.9.7 (superseded)

Release source commit `4316946bd3fe` runs on CasaOS machine `nyannyan` as
immutable image
`local/openclaw-amadeus:git-4316946bd3fe-20261007125707` (manifest
`sha256:5244b1f681a33c64cba633095c6529e613dcba0dddf6637213028965a2b806ba`).
`AMADEUS_QWEN_IMAGE_LOCAL_ONLY=0` and
`AMADEUS_QWEN_IMAGE_FALLBACK_ENABLED=0`; the route overlay remains installed
but normal primary failures do not issue a Qwen request. 9Router remains the
sole `cx/gpt-image-2.5` primary. The operator reported a 408 from
`nine_router/arthur-combo`; no new live image request was issued during this
release, so that upstream timeout remains undiagnosed.

OpenClaw/Product Radar health, Gateway registration, NAS read-only smoke,
owner notification/outbox, and post-deploy maintenance passed. The optional
media-adapter smoke was skipped because that service is absent; managed log
policy reported a warning. Protected rollback and full evidence:
`.agent/checkpoints/2026-10-07-amadeus-1.9.7-gpt-only-image-release.md`.

## Superseded local-Qwen fallback release — Amadeus 1.9.6

Release commit `e7a815c` runs on CasaOS machine `nyannyan` as
`local/openclaw-amadeus:git-e7a815c07114-20261007054830`. 9Router remains the
sole `cx/gpt-image-2.5` primary. Production `AMADEUS_QWEN_IMAGE_LOCAL_ONLY=0`
enables one OpenClaw-owned local Qwen attempt after eligible operational
failures; safety/policy refusals and invalid requests remain terminal. The
authenticated bridge is healthy on loopback port 18793, serial, reference-edit
enabled, and uses a 600000 ms image deadline. Authenticated container model
discovery, 9Router reference-byte and fallback-owner checks, Gateway
registration, service health, NAS read-only smoke, owner outbox, and post-
deploy maintenance passed. Optional media-adapter smoke was skipped because
the adapter is absent; log policy returned a warning.

Krea2 active source and Compose secret mount were removed; the old LaunchAgent
was absent and external model files were preserved. The real WhatsApp request
that first fails on GPT Image and visibly succeeds through local Qwen has not
yet been proven. Do not mark the Goal complete until that reference-edit path
and the healthy-primary no-fallback path are accepted. Protected rollback and
deployment evidence: `.agent/checkpoints/2026-10-07-amadeus-1.9.6-qwen-fallback-release.md`.

## Superseded Amadeus image retry and safety runtime — 1.9.5

OpenClaw 2026.9.4 runs Amadeus 1.9.5 from commits `adcd431` and `0a062a1` in
immutable image
`local/openclaw-amadeus:git-0a062a1c2c13-20261005153543` with image manifest
`sha256:f1723c78db0f21f4867d2b607b4407d13babb997f41eced25e5628469e9bb80c`.
The native image task retries at most once and only for transient transport
failures. Safety/policy refusals terminate immediately; account entitlement or
long locks and invalid requests do not retry. The terminal lifecycle passes a
bounded failure category to the Kurisu message enricher, which keeps raw
provider details out of user text and suggests a safe non-sensitive rewrite for
safety refusals.

At the time of this superseded Amadeus release, 9Router ran
`local/9router:git-0a062a1c2c13-20261005T153458Z` with image manifest
`sha256:347a905f925d5b29ea16e950cddc1c2d56fe4cb14ca10560a160534913fdf57e`.
Both the package standalone bundle and the live `/app` fixture bundle carry
the safety-terminal Combo patch. The exact compiled live fixture passed:
ordinary upstream 400 remains fallback-eligible, while a synthetic content
policy refusal calls only the first model. No provider, credential, or account
state was changed by the fixture.

Focused image-route tests, 94 Amadeus delivery tests, the model-capability
adapter suite, Amadeus typecheck, secrets scan, `git diff --check`, BuildKit
image builds, Gateway registration, health checks, NAS read-only smoke, owner
notification/outbox smoke, and post-deploy maintenance passed. The optional
media adapter remains absent and its network smoke was skipped. No unsafe live
prompt was submitted; safety behavior is covered by classifier, patched-bundle,
and exact compiled-router tests.

Protected checkpoints:
`/DATA/AppData/9router/backups/router-upgrade-20261005T153458Z` and
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261005153543`.
Full evidence:
`.agent/checkpoints/2026-10-05-amadeus-1.9.5-image-retry-safety-chain.md`.

## Amadeus 1.9.4 — superseded inbound image reference recovery release

The 1.9.4 release repaired model-authored inbound staging paths before
`image_generate`; its evidence remains in
`.agent/checkpoints/2026-10-04-amadeus-1.9.4-inbound-image-reference-recovery.md`.

## Historical release context retained below

# Canonical context — 2026-10-04

Read this with `docs/CURRENT_TASK.md`; the current Amadeus inbound image
reference recovery is complete. Re-read Git/live state before further work.

## Current Amadeus inbound image reference runtime — 1.9.4 deployed

OpenClaw 2026.9.4 runs Amadeus 1.9.4 from commit `5c738c9` in immutable image
`local/openclaw-amadeus:git-5c738c9be1ff-20261003190303`; image manifest
`sha256:c5513dc0127a074e047f701f1b9747073d95369903da4c1b25de0f600676b89b`.
The affected private-chat image was downloaded and included in model context, but
the model then supplied an inbound staging path with a missing separator to
`image_generate`. Release 1.9.4 remembers the current inbound canonical path and
repairs only `/media/inbound/` references immediately before the native tool call;
persistent generated-image paths are left untouched. The Amadeus suite (132),
typecheck, secrets scan, BuildKit image build, Gateway registration, health and
post-deploy maintenance passed. Evidence is in
`.agent/checkpoints/2026-10-04-amadeus-1.9.4-inbound-image-reference-recovery.md`.

## Amadeus 1.9.3 — superseded reply envelope runtime

OpenClaw 2026.9.4 runs Amadeus 1.9.3 from commit `e2a94af` in immutable image
`local/openclaw-amadeus:git-e2a94af6def4-20261003182157`; image manifest
`sha256:583f747e0b0a410e1133ea8383c1d6b2b5e95b1010592b40054c74f724a9f698`.
The decoder accepts the legacy first-line `MEDIA:` prefix only when a valid
DeliveryEnvelope v2 object follows. It discards that path before parsing and
keeps runtime-owned attachments as the sole asset authority. CasaOS host
`nyannyan` is healthy, Gateway registration passed, and post-deploy maintenance
passed. Evidence is in
`.agent/checkpoints/2026-10-04-amadeus-1.9.3-media-envelope-recovery.md`.

## Current Amadeus image/upscale runtime — 1.9.2 superseded

OpenClaw 2026.9.4 runs Amadeus 1.9.2 from commit `8e667cf` in immutable image
`local/openclaw-amadeus:git-8e667cf26122-20261003174442`; the host ImageAssets
service is healthy on port 18792 with the pinned `realesrgan-mlx` engine.
Plain 2x/4x requests now preserve exact multiplier dimensions, explicit 2K/4K
profiles remain long-edge caps, and large jobs use tiled inference. Evidence is
in `.agent/checkpoints/2026-10-04-amadeus-1.9.2-upscale-recovery.md`.

## Current Git/runtime boundary — Qwen3-TTS MLX

The accepted voice path is Qwen3-TTS 1.7B Base through pinned `mlx-audio`
0.5.6 / MLX 8-bit, using the unchanged operator-owned 46s A `kurisu-v1`
reference and `lang_code=auto`. The TTS default-only policy follow-up is complete:
per-request emotions are disabled while preserving future opt-in code. The authenticated native LaunchAgent listens
only on `127.0.0.1:18794`; port 18792 remains owned by the separate ImageAssets
service and is unchanged. This uses the active Goal's explicit live-collision
exception and avoids restarting OpenClaw for an unrelated endpoint move.

9Router keeps one `amadeus-tts` provider connection and routes default speech
local MLX → Qwen Audio 3.1 → Qwen Audio 3.0. Its healthy immutable image is
`local/9router:git-0fdfdbbd91f2-20260930T211901Z`, image ID
`sha256:c6c2bf40c95d62a49c14cd7ec7c8188002a35352bedc7cc911397e857f1caf7b`.
Source commits are `0fdfdbb` (rebaseline/deployed bridge), `45f96a9`
(retirement cleanup), and `5013800` (default-only local-first policy). The live
bridge reports emotion controls disabled. The Qwen3-TTS Goal at that time left
Amadeus `VERSION=1.7.4` unchanged; a later image-lifecycle release bumped it to 1.7.5. GPT-SoVITS and
OminiX active runtime/source/model/venv/LaunchAgent/provider assets have been
removed after automated acceptance.

The protected archive for the retired Kurisu WAV sample is
`/Volumes/Avalon/backups/operation-skuld/amadeus-kurisu-wav-archive-20261001`
(manifest SHA-256
`e1362946d7d04abb4d22faa4ed65e93acbeb97045445c955992ebfd58e75a6c9`). The
canonical A pair, MLX weights, credentials, cloud voice IDs, and generated
media remain outside Git. The owner waived listening/owner-channel acceptance
for this Goal; no human voice-quality claim is made. Full evidence is in
`.agent/checkpoints/2026-10-01-amadeus-qwen3-tts-mlx-rebaseline.md`.

## Amadeus 1.9.0 — superseded private reply recovery release

OpenClaw 2026.9.4 runs Amadeus 1.9.0 from commit `d43246a` in immutable image
`local/openclaw-amadeus:git-d43246af1d21-20261003063024` (image ID
`sha256:347056d00ce97a01b40b0335c66753229647fbbf9f2ac070b91f6b007a5f429f`).
`/opt/amadeus/VERSION=1.9.0`; OpenClaw is healthy, Gateway registration is
present, Product Radar is healthy, and post-deploy maintenance passed.
Protected checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20261003063024`.
Evidence: `.agent/checkpoints/2026-10-03-amadeus-1.9.0-plain-reply-recovery.md`.

Release 1.9.0 recovers ordinary plain assistant text as one typed text part
when a private external turn ignores the JSON-only DeliveryEnvelope instruction.
Protocol-looking objects, paths, fenced payloads and control tokens remain
fail-closed, and inbound voice/internal origins keep their stricter policies.
This prevents a natural private reply from being replaced by the generic
`回复格式异常，已记录，请稍后重试。` fallback.

## Amadeus 1.8.9 — superseded upscale target recovery release

OpenClaw 2026.9.4 runs Amadeus 1.8.9 from commit `f82fb78` in immutable image
`local/openclaw-amadeus:git-f82fb78b712f-20261003060001` (image ID
`sha256:9902b49c364c093b88621bde1ec9692df846dbb091087cfb64658f8539f90716`).
`/opt/amadeus/VERSION=1.8.9`; OpenClaw is healthy, Gateway registration is
present, Product Radar is healthy, and post-deploy maintenance passed.
Protected checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20261003060001`.
Evidence: `.agent/checkpoints/2026-10-03-amadeus-1.8.9-upscale-target.md`.

Release 1.8.9 validates model-supplied upscale targets against the canonical
`img_[0-9a-f]{32}` registry ID format. Inbound filesystem paths and filenames
are omitted so the image service resolves the private-chat reply image or the
most recent image in the current conversation; an explicit canonical ID remains
authoritative. This removes the recent `image_id_invalid` failures caused by
model calls carrying staged paths such as `input-*.png`.

## Amadeus 1.8.8 — superseded private image completion fallback release

OpenClaw 2026.9.4 runs Amadeus 1.8.8 from commit `e4e3498` in immutable image
`local/openclaw-amadeus:git-e4e3498ba664-20261002162339` (image ID
`sha256:2869cfc03311c84eb95e0cb383d6aa1290d454f9fc086cd055b89c1179bae856`).
`/opt/amadeus/VERSION=1.8.8`; OpenClaw is healthy, Gateway registration is
present, and Product Radar reuses its unchanged healthy image. Protected
checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20261002162339`.
Evidence: `.agent/checkpoints/2026-10-03-amadeus-1.8.8-image-completion-fallback.md`.

Successful ordinary image generation imports the trusted asset before native
continuation, passes read-only image context through the durable completion
handoff, and binds the Completion Agent caption to the one Amadeus-owned image
send. A queued native handoff waits for its caption; only failure or timeout
uses the attachment-only fallback. The optional media adapter remains absent
and its network smoke is skipped. Managed compose log policies pass; the host
Docker default policy remains a warning because `/etc/docker/daemon.json` is
absent. The 1.8.4 completion caption lets Kurisu choose natural wording and
length without an Amadeus character ceiling or short-caption instruction. The
1.8.5 caption semantic deadline is 120 seconds, and native completion handoff
deadline expiry now invokes the attachment-only fallback so generated media is
not stranded when the Completion Agent times out. Release 1.8.6 sets the
native image model task timeout to 120 seconds. Release 1.8.7 suppresses
control-token-prefixed silent sentinels at the typed decoder and rejects
control tokens again at the WhatsApp final text adapter, closing the
protocol-text leakage path. Release 1.8.8 keeps generated media claimable by
an attachment-only fallback after a native continuation timeout and prevents
that fallback from replacing the private session route.

Reference-image failures were caused by the missing live 9Router `/images/edits`
route, not model selection. 1.8.0 sends one validated PNG/JPEG/WebP reference
through the existing `openai/amadeus-image` JSON generations route, preserving
bytes as Codex `input_image` and Gemini `inlineData`. Multi-reference requests
fail closed; no 9Router source, account, credential, or Combo changed. Live
post-deploy fixture passed and route error projection was clean. The owner
subsequently confirmed the reference-image generation/delivery path works. No
cross-restart exactly-once claim is made.

## Historical 2026-09-27 release snapshot (audit only)

- Released product: `VERSION=1.6.5`, source release commit `fb7dd74` with
  final content/state documentation commit `6fb4926` on
  `codex/model-capability-adapter-2026-09` (pushed). Final immutable OpenClaw
  image is `local/openclaw-amadeus:git-fb7dd742b609-20260927142412`, healthy on
  M204 OrbStack `nyannyan`; Product Radar remains healthy on its unchanged
  image. The explicit release workflow completed with owner notification,
  health/smoke and post-deploy maintenance.
- OpenClaw 2026.9.4 remains the sole Agent/planner with native PUBG/Amadeus
  plugins, deterministic domain/presentation and one owner outbox. No
  LangBot/n8n/old runtime, second planner/sender, keyword router or 9Router
  source fork was introduced.
- OpenClaw uses logical `openai/amadeus-image`; 9Router owns strict GPT Image
  2.5 → Gemini 3.1 Flash Image fallback (`kind=image`, `strategy=fallback`).
  The Combo was provisioned/reconciled through the existing management API,
  with protected absent-Combo and priority-only rollback files. Real GPT-first
  transport smoke and exact compiled-path synthetic fallback evidence passed.
- `nine_router/arthur-combo`, `amadeus-asr`, `amadeus-tts` and unrelated
  capability permissions remain unchanged. Candidate/release config uses
  `tts.auto=tagged`, `amadeus-tts`, `kurisu-v1`, MP3, 1200-character limit and
  120-second timeout; Agent-facing generic `tts,message` remain denied.
  Typed/inbound voice visible output is normalized to exactly `中文：...` plus
  `日本語：...`, with one audio reply. The owner confirmed the repaired real
  behavior after the final candidate fix. Ordinary typed text remains silent.
- Existing admitted WhatsApp/Telegram groups receive only the scoped safe web
  tools plus native `image_generate` for non-owner senders; direct non-owner
  sender policy remains web-only and sensitive tools remain restricted. The
  owner accepted the real image/group behavior and final voice behavior.
- Protected final rollback/evidence: release checkpoint
  `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260927142412` (0700 root,
  0600 config/manifests), post-deploy evidence under
  `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260927142412`
  (0700), and final content-safe record
  `.agent/checkpoints/2026-09-27-amadeus-model-capability-final-release.md`.
  Runtime secrets, TTS weights/reference, credentials and generated media stay
  outside Git.
- Known boundary: pinned 9Router treats upstream HTTP 400 as fallback-eligible;
  request-level missing-prompt 400 is rejected before Combo dispatch. This is
  documented; no 9Router source change was made. The separate TTS V2
  safety-stopped worktree was not touched.
