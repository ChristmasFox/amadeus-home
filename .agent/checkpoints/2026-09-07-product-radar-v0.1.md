# Product Radar V0.1 checkpoint — 2026-09-07

Implementation commits: `83c3557`, `ed394e9`.

## Scope

Implemented the standalone generic Seller Watch / Product Watch runtime under
`apps/product-radar`. The core does not import Bunjang concepts, changedetection
objects, or Telegram/KOOK APIs.

## Durable state

SQLite schema is defined in `apps/product-radar/src/storage/sqlite.ts`:

- `watches`
- `listings`
- `watch_seen_listings`
- `product_snapshots`
- `sensor_watches`
- `events`
- `notification_outbox`
- `poll_runs`

The unique keys cover `(source, external_id)`, watch-specific seen listings,
`(watch_id, trigger_key)`, event keys, and channel outbox delivery.

## Verification

- Product Radar TypeScript typecheck: passed.
- Product Radar TypeScript build: passed.
- Product Radar tests: 21 passed.
- Product Radar plugin tests: 3 passed.
- `pnpm check:secrets`: passed.
- LangBot plugin dry-run packaging: passed.
- Local Product Radar process/API smoke: `/api/sources` 200; `/health` degraded/503 only because changedetection was intentionally not running.
- Compose syntax: local and CasaOS template passed (`CHANGEDETECTION_API_KEY=placeholder` was used only for interpolation; no secret was stored).

## Bunjang source smoke — 2026-09-07

- Product URL: `https://m.bunjang.co.kr/products/418123655`
  - normalized title: `[XL] Chrom Hearts 크롬하츠 매티보이 99eyes 후드`
  - price: `KRW 1400000`
  - status: `ACTIVE`
  - image count: `2`
  - seller: `4771473 / 기미히끼잉잉`
  - snapshot baseline persisted; baseline notifications: `0`
- Seller URL: `https://m.bunjang.co.kr/shops/4771473/products`
  - public shop search endpoint returned 5 current listings.
  - seller baseline persisted; baseline notifications: `0`.
  - no login, CAPTCHA bypass, proxy pool, or anti-bot workaround was used.

## Deployment boundary

No Docker image build, CasaOS apply, changedetection startup, LangBot API install,
Telegram notification, or KOOK notification was performed. A future RELEASE step
must use the immutable-image / explicit no-build deployment workflow and create a
new rollback checkpoint before changing CasaOS state.
