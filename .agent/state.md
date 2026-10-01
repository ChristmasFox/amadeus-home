# Agent state — 2026-10-01

Canonical status: `docs/PROJECT_STATE.md`. Active Goal and halt condition: `docs/CURRENT_TASK.md` and `docs/AMADEUS_IMAGE_LIFECYCLE_NATURAL_PERSONA_MESSAGING_GOAL.md`.

Amadeus 1.7.5 source was applied once, then automatically rolled back after the operator reported wrong-language accepted text and image-only success delivery. The current production source is healthy and registered at 1.7.4 (`628703c803e7`). Active source fixes enforce request language and retry one transient caption-provider error within the shared 30-second budget; those changes still require a fresh candidate and all hard gates. Evidence: `.agent/checkpoints/2026-10-01-amadeus-image-persona-1.7.5-postapply-symptom-rollback.md`.

Historical runtime evidence remains in `.agent/checkpoints/`; use live Git and runtime state as authoritative.
