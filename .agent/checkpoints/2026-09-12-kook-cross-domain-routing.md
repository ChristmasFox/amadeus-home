# Kook PUBG/Product Radar cross-domain routing checkpoint

Date: 2026-09-12 (Asia/Shanghai)
Status: IMPLEMENTED / DEPLOYING

## Root cause

- Kook and Telegram use the same LangBot Pipeline and both domain listeners observe normal messages.
- PUBG V3 did not recognize `战报` as a positive PUBG signal. Product Radar could then claim Kook messages such as `今日战报`/`今日战绩`; an existing Product Radar active-watch context made the semantic misclassification more likely.
- The PUBG listener also accepted every callback event. Product Radar `pr1:` callbacks could therefore be cross-consumed.
- The Telegram-only `Unknown` loading placeholder is ignored by the Kook text converter, creating an empty outbound request and `reply_message ActionCallError`.

## Source changes

- Added `战报` to runtime and PUBG V3 deterministic fallback signals.
- Added generic LangBot query-var domain claim coordination and Product Radar foreign-claim guard.
- Isolated PUBG/HomeHub callbacks (`pubg:` and `hh1:`) from Product Radar callbacks (`pr1:`).
- Made loading placeholders Telegram-only; Kook uses the final deterministic response directly.
- Tightened Luna Product Radar semantic boundary for PUBG/game/report/review messages, including active-watch contexts.
- Bumped plugin manifests to `pubg-stats 3.3.2` and `product-radar 0.5.8`.

## Verification before deployment

- `pnpm --filter @agent/agent-runtime exec tsx --test tests/router-intent-time-range.test.ts`: 5/5.
- PUBG V3 plugin platform tests: 16/16.
- Product Radar intent tests: 39/39.
- Runtime typecheck, Python compile, `pnpm check:secrets`, and `git diff --check`: passed.

## Deployment and rollback

- Pending: commit and push source, install both plugin packages through `scripts/deploy-langbot.sh --apply`, then deploy the runtime image with `scripts/deploy-agent-runtime.sh --apply --build` if required by the final diff.
- Preserve the LangBot plugin backup and runtime compose backup returned by the deployment scripts.
- Do not modify existing Product Radar Watch data.
