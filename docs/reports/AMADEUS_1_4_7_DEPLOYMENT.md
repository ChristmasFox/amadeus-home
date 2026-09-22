# Amadeus 1.4.7 — Operation Skuld Final Migration Blocker Fixes Deployment Report

Date: 2026-09-22
Version: `1.4.7`
Commit: `901a9ca`
Target host: Canonical old Mac (OrbStack machine `ubuntu` / CasaOS)
Goal: `docs/AMADEUS_1_4_7_OPERATION_SKULD_FINAL_MIGRATION_BLOCKER_FIXES_GOAL.md`

## Final State Verification

- `VERSION`: `1.4.7`
- `OPERATION_SKULD_SOURCE_READY`: `yes`
- `FULL_HOMELAB_BACKUP_READY`: `yes`
- `FULL_HOMELAB_ARTIFACT_MANIFEST`: `verified`
- `SENSITIVE_STATE_COVERAGE`: `complete-for-live-services`
- `SECRET_RESTORE_PATH`: `verified`
- `SERVICE_INVENTORY_CONTRACT_GATE`: `passed`
- `SKULD_STATE_MACHINE_GATES`: `verified`
- `PROTECTED_IMAGE_SET`: `verified`
- `DESTINATION_CAPACITY_MODEL`: `verified`
- `MIGRATION_TESTS_IN_RELEASE_GATE`: `yes`
- `RELEASE_EVIDENCE_TRACEABLE`: `yes`
- `DESTINATION_HOST_IDENTITY`: `Amadeus-M204`
- `DESTINATION_MACOS_USER`: `nyannyan`
- `DESTINATION_ORBSTACK_MACHINE`: `nyannyan`
- `DESTINATION_LINUX_USER`: `nyannyan`
- `SOURCE_FROZEN`: `NO`
- `DESTINATION_MUTATED`: `NO`
- `IMMICH_SOURCE_RECLAIM`: `PENDING`
- `MAC_MINI_CUTOVER`: `NOT_EXECUTED`

## Blocker Fix Summary

1. **Full HomeLab backup artifacts**: Implemented `scripts/full-homelab-backup.sh` with concrete artifact and checksum generation for all 16 MIGRATE services. Verified that Avalon bulk media/downloads use `external-reference-only` policy and are not archived.
2. **Secret coverage**: Extended encrypted Skuld secret bundle coverage to all live credential-bearing state without logging or exposing secret values.
3. **Secret restore path**: Implemented `scripts/restore-skuld-secrets.sh` mapping logical secret IDs to clean destination target paths (`/Users/nyannyan` / `/home/nyannyan` / `/DATA/AppData/<app>`). Includes `--dry-run` default, path safety validation, permission enforcement, and `--approve-replace` gating.
4. **Service inventory observation vs contract**: Refactored `scripts/service-inventory.sh` with `--observe` (safe external/temp output only) and `--compare` modes. Overwriting tracked docs is prohibited. Live services missing from contract become `MANUAL_BLOCKER`; missing live runtime services become `WARNING`.
5. **State machine gate verifiers**: Updated `scripts/skuld-state-machine.sh` with explicit Python gate verifier functions (`GATE_VERIFIERS`) executed prior to advancing each phase (0-10). Phases 11+ remain strictly locked.
6. **Protected Docker image set**: Hardened `scripts/pre-migration-gc.sh` with real protected image set built from running images, exact 9Router image, current/previous release images, rollback tags, and checkpoint-referenced images.
7. **Destination capacity calculation**: Corrected `scripts/plan-destination-capacity.sh` model to `guest_required = max(configured_floor, measured_requirement + 20% margin + 10G)`. Docker/AppData are not double-counted, and Avalon external disk is excluded from internal SSD calculations.
8. **Migration tests in release gate**: Wired `test:migration-blockers` into `pnpm test` script in `package.json`. All 25 blocker tests execute in normal test runs.
9. **Release/evidence reproducibility**: Verified Git commit traceability (`901a9ca` on clean `main`). Unnecessary image rebuilds avoided.
10. **Final migration artifact proof**: Implemented `scripts/generate-skuld-artifact-report.sh` producing sanitized markdown (`AMADEUS_1_4_7_ARTIFACT_REPORT.md`) and JSON reports with verified recovery status for all MIGRATE services.
11. **Documentation path consistency**: Fixed `/home/nyannyan` path label in `docs/OPERATION_SKULD_SERVICE_INVENTORY.md` to Linux guest.
12. **Clean destination strategy preserved**: Maintained clean destination identity (Amadeus-M204 / nyannyan) without guest import/export or live destination mutation.

## Test Results

- `./scripts/check-secrets.sh`: `Secret scan passed`
- `./scripts/migration-readiness.sh`: `0 failure(s), 0 warning(s)`, `OPERATION_SKULD=READY`
- `pnpm test`: All tests passed (architecture, migration readiness, storage runtime, service-aware backup, skuld consistency, migration blockers, notify owner, identity, presentation, pubg-domain, pubg-plugin, amadeus-plugin, product-radar).
- `pnpm build` & `pnpm typecheck`: Passed.
- `pnpm doctor`: `All checks passed`.
