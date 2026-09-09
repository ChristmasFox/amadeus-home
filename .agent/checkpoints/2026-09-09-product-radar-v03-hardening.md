# Product Radar V0.3 Phase A hardening release checkpoint

Date: 2026-09-09 (Asia/Shanghai)
Status: deployed; verified

## Scope

- Reused the existing normalized-message, Luna intent, structured-command,
  ownership-context, and deterministic Product Radar Core boundaries.
- Added user-vs-provider search-term provenance and layered Bunjang planning
  with a four-query upper bound.
- Made shared-feed discovery atomic across pagination and parse/fetch failures.
- Propagated Retry-After, enforced backoff, preserved shared sensor ownership,
  and made preview output identify Sharp and the actual threshold.

## Verification

- `pnpm --filter @agent/product-radar test`: 42/42
- `pnpm --filter @agent/product-radar typecheck`: passed
- `pnpm --filter @agent/product-radar build`: passed
- LangBot Product Radar Python tests: 16/16
- Python compile: passed
- `pnpm check:secrets`: passed
- `pnpm workflow:plan`: RUNTIME / PRODUCT_RADAR
- `git diff --check`: passed

## Release evidence

- Source commit `0cdba7c37a6a09a0740eedabd17b9adabb511682` was pushed to
  `origin/main`.
- Built and loaded `local/product-radar:git-0cdba7c37a6a`; runtime image digest
  is `sha256:ef5c7309eae244cd6c9c2ef9d566f4f4e7a27f9d72474a93bde355dd3f1bb7db`.
- CasaOS `/var/lib/casaos/apps/product-radar` was backed up as
  `.codex-backup.20260909-114724` and `.env.codex-backup.20260909-114724`; the
  external `PRODUCT_RADAR_IMAGE` was updated and `docker compose up -d
  --no-build` recreated only Product Radar. changedetection `0.60.3` remained
  healthy with its persistent datastore.
- Product Radar `/health` returned `status=ok`; database remained at 3 watches,
  2 search feeds, 2663 listings, 1454 feed listing events, and 0 notification
  outbox entries. `GET /api/watches` preserved the existing 1 Product and 2
  Similarity watches.
- LangBot plugin `local/product-radar` version `0.4.1` reached `INSTALL_READY`
  in task `84`; package SHA-256 is
  `09d0783fbe072999bf0b8f10a48c9b09adbcb6fc8f73e881cfa08ea7c33c90f3`, with
  rollback dir `.backups/langbot/20260909-114754`.
- `scripts/doctor.sh` returned 0 failures and 0 warnings. No real Telegram/KOOK
  test notification was sent.
