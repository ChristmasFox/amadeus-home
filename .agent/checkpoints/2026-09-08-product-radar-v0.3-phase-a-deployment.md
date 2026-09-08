# Product Radar V0.3 Phase A deployment checkpoint — 2026-09-08

## Release artifacts

- Source commits: `16d756d` (V0.3 Phase A), `f360e2d` (per-query shared-feed target validation), `8b0b96e` (TargetProfile/SearchPlan persistence), `ce7884d` (GPT-5.6 Luna UUID correction).
- Product Radar image: `local/product-radar:git-8b0b96e4c2c6`.
- Image digest: `sha256:a60b0b75eaaa192c0fbecc7ba442323b607d0a7f20d193011131066beaa35d26`.
- Canonical deployment: OrbStack `ubuntu` CasaOS `/var/lib/casaos/apps/product-radar`.
- External env rollback backup: `/var/lib/casaos/apps/product-radar/.env.codex-backup.20260908-130726`.
- LangBot plugin: `product-radar` `0.3.0`, final install task `41`, `INSTALL_READY`; latest plugin rollback directory `.backups/langbot/20260908-131244`. The visual path defaults to the currently registered `gpt-5.6-luna` UUID `581087d4-5793-4116-9aa1-d82e08ec6849`, with external config override support.

## Verification

- Product Radar container healthy; changedetection `0.60.3` healthy; LangBot and plugin runtime running.
- Existing real Product Watch `9ec10408-e55b-43a8-821b-f3427005656e` remained enabled with `intervalSeconds=120`, one product snapshot, one sensor, zero events/outbox.
- Real smoke image: public Bunjang clothing image from product `424506121`. User text `帮我蹲 Chrome Hearts hoodie，有同款告诉我` produced a deterministic fallback TargetProfile (the deployed LangBot Luna path is installed and defaults to the current Luna registry UUID; no user-visible inbound message was sent during this smoke). Full layered preview produced 3 queries and 1,225 candidates; one-feed persistence smoke produced 222 baseline candidates, `intervalSeconds=900`, baseline notifications `0`.
- SearchFeed state after baseline: active query feed used `jitterSeconds=120`; broader feeds that hit the safety cap were explicitly `DEGRADED/WATERMARK_NOT_REACHED` and did not advance invalid watermarks.
- After Product Radar restart, the smoke Watch still returned TargetProfile and SearchPlan from SQLite.
- Changedetection webhook refetch returned `pages=1`, `fetchedListings=54`, `newListings=0`, `matchedListings=0`, `eventIds=[]`, `watermarkReached=true`; duplicate webhook returned `status=duplicate`.
- Test Watches `v03-smoke-20260908` and `v03-smoke-persist-20260908` were deleted. Their private feeds/sensors were cleaned; final `/api/search-feeds` is empty.

## Final runtime state

Final Product Radar database summary: `watches=1`, `product_snapshots=1`, `events=0`, `notification_outbox=0`, `search_feeds=0`, `watch_feed_subscriptions=0`, `feed_listing_events=0`, `search_feed_runs=0`; the one remaining Watch is the pre-existing Product Watch.

## Rollback

Restore the prior external env backup and run `docker compose up -d --no-build` from the CasaOS Product Radar directory. Do not remove `/DATA/AppData/product-radar` or `/DATA/AppData/changedetection/datastore`. LangBot plugin rollback uses the recorded `.backups/langbot/20260908-130039` installation/deploy record.
