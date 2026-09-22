# Amadeus-M204 Git SSH clone verified

Date: 2026-09-22 (Asia/Shanghai)
Status: CLEAN MONOREPO CLONED — host bootstrap continues

## Authorization boundary

The user explicitly authorized use of the dedicated target-local ED25519 key as a GitHub account-level
Authentication key. This is broader than a repository Deploy key, but it was an explicit owner decision.
The control-side Git private keys and any GitHub token were not copied to the target.

## Verification and clone

- `git ls-remote git@github-amadeus:ChristmasFox/amadeus-home.git HEAD` succeeded and returned the
  then-current source HEAD `74eced4b6b328de652ee71baea10e2daf795d9fe`.
- Cloned the repository to `/Users/nyannyan/agent-monorepo`.
- Target origin is `git@github-amadeus:ChristmasFox/amadeus-home.git`, ensuring the clone uses the
  dedicated target-local key rather than an implicit personal/default identity.
- Clone verification: branch `main`, HEAD `74eced4b6b328de652ee71baea10e2daf795d9fe`, and clean status.

## Explicit non-actions

No secrets, `.env` files, runtime state, media, AppData, CasaOS definition, container image, or source-side
key/token was copied. No service was started and no cutover action occurred.

## Next gate

Install/verify host bootstrap dependencies and restore only non-secret host declaration in the cloned
repository before beginning any separate secret/data restore preflight.
