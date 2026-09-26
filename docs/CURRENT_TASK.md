# Current Task — Stable Amadeus 1.6.2

Date: 2026-09-26 UTC. No active product/engineering Goal. `docs/AMADEUS_1_6_2_STABILITY_CLEANUP_GOAL.md` is complete release history, not a standing instruction. The earlier Post-Voice performance Goal is also complete, with further B reference tests explicitly cancelled.

Canonical source is Git `main`; native Mac TTS remains the single accepted A (~46s) / community MLX 1.7B Base 8-bit / Auto / Interactive service. The 1.6.2 stability cleanup changed only current-task wording, MLX terminology, and bounded launchd startup diagnostics; port 18792 still binds broadly for OrbStack/9Router, with Bearer auth on speech and voice inventory. No new model, reference, timeout, output-length limit or stress policy was introduced.

Protected rollback and real WhatsApp voice/typed acceptance evidence are in `.agent/checkpoints/2026-09-26-amadeus-1.6.2-stability-release.md`. Routine watch: actual memory pressure and TTS health; do not resume deferred capacity experiments without a separate Goal.
