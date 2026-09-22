# Amadeus-M204 canonical OrbStack guest verified

Date: 2026-09-22 (Asia/Shanghai)
Status: CLEAN GUEST IDENTITY VERIFIED — restore/deploy/cutover remain unexecuted

## Verified access

- SSH access to the target host continues to work through `amadeus-m204` as `nyannyan`.
- Orb CLI is available at `/usr/local/bin/orb`; the noninteractive SSH default `PATH` omission is known.
- `orb list` currently reports only a running guest named `nyannyan` (Ubuntu noble / arm64).

## Identity and privilege probes

| Probe | Result |
| --- | --- |
| `orb -m nyannyan hostname` | `nyannyan` |
| `orb -m nyannyan id -un` | `nyannyan` |
| `orb -m nyannyan id -u` | `501` |
| `orb -m nyannyan -u root id -u` | `0` |
| Guest home | `/home/nyannyan` exists and is owned by `nyannyan` |
| Guest release | Ubuntu 24.04.5 LTS / noble |

This matches the tracked Operation Skuld destination contract: macOS user `nyannyan`, OrbStack machine
`nyannyan`, Linux user/home `nyannyan` / `/home/nyannyan`, and Ubuntu 24.04 LTS.

## Explicit non-actions

No repository copy, host-profile write, secret/data restoration, Avalon attachment, CasaOS installation,
container/image build, OpenClaw startup, channel reroute, source freeze, or cutover was performed. The old
Mac CasaOS runtime remains the sole authoritative runtime.

## Next gate

Host bootstrap dependencies and a clean monorepo must be installed/restored before the separate secret/data
restore and CasaOS deployment preflights can begin. The existence of the guest is not authorization to run a
second runtime.
