# PUBG review mobile commentary wrapping checkpoint

- Date: 2026-09-11 Asia/Shanghai
- Scope: `apps/agent-runtime/src/review/presentation.ts` player commentary display only, plus regression coverage.
- Status: implemented, verified locally, ready to deploy.

## Implemented

- Long `💬 点评` text is split at punctuation first and at 28 Unicode characters when a segment is still too long.
- Analysis text and evidence are not changed; the wrapping happens only when building the player presentation section.
- Missing players still render only `-`; melee ledger, loot leaderboard, environment section and all other report sections are unchanged.

## Verification

- `pnpm --filter @agent/agent-runtime exec tsx --test tests/review-v3-2.test.ts tests/review-v3-3.test.ts tests/review-supplemental.test.ts`: passed.
- `pnpm --filter @agent/agent-runtime test`: 130 passed, 1 skipped.
- `pnpm --filter @agent/agent-runtime typecheck`: passed.
- `pnpm check:secrets`: passed.
- `git diff --check`: passed.

## Release follow-up

- Build and deploy a new immutable PUBG runtime image after commit/push.
- Re-run `/healthz`, `/homehub/health`, and read-only rendering smoke for match `c2aea5a9-a86a-4f7b-b0a5-3d032541922d`; do not send a real Telegram/KOOK message.
