# Amadeus 1.5.2

Expose measured macOS SoC power telemetry through the owner-only host status tool.

- Add a root-owned powermetrics sampler with atomic, fresh snapshots.
- Report CPU, GPU, ANE, SoC milliwatts, watts, sample duration, scope, and accuracy metadata.
- Keep the user HTTP agent bounded and degrade explicitly when privileged samples are missing or stale.
