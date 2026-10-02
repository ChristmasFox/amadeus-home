# Current Task — Amadeus native image completion caption

Date: 2026-10-02 (Asia/Shanghai).

Active Goal: `docs/AMADEUS_NATIVE_IMAGE_COMPLETION_CAPTION_GOAL.md`.
Current live release: **Amadeus 1.8.2** (`VERSION=1.8.2`).
Candidate work is in progress for the native Completion Agent caption path;
the release is not complete until one real ordinary WhatsApp image generation
proves one image bubble with the Completion Agent caption.
Status: `IMPLEMENTATION_LOCAL_GATES_PASSED_CANDIDATE_PENDING_REAL_ACCEPTANCE`.

The 1.8.2 immutable image is live:
`local/openclaw-amadeus:git-76ece6705ee5-20261002065812` (image ID
`sha256:c86e41c4d2bdddd9dfb7c70a7b31d3a261bb851efce54571737103d3efda4ea3`).
OpenClaw is healthy with zero restarts, Gateway registration is present, and
Product Radar reuses its unchanged healthy image.

Ordinary successful `image_generate` keeps the trusted generated attachment,
Asset Registry, DeliveryEnvelope, 9Router image route, and one image send. The
completion hook no longer returns before native `task_completion`; it removes
native media primitives and allows Completion Agent continuation plus native
task state settlement to run. Voice/TTS/ASR, normal text, upscale/document,
reference-image routing, and other DeliveryEnvelope paths were not changed.

The release gates passed: 124 Amadeus tests, pinned native image-route tests,
build/typecheck, secrets scan, plugin/config/skill preflight, OpenClaw and
Product Radar health, Gateway registration, NAS read-only smoke, owner
notification/outbox smoke, and post-deploy maintenance. The optional media
adapter was absent, so its network smoke was skipped. Managed Compose log
policies passed; host Docker default log policy remains a warning because
`/etc/docker/daemon.json` is absent.

Deployment checkpoint/evidence:
`.agent/checkpoints/2026-10-02-amadeus-1.8.2-native-image-completion-release.md`.

Protected rollback checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20261002065812`.
