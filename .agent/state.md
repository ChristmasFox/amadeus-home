# Agent state — 2026-10-01

Canonical status: `docs/PROJECT_STATE.md`. Current task pointer: `docs/CURRENT_TASK.md`.

Amadeus image lifecycle natural-persona messaging 1.7.5 is deployed and automatically verified from source commit `4e514a361becb9183b9208a5c8b764d5eb70c65d`. Production OpenClaw is healthy, runtime Amadeus version is 1.7.5, and Gateway Amadeus registration is present. Final release evidence and protected rollback checkpoint are in `.agent/checkpoints/2026-10-01-amadeus-image-persona-1.7.5-release.md`.

A previous applied 1.7.5 candidate was rolled back after a concrete operator-reported language/caption failure; the incident and rollback remain documented. Final manual owner-channel acceptance was explicitly waived and not performed. Use live Git/runtime state and checkpoints as evidence; do not infer additional manual acceptance or cross-restart exactly-once guarantees.
