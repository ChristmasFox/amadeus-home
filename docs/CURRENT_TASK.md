# Current Task — Amadeus Model Capability Adapter

Date: 2026-09-27 local. Active Goal: `docs/AMADEUS_MODEL_CAPABILITY_ADAPTER_GOAL.md`, explicitly activated by the operator for this task. Work branch: `codex/model-capability-adapter-2026-09`, based on `origin/main` `5705e79ab62b65fc1ce114077e36569c756d2a68`.

Execute the Goal end-to-end: provision the 9Router-owned `amadeus-image` fallback capability using the existing management API boundary; point OpenClaw at that logical model; extend the existing voice-reply Skill for typed explicit voice requests and the pinned `tts.auto=tagged` semantics; narrowly admit `image_generate` for already-admitted supported group members; validate, release, deploy, and record rollback/real acceptance evidence. Preserve arthur-combo, ASR/TTS contracts, unrelated permissions, and all existing runtime/service boundaries. Do not modify 9Router source or expand into ASR/TTS combo work.

Source candidate `8c1599f` is committed and pushed; previous released
OpenClaw remains Amadeus 1.6.4. The 9Router `amadeus-image` Combo has been
provisioned and verified with a protected minimal rollback snapshot, real
OpenClaw-network image transport smoke, and exact-path synthetic fallback
tests. A protected pre-goal OpenClaw config/image/WhatsApp monitor checkpoint
preceded that write. See
`.agent/checkpoints/2026-09-27-amadeus-model-capability-combo-provision.md`.
The pinned 9Router helper treats upstream HTTP 400 as fallback-eligible;
request-level missing-prompt 400 is rejected before Combo dispatch. Do not
claim a broader non-fallback guarantee or modify 9Router source under this
Goal. Candidate OpenClaw deployment and real channel acceptance remain
pending. The V2 TTS boundary worktree remains separate and untouched.

Production changes require a protected pre-apply checkpoint, explicit use of the existing release workflow, health/smoke verification, and rollback evidence. Do not record secrets or generated media payloads in Git. Goal completion remains contingent on every acceptance criterion in the Goal document, including real channel tests.
