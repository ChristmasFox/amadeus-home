# Amadeus-M204 OrbStack access correction

Date: 2026-09-22 (UTC probe time)
Status: READ-ONLY VERIFIED — guest identity mismatch remains pending

## Correction to the initial CLI observation

The earlier `command -v orb` check ran through a noninteractive SSH shell whose `PATH` was limited to
`/usr/bin:/bin:/usr/sbin:/sbin`. It did not include `/usr/local/bin`; therefore, its `ORB_CLI=missing`
result was a PATH-scoped false negative rather than proof that OrbStack was absent.

## Verified target facts

- Orb CLI exists at `/usr/local/bin/orb`.
- `orb list` reports a running `ubuntu` guest on noble / arm64.
- `orb -m ubuntu uname -srm` succeeds.
- `orb -m ubuntu id -u` returns the regular guest user UID, and `orb -m ubuntu -u root id -u` returns `0`.
- `ubuntu.orb.local` resolves locally on Amadeus-M204.

## Migration boundary

The tracked Operation Skuld destination contract requires a clean Ubuntu 24.04 guest named `nyannyan`.
The observed running guest is named `ubuntu`, so it is not a canonical target runtime, must not be used as
a compatibility fallback, and must not receive restored secrets/data or a CasaOS deployment. No guest was
created, changed, stopped, imported, or deleted by this validation.

## Next action

Complete host bootstrap, then create and validate the contract-required clean `nyannyan` guest before any
migration restore or deployment phase. Retain the existing `ubuntu` guest for read-only inspection unless
the user later explicitly authorizes a destructive lifecycle action.
