# Product Radar autonomous E2E acceptance and production repair

Date: 2026-09-09 (Asia/Shanghai)
Status: DEPLOYED / VERIFIED

## Scope

This phase validated the previously deployed similarity-feed recovery and the
new authenticated admin/development listing injection path. The real Watch was
not used for synthetic listings; the temporary Watch used an isolated
`크롬하츠` feed and was deleted after the run.

## Root cause and repair

High-volume Bunjang keyword feeds can reach the bounded first-scan page/listing
cap before seeing a prior watermark. The old behavior kept the feed at
`WATERMARK_NOT_REACHED`; changedetection also reports no text for the dynamic
keyword page, so no webhook arrived and the Watch remained at zero runtime
checks. The deployed recovery stores the newest item as a silent first-scan
watermark, keeps staged data transactional, and runs due similarity feeds from
the Product Radar process every 30 seconds with deterministic interval,
jitter, and backoff. A fetch failure does not advance the watermark.

The final source change removes the internal `perWatch` Map from the public
feed result. It was only needed to finish per-Watch runtime rows; serializing
the Map directly had returned `{}` and made webhook observations misleading.

## Local verification

- `pnpm --filter @agent/product-radar typecheck`: passed.
- `pnpm --filter @agent/product-radar test`: 48/48 passed.
- `PYTHONPATH=integrations/langbot/plugins/product-radar python3 -m unittest discover -s integrations/langbot/plugins/product-radar/tests -p 'test_*.py'`: 33/33 passed.
- `pnpm --filter @agent/product-radar smoke:bunjang`: seller baseline 5, product baseline 1, baseline notifications 0.
- `pnpm --filter @agent/product-radar smoke:similarity`: real product `424506121`, 60 candidates, threshold 0.60.
- `pnpm check:secrets`: passed.
- `git diff --check`: passed.
- `scripts/doctor.sh`: 0 failures, 0 warnings.

The tests include natural-language paraphrases, image-question negative
routing, same-group sender isolation, shared-feed subscriber boundaries,
pagination safety, authenticated injection, duplicate suppression, and
failure-to-recovery status transitions.

## Production E2E evidence

Temporary Watch: `e2e-test-watch-20260909-v2`; feed:
`feed-9a4dd29bf373068c084f29bf`; sensor UUID:
`75ea01e2-c093-4f4b-9e5c-e207a77204aa`.

- Creation performed a silent baseline (`baselineCount=474`, no baseline notification).
- Positive test listing `e2e-test-positive-20260909` produced one
  `ListingDiscoveredEvent`, one image comparison, score `1.0`, one
  `SimilarListingMatchedEvent`, and two outbox rows: Telegram `sent` and KOOK
  `sent`. The two rows represent one logical notification per channel;
  Telegram succeeded after transport retries.
- Negative test listing `e2e-test-negative-20260909` produced one image
  comparison at score `0.045043`, no match, and no event/outbox row.
- Repeating the positive listing returned `duplicate=true`; event and
  notification counts did not increase.
- The changedetection mapping was read back as the same UUID, Bunjang keyword
  URL, `paused=false`, and 900-second interval. A real webhook then fetched one
  page/five Bunjang listings successfully with no false match.
- Before cleanup, the isolated Watch runtime showed
  `feedRuns=4`, `successfulRuns=4`, `failedRuns=0`, `newListings=7`,
  `candidatesProcessed=7`, `imageComparisons=7`, `aboveThreshold=1`,
  `bestScore=1`, `notificationsSent=2`, and usage `0` calls / `0` tokens.
- After cleanup, counts for the E2E prefix were zero in watches, feeds,
  feed events, listings, matches, events, outbox, and search-feed runs.

## Final live state

- Source commit: `ab91542` pushed to `origin/main`.
- Runtime image: `local/product-radar:git-ab91542`.
- Container image id: `sha256:bd09352adb493217bd6e89403629176546ba841e19e71e51d293823a35c41551`.
- Container state: `running`, health: `healthy`; Product Radar `/health`:
  `status=ok`.
- Real Watch count: 1. Real feeds `패딩` and `다운 자켓`: `ACTIVE`, current
  watermark present, latest run successful, failure count 0.
- Final observed Watch runtime: `HEALTHY`, `feedRuns=6`,
  `successfulRuns=6`, `failedRuns=0`, `newListings=81`,
  `candidatesProcessed=81`, `imageComparisons=81`, `aboveThreshold=0`,
  `notificationsSent=0`, no last error.
- CasaOS rollback files:
  - `/var/lib/casaos/apps/product-radar/docker-compose.yml.codex-backup.20260909-165853`
  - `/var/lib/casaos/apps/product-radar/.env.codex-backup.20260909-165853`

No secret values were written to Git or included in this checkpoint.
