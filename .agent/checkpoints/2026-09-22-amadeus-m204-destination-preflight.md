# Amadeus-M204 destination migration preflight

Date: 2026-09-22 (Asia/Shanghai)
Status: SOURCE READY / DESTINATION BOOTSTRAP PENDING — no restore or cutover

## Source readiness

`scripts/migration-readiness.sh` on the authority/source checkout passed with 0 failures and 0 warnings:

```text
OPERATION_SKULD=READY
OPERATION_SKULD_SOURCE_READY=yes
SOURCE_FROZEN=NO
MAC_MINI_CUTOVER=NOT_EXECUTED
IMMICH_SOURCE_RECLAIM=PENDING
```

## Target facts verified read-only

| Area | Result |
| --- | --- |
| Host | Amadeus-M204, Homebrew present, clean monorepo present and clean at `bc40402` |
| Host missing dependencies | Node, pnpm; Python is system 3.9.6 |
| OrbStack guest | Canonical `nyannyan` guest running, Ubuntu 24.04.5/noble arm64 |
| Guest privilege | `orb -m nyannyan -u root id -u` returns `0` |
| Guest runtime | Docker and Docker Compose missing; `/DATA/AppData` absent |
| External storage | `/Volumes/Avalon` absent |

## Decision

The project may begin the **destination bootstrap** phase after an explicit apply decision. It is not eligible
for secret/data restore, CasaOS application startup, inbound/channel routing changes, source freeze, Avalon
media movement, or cutover until dependencies, clean guest Docker/CasaOS, and Avalon identity preflight all
pass.

## Ordered bootstrap gate

1. Install Node 24, pnpm, Python 3.11+ on the host and run clean-repo bootstrap check.
2. Apply only non-secret host profile declaration.
3. Install Docker/CasaOS in guest `nyannyan`; verify Docker, Compose and `/DATA/AppData`.
4. Attach Avalon and pass its identity/capacity preflight.
5. Start the separate secret/data restore preflight; do not apply the restore yet.
