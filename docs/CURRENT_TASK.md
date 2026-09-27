# Current Task — Amadeus Model Capability Adapter

Date: 2026-09-27 local. Active Goal: `docs/AMADEUS_MODEL_CAPABILITY_ADAPTER_GOAL.md`, explicitly activated by the operator for this task. Work branch: `codex/model-capability-adapter-2026-09`, based on `origin/main` `5705e79ab62b65fc1ce114077e36569c756d2a68`.

Execute the Goal end-to-end: provision the 9Router-owned `amadeus-image` fallback capability using the existing management API boundary; point OpenClaw at that logical model; extend the existing voice-reply Skill for typed explicit voice requests and the pinned `tts.auto=tagged` semantics; narrowly admit `image_generate` for already-admitted supported group members; validate, release, deploy, and record rollback/real acceptance evidence. Preserve arthur-combo, ASR/TTS contracts, unrelated permissions, and all existing runtime/service boundaries. Do not modify 9Router source or expand into ASR/TTS combo work.

The `amadeus-image` Combo was idempotently provisioned with an external
minimal prestate rollback, and a real authenticated OpenClaw-network image
transport smoke succeeded through Gemini. Exact live 9Router helper tests
proved synthetic 429 fallback under the then Gemini-first order; no damaging live fault was
induced. OpenClaw **candidate** `0827daf` is now live on M204 with version 1.6.4
unchanged, logical `openai/amadeus-image`, tagged TTS, and narrowly
scoped group image policy. Read-only live policy projection passed; it is not
real group ingress acceptance. The prior image/config and 9Router prestate
are independently recoverable. See the dated Combo and candidate checkpoints.

Candidate release checkpoints are now created and verified at directory 0700
with config/manifests 0600; the deployment source creates these modes from the
outset. Validate the same on final release. 9Router and
native TTS PIDs were unchanged. On 2026-09-27 the owner amended the image priority to GPT Image 2.5 first,
Gemini 3.1 Flash Image second. The Goal, Git desired state, and live 9Router
Combo now agree on that order. A protected priority-only rollback snapshot
preceded the idempotent API reconcile; the fresh OpenClaw-network smoke
returned a valid PNG and logs showed GPT Image 2.5 succeed as backend 1/2.
The exact live Combo helper passed a synthetic GPT-429 → Gemini fallback
fixture without a second logical request. No 9Router/OpenClaw/native TTS
restart occurred. See
`.agent/checkpoints/2026-09-27-amadeus-image-gpt-first.md`; the earlier
Gemini-first candidate checkpoint remains historical evidence. The pinned 9Router helper treats upstream
HTTP 400 as fallback-eligible, whereas request-level missing-prompt 400 is
rejected before Combo dispatch; do not overclaim a general non-fallback
boundary or modify 9Router source. A real candidate transcript exposed an intermittent typed-to-voice bug where
TTS audio could be persisted without visible text. Commits `6c0840a`, `9f29a23`
and `0827daf` now preserve typed tagged TTS as a normal text+audio payload,
canonicalize visible output to exactly `中文：...` plus `日本語：...`, and upgrade
already-marked volume monitors. The patched candidate is deployed and its
in-container/runtime fixtures passed. Real owner re-test must still confirm
the exact bilingual text and single audio attachment. Real owner/non-owner group image and remaining three-way voice
acceptance remain pending, as do the single version bump,
final release, project-state closure, and Goal completion. The separate V2
TTS worktree remains untouched.

Production changes require a protected pre-apply checkpoint, explicit use of the existing release workflow, health/smoke verification, and rollback evidence. Do not record secrets or generated media payloads in Git. Goal completion remains contingent on every acceptance criterion in the Goal document, including real channel tests.
