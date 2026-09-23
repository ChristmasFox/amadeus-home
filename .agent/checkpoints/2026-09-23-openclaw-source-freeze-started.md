# Amadeus 1.4.8 source freeze — execution started

Date: 2026-09-23
Goal: `docs/AMADEUS_1_4_8_OPERATION_SKULD_FINAL_CUTOVER_AND_MEMORY_CONTINUITY_GOAL.md`

The user supplied the exact source-freeze approval. Phase 7 is now authorized; this checkpoint records the start of that bounded phase. It does not authorize unmounting or physically moving Avalon, enabling destination OpenClaw/Product Radar, switching owner ingress, or committing the final cutover.

## Pre-freeze gates rechecked

- `scripts/migration-readiness.sh`: 0 failures, 0 warnings; `OPERATION_SKULD=READY`, `SOURCE_FROZEN=NO`, `DESTINATION_MUTATED=NO`, `MAC_MINI_CUTOVER=NOT_EXECUTED`.
- `scripts/doctor.sh`: 0 failures, 0 warnings.
- M204 CasaOS/Docker are active; six loopback-only staging services are running; destination OpenClaw and Product Radar are absent. 9Router unauthenticated `/v1/models` 401 is expected and non-blocking.
- Avalon is mounted on the source as APFS with the configured UUID; `.amadeus-storage.json` sentinel matches. The protected passphrase file exists with mode `600`; its value was not read or reported.
- Source OpenClaw and Product Radar are healthy and running before the freeze action. No destination production runtime or owner-ingress switch is authorized in this phase.
- Existing verified pre-freeze full HomeLab backup: `/Volumes/Avalon/backups/operation-skuld/full-homelab-backup-20260923T045305Z` (16/16 MIGRATE services; 22/22 checksums).

## Phase 7 execution order

The final secret bundle must precede the cold snapshot: the snapshot tooling authenticates and embeds the secret-bundle identity plus exact WhatsApp credential continuity into its manifest. OpenClaw will first be stopped; then the final bundle and cold snapshot will be created and verified. The final full HomeLab backup will run while Immich PostgreSQL and other source data services are still available; only after all final artifacts verify will remaining Avalon writers/consumers be stopped and the filesystem synced.

## Boundary

This is an in-progress checkpoint, not a completion claim. At phase completion, record artifact paths and sanitized verification results in a follow-up checkpoint. Stop with `SOURCE_FROZEN=YES` and `SAFE_TO_MOVE_AVALON=yes`; require the distinct Avalon-move approval before any unmount.
