# Amadeus 1.4.6

Operation Skuld Cutover Readiness — all preparation-only tooling and audit fixes for the upcoming Mac mini migration.

## Bug fixes

- **Immich remote checksum equivalence** (P0): Fixed `remote_equivalence` in `reclaim-immich-old-source.sh`; now fails immediately if rsync `--checksum --dry-run` reports any file-level transfer lines (`>f`, `<f`, `*c`, etc.), instead of silently counting lines. A passing run must have zero transfer lines.
- **Storage growth telemetry** (P0): Fixed shell-quoting bug in `storage-health.sh` where `'${MACHINE}'` was not expanded inside a single-quoted heredoc. Now passes `MACHINE` as `sys.argv[1]` so `du` is sent to the correct OrbStack machine.

## New: Operation Skuld Cutover Preparation Tooling

- `scripts/plan-destination-bootstrap.sh`: Destination bootstrap plan for Amadeus-M204 / nyannyan; outputs `DESTINATION_BOOTSTRAP_PLAN=ready`.
- `scripts/plan-clean-orbstack-guest.sh`: Clean OrbStack Ubuntu 24.04 guest creation plan (nyannyan machine, not import/export of source ubuntu machine).
- `scripts/plan-homelab-clean-restore.sh`: Service-by-service HomeLab restore plan; independent from old OrbStack guest snapshots.
- `scripts/skuld-state-machine.sh`: Operation Skuld phase state machine (phases 0-10 source-side; phases 11+ require separate authorization).
- `scripts/plan-skuld-rollback.sh`: Rollback plan describing how to reactivate source if destination fails.
- `scripts/pre-migration-gc.sh`: Safe pre-migration garbage cleanup (dangling images, excess project images, build cache age); never uses `docker volume prune` or `docker system prune -a --volumes`.
- `scripts/plan-destination-capacity.sh`: Destination 512 GB Mac mini SSD capacity plan with fit/warning/blocker judgment.

## Tests

- `scripts/test-skuld-preparation-tooling.sh`: Full fixture test of all preparation tooling.
- `scripts/test-immich-checksum-equivalence.sh`: Tests zero-changes enforcement for the Immich checksum bug fix.

## Destination identity

Destination: Amadeus-M204 / nyannyan (OrbStack machine: nyannyan, Ubuntu 24.04, no /Users/blacksidev active dependency). Migration manifest and runbook updated. Source remains unfrozen; no cutover executed.

## Readiness

`OPERATION_SKULD_SOURCE_READY=yes` · `MAC_MINI_CUTOVER=NOT_EXECUTED` · `IMMICH_SOURCE_RECLAIM=PENDING`
