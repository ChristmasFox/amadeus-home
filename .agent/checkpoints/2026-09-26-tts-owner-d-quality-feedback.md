# Phase 4/5 owner quality feedback — 2026-09-26

- Owner reports that experimental short-reference profile D loses some of the intended Kurisu voice character/feeling. The message did not identify the backend or individual sample, so do not attribute the change specifically to MPS or MLX.
- Decision: D (~4.55s cropped reference) is **not eligible for production selection** on speed alone. Keep the current ~46s A reference in production. This does not by itself judge C (~8.15s), E x-vector-only, or MLX using A; those remain unaccepted until explicitly heard and confirmed.
- No profile, model, language, timeout, voice files, or live API config were changed in response. The launchd Interactive candidate still uses the current A/MPS/Auto voice. External private listening samples and rollback checkpoints remain untouched.
- Next quality comparison, if owner wishes: A/MPS vs C/MPS on the same Japanese normal fixture to isolate reference length; A/MPS vs A/MLX to isolate backend. Reject any candidate whose likeness or Japanese naturalness is worse despite faster timing.
