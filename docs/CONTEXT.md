# Canonical context — 2026-10-01

Read this with `docs/CURRENT_TASK.md`; it points to the Qwen3-TTS MLX
rebaseline Goal. Runtime Gates A–G passed and final source/state evidence is pushed to canonical
`main`; re-read Git/live state before any further work.

## Current Git/runtime boundary — Qwen3-TTS MLX

The accepted voice path is Qwen3-TTS 1.7B Base through pinned `mlx-audio`
0.5.6 / MLX 8-bit, using the unchanged operator-owned 46s A `kurisu-v1`
reference and `lang_code=auto`. The authenticated native LaunchAgent listens
only on `127.0.0.1:18794`; port 18792 remains owned by the separate ImageAssets
service and is unchanged. This uses the active Goal's explicit live-collision
exception and avoids restarting OpenClaw for an unrelated endpoint move.

9Router keeps one `amadeus-tts` provider connection and routes default speech
local MLX → Qwen Audio 3.1 → Qwen Audio 3.0. Its healthy immutable image is
`local/9router:git-0fdfdbbd91f2-20260930T211901Z`, image ID
`sha256:c6c2bf40c95d62a49c14cd7ec7c8188002a35352bedc7cc911397e857f1caf7b`.
Source commits are `0fdfdbb` (rebaseline/deployed bridge) and `45f96a9`
(retirement cleanup). Amadeus `VERSION=1.7.4` is unchanged. GPT-SoVITS and
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

## OpenClaw/Product Radar boundary — unchanged by the TTS Goal

The owner-accepted image lifecycle candidate continues to run immutable
OpenClaw image
`local/openclaw-amadeus:git-628703c803e7-20260930184906` (OpenClaw `2026.9.4`)
on OrbStack `nyannyan`; Amadeus registration is healthy. Product Radar and the
image-generation lifecycle/caption implementation remain unchanged. The owner
attested that real WhatsApp Gates A–F passed; deployment notification/outbox
smoke is not Gate A. The task coordinator and delivery ledger are bounded
process-local state, so cross-restart exactly-once is not claimed.

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
