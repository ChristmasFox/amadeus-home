# Canonical context — 2026-10-03

Read this with `docs/CURRENT_TASK.md`; the Qwen3-TTS MLX rebaseline Goal is
complete and the current follow-up disables per-request emotions while keeping
all requests default/local-first. Re-read Git/live state before further work.

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

## Current Amadeus WhatsApp/image runtime — 1.9.0 deployed

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
