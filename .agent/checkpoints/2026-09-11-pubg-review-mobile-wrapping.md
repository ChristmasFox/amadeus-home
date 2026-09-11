# PUBG review mobile commentary wrapping checkpoint

- Date: 2026-09-11 Asia/Shanghai
- Scope: `apps/agent-runtime/src/review/presentation.ts` player commentary display only, plus regression coverage.
- Status: implemented, committed, pushed, deployed and live-verified.

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

## Release and live verification

- Source commit `ec1147b` is on `origin/main`.
- `scripts/deploy-agent-runtime.sh --apply --build --no-proxy` built and activated `local/pubg-query-engine-v3:git-ec1147b196aa`; image ID starts with `sha256:6907703e137b2e91d`, and the compose rollback backup is `/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260911-135154`.
- `/healthz` returned `status=ok`; `/homehub/health` returned `status=healthy`; `scripts/doctor.sh` reported 0 failures and 0 warnings.
- Read-only rendering smoke for match `c2aea5a9-a86a-4f7b-b0a5-3d032541922d` returned `OK`; all four player sections remained present, the recorded players' comments were split into lines of at most 28 characters, `SG_LabmemNo008` remained `-`, and melee, loot and environment sections remained present.
- No real Telegram/KOOK message was sent.
