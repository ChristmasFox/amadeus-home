# Amadeus image generation lifecycle + Kurisu caption candidate — 2026-10-01

## Source and candidate runtime

- Lifecycle implementation commit: `1dd9dd25d8568db83ac1cf096f294a12fbbc110d`.
- Kurisu free-form caption prompt refinement commit: `628703c803e7`.
- Branch: `main`, pushed to `origin/main`.
- Amadeus version remains `1.7.4`; no release/version bump.
- Pinned OpenClaw: `2026.9.4`.
- Candidate image: `local/openclaw-amadeus:git-628703c803e7-20260930184906`.
- Image ID: `sha256:849311277404f7454adaaed3cbcdbf0678e4f92112adb2ff7cdfa8a4738a96f9` (ARM64).
- Host: OrbStack `nyannyan`; OpenClaw healthy, Amadeus registered after startup/restart.
- Previous live image before the style refinement candidate: `local/openclaw-amadeus:git-1dd9dd25d856-20260930183116`.

## Protected rollback and deployment evidence

- External checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930184906` (directory 0700; checkpoint manifest 0600; includes protected external copies; no secret contents are in Git).
- Pre-switch Compose image recorded by checkpoint: `local/openclaw-amadeus:git-1dd9dd25d856-20260930183116`.
- Content-safe deployment summary: `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260930184906/deployment-summary.md`.
- Candidate deployment via `scripts/deploy-openclaw.sh --apply --candidate --build-openclaw`; this was not a product release and did not bump VERSION.
- Deployment workflow passed OpenClaw and Product Radar health, Amadeus Gateway registration, NAS read-only smoke, and fixed owner outbox smoke/notification.
- `media-organizer-adapter` was absent before the deployment, was not restored, and its optional network check was skipped. It is unrelated to image generation.

## Source and validation

- Caption semantics use actual verified registry image bytes/path and current Kurisu persona; no fixed word-count target is prompted. Native `AttachmentPart.caption` remains bounded to the provider maximum (1024 characters), normalized, inline-image-only, and rejects protocol output.
- Valid caption goes through one WhatsApp native image send with caption; fallback remains deterministic when enrichment is unavailable/invalid. Failure/start are typed lifecycle notices.
- Exact pinned OpenClaw version/digest/AST contract and focused tests passed before image build; the deployment workflow repeated affected tests/typecheck/build/secrets checks.
- No `llm_input/historyMessages` recovery, media prose parsing, pending sender, second image sender, or independent caption text send was reintroduced.

## Owner gates still pending — do not claim Goal completion

Real WhatsApp owner gates A–F have **not** been executed. Deployment outbox notification is not image-generation Gate A. The available Codex computer-use inventory had no WhatsApp desktop app or accessible authenticated browser session, so no real owner-inbound image requests were sent.

- A: accepted acknowledgement exactly once — pending.
- B: successful image plus Kurisu caption in one native WhatsApp bubble — pending.
- C: caption error/timeout fallback still delivers exactly one image — focused source tests pass; real owner-channel gate pending.
- D: real generation failure produces exactly one safe user notice — focused source tests pass; real owner-channel gate pending.
- E: configured provider fallback success reaches WhatsApp with same-bubble caption — pending.
- F: real text/voice/upscale/default 2x/explicit 4x and post-restart lifecycle/upscale acceptance — runtime health and Amadeus registration passed; owner-channel flow checks pending.

The coordinator and delivery settlement remain bounded process-local state, not a durable cross-restart exactly-once journal. No stronger restart/replay claim is made.
