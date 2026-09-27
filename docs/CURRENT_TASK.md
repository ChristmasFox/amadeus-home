# Current Task — Amadeus Model Capability Adapter

Date: 2026-09-27 local. Active Goal: `docs/AMADEUS_MODEL_CAPABILITY_ADAPTER_GOAL.md`, explicitly activated by the operator for this task. Work branch: `codex/model-capability-adapter-2026-09`, based on `origin/main` `5705e79ab62b65fc1ce114077e36569c756d2a68`.

Execute the Goal end-to-end: provision the 9Router-owned `amadeus-image` fallback capability using the existing management API boundary; point OpenClaw at that logical model; extend the existing voice-reply Skill for typed explicit voice requests and the pinned `tts.auto=tagged` semantics; narrowly admit `image_generate` for already-admitted supported group members; validate, release, deploy, and record rollback/real acceptance evidence. Preserve arthur-combo, ASR/TTS contracts, unrelated permissions, and all existing runtime/service boundaries. Do not modify 9Router source or expand into ASR/TTS combo work.

The `amadeus-image` Combo is idempotently provisioned through the existing
9Router management API with protected prestate/priority rollback files. The
live order is GPT Image 2.5 → Gemini 3.1 Flash Image; a real GPT-first
OpenClaw-network smoke and exact-path synthetic fallback fixture passed.
OpenClaw candidate `0827daf` was deployed with tagged TTS and scoped group
image policy, then the typed-voice visible-text and exact bilingual-format
fixes (`6c0840a`, `9f29a23`, `0827daf`) were applied and the candidate was
redeployed as `git-0827dafec807-20260927140017`. The live WhatsApp monitor was
upgraded despite its existing patch marker. Runtime fixtures and full focused
verification pass; 9Router/native TTS were not restarted.

The owner has confirmed the repaired real behavior: typed voice replies now
use the required `中文：...` / `日本語：...` visible format with one audio reply.
This closes the candidate acceptance disposition together with the owner's
prior no-issue image/group testing. The single 1.6.5 version bump, final
release build/apply, owner notification, protected release evidence and final
Goal/project-state closure are the remaining steps. The known pinned 9Router
caveat remains: upstream HTTP 400 is fallback-eligible, while missing-prompt
400 is rejected before Combo dispatch; no 9Router source change is allowed.
The separate V2 TTS worktree remains untouched.

Production changes require a protected pre-apply checkpoint, explicit use of the existing release workflow, health/smoke verification, and rollback evidence. Do not record secrets or generated media payloads in Git. Goal completion remains contingent on every acceptance criterion in the Goal document, including real channel tests.
