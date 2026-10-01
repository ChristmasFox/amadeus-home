# Agent state — 2026-10-01

Canonical status: `docs/PROJECT_STATE.md`. Active Goal and halt condition: `docs/CURRENT_TASK.md` and `docs/AMADEUS_IMAGE_LIFECYCLE_NATURAL_PERSONA_MESSAGING_GOAL.md`.

Amadeus 1.7.5 source commit `a242570` and permission correction `431d90f` are pushed. The first immutable candidate failed pre-switch runtime-version readability validation; that exact candidate remains rejected and will not be reused. The source now makes the marker readable by the runtime user and preserves mode 0644 on version bumps. Production remains 1.7.4, healthy and registered, until a distinct candidate passes all gates. Evidence is in `.agent/checkpoints/2026-10-01-amadeus-image-persona-1.7.5-candidate-preflight-failed.md`.

Historical runtime evidence remains in `.agent/checkpoints/`; use live Git and runtime state as authoritative.
