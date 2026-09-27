# Current Task — Amadeus Model Capability Adapter

Date: 2026-09-27 local. Active Goal: `docs/AMADEUS_MODEL_CAPABILITY_ADAPTER_GOAL.md`, explicitly activated by the operator for this task. Work branch: `codex/model-capability-adapter-2026-09`, based on `origin/main` `5705e79ab62b65fc1ce114077e36569c756d2a68`.

Execute the Goal end-to-end: provision the 9Router-owned `amadeus-image` fallback capability using the existing management API boundary; point OpenClaw at that logical model; extend the existing voice-reply Skill for typed explicit voice requests and the pinned `tts.auto=tagged` semantics; narrowly admit `image_generate` for already-admitted supported group members; validate, release, deploy, and record rollback/real acceptance evidence. Preserve arthur-combo, ASR/TTS contracts, unrelated permissions, and all existing runtime/service boundaries. Do not modify 9Router source or expand into ASR/TTS combo work.

The `amadeus-image` Combo was idempotently provisioned with an external
minimal prestate rollback, and a real authenticated OpenClaw-network image
transport smoke succeeded through Gemini. Exact live 9Router helper tests
proved synthetic 429 fallback to GPT Image 2.5; no damaging live fault was
induced. OpenClaw **candidate** `02df414` is now live on M204 with version
1.6.4 unchanged, logical `openai/amadeus-image`, tagged TTS, and narrowly
scoped group image policy. Read-only live policy projection passed; it is not
real group ingress acceptance. The prior image/config and 9Router prestate
are independently recoverable. See the dated Combo and candidate checkpoints.

The release checkpoint directory initially had mode 0755, was tightened to
0700 with 0600 manifests, and the deployment source has been fixed to create
protected mode from the outset; validate this on final release. 9Router and
native TTS PIDs were unchanged. On 2026-09-27 the owner amended the image priority to GPT Image 2.5 first,
Gemini 3.1 Flash Image second. The Git desired state/Goal and focused tests
now reflect that order, but the live Combo still has the earlier order until
a protected reconcile and fresh GPT-first smoke complete. The prior candidate
checkpoint remains historical evidence. The pinned 9Router helper treats upstream
HTTP 400 as fallback-eligible, whereas request-level missing-prompt 400 is
rejected before Combo dispatch; do not overclaim a general non-fallback
boundary or modify 9Router source. Real owner/non-owner group image and
three-way voice acceptance remain pending, as do the single version bump,
final release, project-state closure, and Goal completion. The separate V2
TTS worktree remains untouched.

Production changes require a protected pre-apply checkpoint, explicit use of the existing release workflow, health/smoke verification, and rollback evidence. Do not record secrets or generated media payloads in Git. Goal completion remains contingent on every acceptance criterion in the Goal document, including real channel tests.
