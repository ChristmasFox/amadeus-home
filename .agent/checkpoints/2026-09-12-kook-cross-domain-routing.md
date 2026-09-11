# Kook PUBG/Product Radar cross-domain routing checkpoint

Date: 2026-09-12 (Asia/Shanghai)
Status: IMPLEMENTED / DEPLOYED / VERIFIED

## Root cause

- Kook and Telegram use the same LangBot Pipeline and both domain listeners observe normal messages.
- PUBG V3 did not recognize `战报` as a positive PUBG signal. Product Radar could then claim Kook messages such as `今日战报`/`今日战绩`; an existing Product Radar active-watch context made the semantic misclassification more likely.
- The PUBG listener also accepted every callback event. Product Radar `pr1:` callbacks could therefore be cross-consumed.
- The Telegram-only `Unknown` loading placeholder is ignored by the Kook text converter, creating an empty outbound request and `reply_message ActionCallError`.
- Deployment verification also found a packaging defect: both new plugin manifests had an extra indentation level before localized YAML fields. LangBot returned accepted install tasks but failed archive parsing before persisting the new artifact, leaving the old plugin versions active.

## Source changes

- Added `战报` to runtime and PUBG V3 deterministic fallback signals.
- Added generic LangBot query-var domain claim coordination and Product Radar foreign-claim guard.
- Isolated PUBG/HomeHub callbacks (`pubg:` and `hh1:`) from Product Radar callbacks (`pr1:`).
- Made loading placeholders Telegram-only; Kook uses the final deterministic response directly.
- Tightened Luna Product Radar semantic boundary for PUBG/game/report/review messages, including active-watch contexts.
- Bumped plugin manifests to `pubg-stats 3.3.2` and `product-radar 0.5.8`.
- Corrected manifest indentation and label versions so LangBot archive parsing succeeds.

## Verification before deployment

- `pnpm --filter @agent/agent-runtime exec tsx --test tests/router-intent-time-range.test.ts`: 5/5.
- PUBG V3 plugin platform tests: 16/16.
- Product Radar intent tests: 39/39.
- Runtime typecheck, Python compile, `pnpm check:secrets`, and `git diff --check`: passed.

## Deployment verification

- Source commit `1dc5e54` is pushed to `origin/main`.
- LangBot local preview returned `code=0` for both packages. Product Radar `0.5.8` installed as task `14`; PUBG `3.3.2` installed as task `15`; live plugin API reports both `initialized` and the DB revisions are `25` and `33`.
- Agent runtime image `local/pubg-query-engine-v3:git-1dc5e54bd521` is active and healthy. `/healthz`, `/homehub/health`, `scripts/doctor.sh` (0 failures / 0 warnings), and `scripts/smoke-agent-runtime.sh` passed.
- LangBot rollback package directories: `.backups/langbot/20260912-003227/` and `.backups/langbot/20260912-003239/`. Runtime compose rollback: `/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260912-003618`.
- The root `pnpm test` runner reached the existing `review-v3-2.test.ts` CPU hang during the release pre-check and was interrupted; this checkpoint records only the passing targeted tests and live smoke, not a false full-suite pass.

## Deployment and rollback

- Preserve the LangBot plugin backup and runtime compose backup returned by the deployment scripts.
- Do not modify existing Product Radar Watch data.
