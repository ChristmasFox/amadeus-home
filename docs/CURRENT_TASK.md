# Current Task — Amadeus 1.6.2 Stability Cleanup

Date: 2026-09-26 UTC / 2026-09-27 CST. Active Goal: `docs/AMADEUS_1_6_2_STABILITY_CLEANUP_GOAL.md`. Follow its phases in order from canonical `main`; the previous Post-Voice performance Goal is complete, and its cancelled B tests must not be resumed. This is a source-of-truth and operational stability release, not a TTS performance experiment. Keep accepted A / MLX 1.7B 8-bit / Auto / Interactive and all timeouts, output limits and memory/queue behavior unchanged.

The released baseline is 1.6.1. Work is on short-lived `work/amadeus-1.6.2-stability-cleanup`; runtime and rollback facts remain in `docs/PROJECT_STATE.md` and dated checkpoints. No runtime apply until source gates and protected rollback are ready.
