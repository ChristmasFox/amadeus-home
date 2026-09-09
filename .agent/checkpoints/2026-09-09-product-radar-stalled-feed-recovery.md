# Product Radar stalled similarity feed recovery checkpoint — 2026-09-09

## Diagnosis

The enabled Similarity Watch was genuinely stalled. Its `패딩` and `다운 자켓` SearchFeeds had only two historical failed baseline scans, no watermark, and no Watch runtime runs. `WATERMARK_NOT_REACHED` happened because these high-volume Bunjang searches exceeded the bounded first scan before reaching the end of historical results. changedetection continued to fetch the dynamic pages every 15 minutes but extracted no comparable text, so it did not emit Product Radar webhooks.

## Source changes

- A capped first scan may establish its newest listing as a silent baseline. It persists the watermark and events without routing the historical set to a Watch, preventing false notifications.
- Add an in-process due-feed sweep. It evaluates feeds every 30 seconds and executes only those due under their interval, deterministic jitter, and backoff; changedetection remains a compatible secondary trigger.
- Baseline runs now count as real Watch runtime checks, and regressions cover high-volume baseline recovery plus scheduling without a webhook.

## Verification

- Product Radar tests: 47/47 passed.
- Product Radar typecheck and build: passed.
- `pnpm workflow:plan`, `pnpm check:secrets`, and `git diff --check`: passed.

## Release status

Source commit `58a5305f94e6` was pushed to `origin/main`. Host BuildKit built `local/product-radar:git-58a5305f94e6` with digest `sha256:3b51f6efb4ade8a4b359229ebf06af8816bcd0936cb7d554f2203e4eab55061f`; it was loaded into OrbStack Ubuntu and activated by CasaOS with `docker compose up -d --no-build`. Rollback backups are `/var/lib/casaos/apps/product-radar/docker-compose.yml.codex-backup.20260909-163000` and `/var/lib/casaos/apps/product-radar/.env.codex-backup.20260909-163000`.

The startup due-feed sweep completed real silent baselines for the existing enabled Watch: its runtime is now 2 feed runs, 2 successes, 0 failures; both `패딩` and `다운 자켓` feeds are ACTIVE, have a persisted watermark, and recorded a successful run. Product Radar is healthy and `scripts/doctor.sh` reports 0 failures / 0 warnings. No Watch was created, deleted, or manually modified, and no manual notification was sent.
