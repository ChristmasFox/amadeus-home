# Product Radar V0.3 Phase A hardening source checkpoint

Date: 2026-09-09 (Asia/Shanghai)
Status: source complete; release pending

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
- `pnpm workflow:plan`: RUNTIME / PRODUCT_RADAR; Docker release intentionally
  remains pending until the source commit is pushed.

## Release handoff

Build an immutable `local/product-radar:git-<12-char-commit>` with host
BuildKit, transfer it to OrbStack `ubuntu`, update only
`/var/lib/casaos/apps/product-radar/docker-compose.yml`, recreate with
`docker compose up -d --no-build`, install plugin manifest `0.4.1`, and verify
health plus existing Watch/feed invariants. Do not send real Telegram/KOOK
test notifications.
