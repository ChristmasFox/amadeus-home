# PUBG review V2 implementation checkpoint

- Date: 2026-09-11 Asia/Shanghai
- Scope: `apps/agent-runtime` review facts, telemetry normalization, deterministic analysis/presentation, active compose version defaults and regression tests.
- Status: source implementation complete; final commit/push/deploy pending.

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

## Final release plan

- Commit and push source changes while preserving pre-existing branch-ahead commit `ab9356e`.
- Build and transfer an immutable image through `scripts/deploy-agent-runtime.sh --apply --build`.
- Update the live CasaOS compose parser/feature env values to version 6 with a rollback backup.
- Re-run the exact match ID smoke and verify `10脚 + 3拳`, `13/13` ledger completeness, player `-`, loot/environment sections, health endpoints and active image.
