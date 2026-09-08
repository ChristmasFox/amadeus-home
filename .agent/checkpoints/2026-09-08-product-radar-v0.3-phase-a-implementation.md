# Product Radar V0.3 Phase A implementation checkpoint — 2026-09-08

## Source changes

- Added generic TargetProfile extraction with user-over-vision precedence, provenance/confidence, hard/soft constraints and provider fallback.
- Added Bunjang SearchPlanner and layered localized query plan; explicit user terms are retained.
- Added SearchFeed coordinator, shared changedetection sensor mapping, subscription baselines, ListingDiscovered event stream, watermark pagination, safety caps, degraded/failure/backoff/recovery state.
- Added additive SQLite tables: target_profiles, search_feeds, watch_feed_subscriptions, feed_listing_events, search_feed_runs.
- Added ImageFeatureProvider/ImageFeatureCache/ImageSimilarityResult boundaries while retaining Sharp perceptual matching and threshold 0.60.
- Updated LangBot image-only/image-plus-text UX and one-time vision extraction; similarity default is 900 seconds.

## Verification

- `pnpm --filter @agent/product-radar test`: 38 passed.
- `pnpm --filter @agent/product-radar typecheck`: passed.
- `pnpm --filter @agent/product-radar build`: passed.
- LangBot plugin tests: 7 passed; Python compile passed.
- `pnpm workflow:plan`: RUNTIME / PRODUCT_RADAR; plugin workflow required; no Docker build performed yet.

## Runtime / deployment

- Existing CasaOS Product Radar (`local/product-radar:git-298f8ee28072`) and changedetection healthy before release.
- No runtime files, database, Watch, or sensor were modified in this phase.
- Next: commit clean source, explicit RELEASE image build/recreate, plugin installation, smoke and rollback checkpoint.
