# Current Task — Amadeus 1.8.2 native image completion semantics

Date: 2026-10-02 (Asia/Shanghai).

Active Goal: none; Amadeus 1.8.2 is deployed and verified.
Current live release: **Amadeus 1.8.2** (`VERSION=1.8.2`).
Deployment: source commit `76ece67` is pushed and live; release notes validated.
Status: `DEPLOYED_AUTOMATED_GATES_PASSED_NATIVE_IMAGE_COMPLETION_LIVE`.

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
