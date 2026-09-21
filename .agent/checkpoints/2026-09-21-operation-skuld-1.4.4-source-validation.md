# Operation Skuld 1.4.4 source validation checkpoint

- Date: 2026-09-21 Asia/Shanghai
- Scope: source, tests, documentation and release preparation only
- External media source was not modified; no disk format/repartition and no `rsync --delete`
- Immich migration now uses checksum-aware resumable copy, equivalence checks, fresh PostgreSQL
  backup at cutover, and a separate source-reclaim gate
- Docker cleanup is limited to bounded logs, dangling images and build cache; volumes, databases,
  secrets, current/previous/rollback images and unknown paths remain protected/report-only
- Validation passed: `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check:secrets`,
  architecture fixture/check, migration-readiness, storage-runtime, notification tests, and
  changed-script `bash -n`
- Next checkpoint: after commit/push and before live writes, verify external volume identity,
  create the external backup and encrypted secret bundle, then run the copy-first migration plan
