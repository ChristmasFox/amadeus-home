# Agent state — 2026-10-01

Canonical status: `docs/PROJECT_STATE.md`. Active Goal and rollback state: `docs/CURRENT_TASK.md` and `docs/AMADEUS_IMAGE_LIFECYCLE_NATURAL_PERSONA_MESSAGING_GOAL.md`.

The final audit found pinned OpenClaw's lifecycle `taskLabel` is model-produced `request.prompt`, not the original inbound user message. Candidate `4e514a3` has been rolled back. Production is healthy and registered on source `628703c803e7` / Amadeus 1.7.4. Source commits `2e60797` and `d8442d6` capture bounded inbound message text at `before_dispatch` and derive a separate requestLanguage for lifecycle/caption semantics; these changes are pushed but undeployed. Evidence: `.agent/checkpoints/2026-10-01-amadeus-image-persona-1.7.5-original-request-context-rollback.md`.
