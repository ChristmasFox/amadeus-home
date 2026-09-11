# Product Radar FashionSigLIP usage observability checkpoint

- Date: 2026-09-12 Asia/Shanghai
- Scope: expose FashionSigLIP usage in the 24-hour Product Radar heartbeat digest and cumulative Watch status/statistics.
- Source state before change: `main` clean at `96445ac`, synced with `origin/main`.
- Implementation:
  - `ImageMatchResult.modelUsage` reports embedding-provider calls, successful image embeddings, and feature-cache hits.
  - `watch_runtime_runs` and `watch_runtime_stats` persist the three counters with additive SQLite migration for existing databases.
  - Product Radar runtime heartbeat digest aggregates the last 24 hours.
  - LangBot observability presentation displays cumulative counters for similarity Watches.
- Verification:
  - `pnpm --filter @agent/product-radar test`: 51/51 passed.
  - `pnpm --filter @agent/product-radar typecheck`: passed.
  - `pnpm --filter @agent/product-radar build`: passed.
  - LangBot Product Radar unittest: 39/39 passed.
  - Python compile: passed.
  - No runtime service was restarted or modified.
- Deployment status: source-only; no production deployment performed in this stage.
- Rollback: revert the source commit after it is created, or restore the prior Product Radar image/compose checkpoint before any future deployment.
