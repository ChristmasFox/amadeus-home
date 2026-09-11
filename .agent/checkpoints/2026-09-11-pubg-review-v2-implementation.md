# PUBG review V2 implementation checkpoint

- Date: 2026-09-11 Asia/Shanghai
- Scope: `apps/agent-runtime` review facts, telemetry normalization, deterministic analysis/presentation, active compose version defaults and regression tests.
- Status: implemented, committed, pushed, deployed and live-verified.

## Implemented

- Explicit `Damage_Kick` / `Damage_Punch` classification wins over the generic PlayerMale/PlayerFemale causer fallback.
- Friendly-fire facts retain `meleeKind`; presentation groups the ledger by attack direction and verifies unique evidence event count against hit count.
- Missing configured players render only `-`.
- Added item movement facts for pickup/drop/loot-box activity and explicit cosmetic/clothing item-event metadata.
- Added destroyed-object breakdown and explicit-only terrain action count.
- Player commentary now combines combat, weapon, utility, recovery, loot, vehicle, environment and friendly-fire facts; deterministic awards are included.
- Parser/feature defaults moved to `telemetry-parser-6` / `review-features-6` so old cached facts cannot mask the classification fix.
- Missing players are excluded from fun-event generation, and player presentation suppresses duplicate `锐评` lines; weapon and armor labels are normalized for the report.

## Verification

- `pnpm --filter @agent/agent-runtime exec tsx --test tests/review-supplemental.test.ts tests/review-v3-3.test.ts`: 18/18 passed.
- `pnpm test`: 130 passed, 1 skipped.
- `pnpm --filter @agent/agent-runtime typecheck`: passed.
- `pnpm check:secrets`: passed.
- `git diff --check`: passed.

## Release and live verification

- Source commits `971d4eb`, `f76d4a4` and `20c4b1f` are on `origin/main`; pre-existing branch-ahead commit `ab9356e` was preserved.
- `scripts/deploy-agent-runtime.sh --apply --build --no-proxy` built and transferred immutable image `local/pubg-query-engine-v3:git-20c4b1f9bbaf`; CasaOS `ubuntu` container is running and healthy.
- Live compose uses `PUBG_TELEMETRY_PARSER_VERSION=telemetry-parser-6` and `PUBG_REVIEW_FEATURE_VERSION=review-features-6`.
- Latest image rollback compose backup: `/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260911-123456`.
- `/healthz` returned `status=ok`; `/homehub/health` returned `status=healthy`.
- Exact match `c2aea5a9-a86a-4f7b-b0a5-3d032541922d` returned `status=OK` and the rendered report was checked for `13/13` melee completeness, `202.05` friendly damage, `SG_LabmemNo008` rendered as `-`, no hidden-player fun event, no duplicate `锐评` line, normalized armor text, loot theme and environment destruction.
- No real Telegram/KOOK outbound message was sent; verification used the local runtime endpoint with a read-only smoke identity.
