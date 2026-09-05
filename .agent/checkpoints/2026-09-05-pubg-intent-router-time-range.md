# Checkpoint: PUBG Intent Router 时间词误判

Date: 2026-09-05 (Asia/Shanghai)
Base commit: e0a3ed5 (`feat: harden homehub authorization and runtime health`)
Status: implementation and targeted verification complete; independent commit pending.

## Change

- Removed relative date/time words from the positive PUBG intent signal.
- Added compact, positive contextual follow-up recognition for TimeRange and PUBG references.
- Domain/Intent classification remains ahead of planner TimeRange parsing.
- A date-prefixed technical sentence is not considered a valid PUBG follow-up, even with active PUBG context.
- Kept HomeHub routing ahead of PUBG routing for service diagnosis.
- Updated planner-side `isPubgText` to keep the same no-time-only behavior.

## Required regression evidence

- `昨天战绩` -> PUBG
- active PUBG + `前天呢？` -> PUBG
- `昨天超的是CL30, tRCD 36, tRP 36, tRAS 80` -> NOT PUBG
- active PUBG + the same long hardware sentence -> NOT PUBG
- `昨天 Emby 挂了吗` -> HomeHub / NOT PUBG
- standalone `昨天` / `前天` / `最近 7 天` / `上周` -> NOT PUBG

## Verification

- `pnpm --filter @agent/agent-runtime typecheck` passed.
- `pnpm --filter @agent/agent-runtime exec tsx --test tests/router-intent-time-range.test.ts tests/query-engine-v3.test.ts` passed (14 tests).
- `git diff --check` passed.
- No Docker build, Release, Compose, or deployment was run.

## Next step

Commit this source, tests, documentation, task state, and checkpoint independently from HomeHub V1.1.
