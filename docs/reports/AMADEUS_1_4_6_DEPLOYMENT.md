# Amadeus 1.4.6 — Operation Skuld Cutover Readiness deployment evidence

Date: 2026-09-22 (Asia/Shanghai)

## Final state

```text
VERSION=1.4.6
OPERATION_SKULD=READY
OPERATION_SKULD_SOURCE_READY=yes
DESTINATION_HOST_IDENTITY=Amadeus-M204
DESTINATION_MACOS_USER=nyannyan
DESTINATION_ORBSTACK_MACHINE=nyannyan
DESTINATION_LINUX_USER=nyannyan
SOURCE_FROZEN=NO
DESTINATION_MUTATED=NO
MAC_MINI_CUTOVER=NOT_EXECUTED
IMMICH_SOURCE_RECLAIM=PENDING
```

This release preserves the Operation Skuld safety boundary: no Mac mini cutover, no deletion of
`/DATA/Gallery/immich`, no secret rotation, no generic Docker volume/system prune, and no deletion
of unknown AppData or log owners. The destination (Amadeus-M204 / nyannyan) was not mutated or
SSHed into.

## Git and release

- Release commit: `5baad95` (release: Amadeus 1.4.6 — Operation Skuld Cutover Readiness).
- Worktree was clean at final live acceptance.
- `scripts/amadeus-version.sh check` passed; release notes contain only 1.4.6 body.

## Bug fixes

### P0: Immich remote checksum equivalence

**Bug**: `remote_equivalence` in `scripts/reclaim-immich-old-source.sh` used rsync `--checksum --dry-run`
but only counted non-summary lines, never checking whether any file-level transfer was reported.
A corrupted or missing destination file would return `filesReported > 0` but not fail.

**Fix**: Now extracts lines starting with `>`, `<`, `c`, `h`, or `*` (rsync "transfer" indicators).
If any such line exists, the function raises an explicit `SystemExit` with the first discrepancy.
A passing run must have zero transfer lines and returns `filesChecked`, `transferLines: 0`,
`equivalenceResult: 'passed'`.

**Evidence**: `scripts/test-immich-checksum-equivalence.sh` — 5 tests pass:
- Identical files: pass
- Corrupted destination file: fail (correctly)
- Missing destination file: fail (correctly)
- Fix present in source code: pass
- Telemetry fix present: pass

### P0: Storage growth telemetry

**Bug**: `scripts/storage-health.sh` embedded a Python heredoc with `'${MACHINE}'` as a string
literal inside single-quoted `<<'PY'`. Shell expansion is suppressed inside single-quoted heredocs,
so `orb` always tried to connect to a machine literally named `'${MACHINE}'`.

**Fix**: Python script now takes `MACHINE` as `sys.argv[1]` (passed from the shell before
the heredoc delimiter). The variable is expanded by the shell when setting up the command,
not inside the heredoc.

## New preparation tooling

All scripts are plan-only (no live mutation of destination):

| Script | Output | Passes bash -n |
|---|---|---|
| `plan-destination-bootstrap.sh` | `DESTINATION_BOOTSTRAP_PLAN=ready` | ✅ |
| `plan-clean-orbstack-guest.sh` | `CLEAN_GUEST_CREATION_PLAN=ready` | ✅ |
| `plan-homelab-clean-restore.sh` | `HOMELAB_CLEAN_RESTORE_PLAN=ready` | ✅ |
| `skuld-state-machine.sh` | `SKULD_STATE=valid` | ✅ |
| `plan-skuld-rollback.sh` | `ROLLBACK_PLAN=ready` | ✅ |
| `pre-migration-gc.sh` | `PRE_MIGRATION_GC=plan-ready` | ✅ |
| `plan-destination-capacity.sh` | `DESTINATION_CAPACITY_JUDGMENT=FIT` | ✅ |

## Destination identity evidence

All planning scripts output:
```text
HOST_IDENTITY=Amadeus-M204
DESTINATION_MACOS_USER=nyannyan
DESTINATION_ORBSTACK_MACHINE=nyannyan
DESTINATION_LINUX_USER=nyannyan
DESTINATION_STRATEGY=clean-orbstack-ubuntu-guest
```

No `/Users/blacksidev` or `/home/blacksidev` paths appear as active destination production
dependencies in any planning script.

## Capacity planning

Fixture test with realistic source measurements:
```text
Destination SSD: 480.0 GB (512 GB nominal)
TOTAL REQUIRED:  ~197 GB (macOS + OrbStack + pnpm + monorepo + buffer)
REMAINING:       ~283 GB
DESTINATION_CAPACITY_JUDGMENT=FIT
Avalon: NOT on destination SSD — physical move only
```

## Safe pre-migration GC plan

Live plan (no apply):
```text
GC_DANGLING_IMAGES=4
GC_EXCESS_PROJECT_IMAGES=41
GC_VOLUMES_PRUNED=0 (never — explicit policy)
GC_SYSTEM_PRUNE=never (explicit policy)
```

## Canonical live deployment

- Host: CasaOS inside OrbStack Linux machine `ubuntu`.
- Live checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260922120543`.
- External deployment evidence: `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260922120543`.
- OpenClaw: `local/openclaw-amadeus:git-5baad9571dfc-20260922120543`.
- Product Radar: `local/product-radar:git-16a8c15d727f-20260921082428` (reused).
- `doctor.sh`: `0 failure(s), 0 warning(s)`.
- `migration-readiness.sh`: 28 checks passed; `OPERATION_SKULD=READY`.
- New 1.4.6 checks: `destination identity`, `preparation tooling`, `Immich checksum fix`, `storage telemetry fix` — all PASS.
- Full pnpm test suite: 52 product-radar + 18 amadeus + 23 pubg-domain + 9 pubg-plugin + 10 agent-runtime + 8 identity tests = 120 total; 0 failures.
- `pnpm typecheck`: pass. `pnpm build`: pass. `pnpm check:secrets`: pass.
- Fresh clone rehearsal: `FRESH_CLONE_REHEARSAL=fixture-passed`.

## Immich

- Live media root: `/Volumes/Avalon/immich/data` (unchanged).
- Legacy source `/DATA/Gallery/immich` retained; `SOURCE_RECLAIM_PENDING`.
- `IMMICH_SOURCE_RECLAIM=PENDING`.

## What was not done

- Mac mini cutover: NOT EXECUTED.
- Destination SSH/mutation: NO.
- Source freeze: NO.
- Immich source reclaim: PENDING.
- Second OpenClaw runtime: NO.
- Old OrbStack machine import/export: NO.
