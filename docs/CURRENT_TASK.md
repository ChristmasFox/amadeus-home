# Current Task — Amadeus 1.7.6 delivery-boundary repair

Date: 2026-10-01 (Asia/Shanghai).

Active Goal: none.
Previous completed Goal: `docs/AMADEUS_IMAGE_LIFECYCLE_NATURAL_PERSONA_MESSAGING_GOAL.md` (1.7.5).
Target release: **Amadeus 1.7.6**.
Status: `LOCAL_GATES_PASSED_AWAITING_COMMIT_PUSH_DEPLOY`.

A live read-only audit found CasaOS was actually running the healthy 1.7.4 rollback
image `local/openclaw-amadeus:git-628703c803e7-20260930184906`, not the 1.7.5
image recorded by the prior task pointer. The 1.7.6 source closes the pinned
WhatsApp final-delivery bypass by repeating strict typed preparation inside
`delivery.deliver()`, and preserves trusted heartbeat/cron/internal origin for
unsettled runs. This prevents legacy modality text or malformed raw output from
reaching the visible sender. It also includes the single-image-call follow-up
Skill guard and request-language telemetry.

Focused delivery tests (83 plus the pinned native integration), the full Amadeus
suite (117), typecheck, build, architecture/architecture-fixture checks, version
validation, secrets scan, and `git diff --check` pass. The deploy workflow dry-run
identifies OpenClaw as affected and Product Radar as reuse-only. Deployment is
explicitly requested by the operator and remains pending protected checkpoint,
immutable build, CasaOS switch, health/smoke, and rollback evidence.
