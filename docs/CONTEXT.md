# Canonical context — 2026-10-01

Read this with `docs/CURRENT_TASK.md` and inspect current Git/live state before work. The active Goal is
`docs/AMADEUS_IMAGE_GENERATION_LIFECYCLE_CAPTION_UX_GOAL.md`. The current worktree implements the
accepted/success/failure typed image lifecycle, multimodal Kurisu caption and same-bubble native media
caption on top of the existing DeliveryEnvelope v2/background-completion source.

## Current Git/runtime boundary (2026-10-01)

Git `main` HEAD at task start was `9a95368` (`docs: plan image generation lifecycle caption UX`). The
read-only runtime check observed the healthy single OpenClaw container on OrbStack CasaOS `nyannyan` using
`local/openclaw-amadeus:git-d7f2847d82f4-20260930154020` and OpenClaw `2026.9.4`; Gateway logs
confirm Amadeus registration. This is the prior background-completion candidate; lifecycle/caption work is not live. No production apply was performed.
Source-level tests/typecheck/build/secrets gates have passed, but lifecycle/caption source is not live. A
separately authorized deployment and real owner WhatsApp Gates A–F remain necessary. The bounded task coordinator and delivery ledger are in-process;
cross-restart exactly-once is not claimed by source tests.

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
