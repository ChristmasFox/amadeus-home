# Version progression policy checkpoint

- Date: 2026-09-20
- Request: future Amadeus releases advance by `0.0.1`; remove separate `0.1` minor bumps.
- Current release: `1.4.0` remains unchanged; next release is `1.4.1`.

## Policy

- Only `scripts/amadeus-version.sh bump patch` is supported.
- `0.0.8 -> 0.0.9`.
- `0.0.9 -> 0.1.0`.
- `0.9.9 -> 1.0.0`.
- `bump minor` and `bump major` fail with an explicit error.

## Scope

- Updated the version script, regression test, README, root agent rules, convergence goal,
  current task/state records, and this checkpoint.
- No runtime image or CasaOS deployment was changed; the live image already matches `1.4.0`.
