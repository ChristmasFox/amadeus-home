# Product Radar Bunjang search response hotfix checkpoint — 2026-09-08

## Problem

LangBot/Product Radar preview surfaced: `Bunjang search response did not contain a product list`. The parser only accepted a small set of exact response paths and the preview aborted on one query failure.

## Fix

- `BunjangSourceAdapter` now accepts exact and recursively nested product-like arrays, prefers populated arrays over empty arrays, and reads `cursor`/`nextCursor` variants.
- Similarity preview now isolates query failures and returns successful candidates plus `searchWarnings`; it no longer turns one transient search response into a complete preview failure.
- Added regression coverage for nested result arrays and `nextCursor`.

## Verification

- Product Radar TypeScript tests: 39/39 passed.
- Product Radar typecheck/build: passed.
- LangBot plugin tests: 7/7 passed.
- Secret scan and diff check: passed.
- Live image-only preview after deployment: 54 candidates, zero warnings.
- Final health: Product Radar `ok`, changedetection healthy.
- Existing Product Watch remains enabled at 120 seconds; no test Watch/feed/sensor/notification was created by the hotfix verification.

## Release

- Image: `local/product-radar:git-23836b200afe`.
- Commit: `23836b2` (`fix: prefer populated bunjang result arrays`) plus `2c5f901` response-shape/preview resilience.
- CasaOS rollback env backup: `/var/lib/casaos/apps/product-radar/.env.codex-backup.20260908-145644`.
