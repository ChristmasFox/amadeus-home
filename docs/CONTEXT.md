# Canonical context — 2026-09-27

Read this with `docs/CURRENT_TASK.md` and inspect Git/live state before
runtime work. The active Goal is explicitly named there; older Goal documents
and checkpoints are audit evidence, not live instructions.

- Last **released** Amadeus version is 1.6.4 on canonical `origin/main`.
  The live M204 OrbStack `nyannyan` CasaOS OpenClaw is the healthy 1.6.4
  **model-capability adapter candidate** image
  `local/openclaw-amadeus:git-02df41443a54-20260927125732`, not a final
  release. The work branch is `codex/model-capability-adapter-2026-09`.
  Product Radar still uses its prior image. No release version bump has occurred.
- OpenClaw 2026.9.4 is the sole Agent/planner with native PUBG/Amadeus plugins,
  deterministic domain/presentation and one owner outbox. No LangBot/n8n/old
  runtime, second planner/sender, keyword router or 9Router source fork.
- The current OpenClaw-facing image model is the stable
  `openai/amadeus-image` capability. 9Router's `kind=image` Combo owns strict
  **GPT Image 2.5 → Gemini 3.1 Flash Image** fallback, amended by the owner
  after the initial Gemini-first candidate. The ordered Combo is idempotently
  managed through the existing loopback management API; the prior order and
  original absent-Combo states each have separate protected rollback files.
  One current GPT-first authenticated OpenClaw-network transport smoke returned
  a valid PNG; the exact live Combo helper passed a synthetic 429 → Gemini
  fallback fixture. Neither is real group-channel delivery proof. The pinned
  router treats upstream HTTP 400 as fallback-eligible; malformed request
  validation before Combo dispatch returns 400. Do not overclaim this boundary.
- `nine_router/arthur-combo`, `amadeus-asr` and `amadeus-tts` are unchanged.
  The same native Mac TTS LaunchAgent (PID 50062 at the last check) uses the
  protected A/Kurisu reference, pinned community MLX 1.7B Base 8-bit, Auto
  language and Interactive scheduling. The candidate has `tts.auto=tagged`
  for verified inbound voice and explicit typed-to-voice, with the unchanged
  Japanese-audio/Chinese+Japanese-visible contract, MP3, `kurisu-v1`, 1200
  characters and 120-second timeout. Agent-facing generic `tts,message` stay
  denied. The native TTS and 9Router processes were not restarted.
- Candidate config readback and a live policy projection show owner privileges
  preserved, non-owner WhatsApp/Telegram group `image_generate` plus the two
  safe web tools, and non-owner WhatsApp direct messages still web-only.
  **Real owner/non-owner group image and three-way voice acceptance remain
  pending.** The owner's general “tested, no issues” feedback is not a
  case-by-case attestation. Do not release or mark the Goal complete from
  config/tests alone.
- Protected rollback and content-safe evidence are in
  `.agent/checkpoints/2026-09-27-amadeus-model-capability-*.md`, particularly
  the Combo provision, candidate, and GPT-first priority records. The candidate
  release checkpoint was immediately tightened to directory 0700, config and
  manifests 0600; the source deployment workflow now creates these private
  modes from the outset. Runtime secrets, weights, references and generated
  media remain outside Git. The separate safety-stopped TTS V2 worktree is
  historical and untouched by this Goal.
- Development: `pnpm workflow:plan` selects minimum validation; no automatic
  Docker/deploy. The active Goal explicitly requires full tests/build/typecheck,
  secrets scan, immutable OpenClaw release workflow, protected checkpoints,
  real channel acceptance, a single patch version bump *after* acceptance,
  health/smoke and independent rollback evidence. `scripts/deploy-openclaw.sh`
  is dry-run by default and requires explicit `--apply`. The private host
  profile remains outside Git and must be selected for worktree deployment.
- Operational watch: native MLX cold/real memory peak previously reached
  18.4 GiB on the 24 GiB Mac with transient swap growth; retain the exact
  external A/MPS rollback and monitor memory pressure. Optional media adapter
  absence and the existing log-policy warning are known, not voice fallbacks.
