# PUBG KOOK SaaS M2 source acceptance — 2026-10-14

This records source and isolated synthetic validation only. It does not approve
deployment, public exposure, use of live KOOK/PUBG/model credentials, a real
backup/restore, or changes to private Kurisu/9Router. M1 evidence and reproducible
startup instructions remain in
`.agent/checkpoints/2026-10-13-pubg-saas-m1-source-acceptance.md`.

## M2 source delivered

- `2271a4b` adds tenant/team-keyed PostgreSQL sync jobs, `SKIP LOCKED` claims,
  fencing lease tokens, heartbeat renewal, expired-lease recovery, bounded
  retries, per-process team concurrency, and shutdown that stops new claims and
  checkpoints in-flight work. Migration `0009_public_sync_jobs.sql` is additive.
- The same source commit adds minute-window KOOK ingress limits (default
  10/user, 60/channel, 120/tenant, 300/bot; environment-configurable), indexed
  through migration `0010_kook_ingress_rate_limits.sql`. KOOK outbound sends
  honor response route/global bucket headers and persist 429 retry deadlines in
  the durable outbox. PUBG API admission remains shared through PostgreSQL.
- An isolated-schema benchmark seeds 200 tenants/teams, 800 users/accounts,
  400 matches and 1,600 match-player rows. It runs 200 authorization tasks and
  200 worker team runs with no external provider calls. Final run: 4,400
  authorization-phase SQL statements in 3,015 ms (p50/p95/p99 0.97/84.04/113.64
  ms); 7,356 worker-phase SQL statements in 3,105 ms (p50/p95/p99
  0.93/62.05/100.31 ms); 200/200 runs completed, 0 failures, pool peak 16/20
  connections and 0 waiters. This is not a production capacity or SLO claim.
- `27523ae` adds an `age`-encrypted public-PostgreSQL-schema backup utility,
  checksum/table-count manifest verification, and restore/cleanup guards that
  create only explicitly named disposable databases. Synthetic safety tests
  cover manifest, checksum, secret URI handling, path and target guards.

## Verification

- `pnpm typecheck:pubg-saas`, `pnpm build:pubg-saas`, `pnpm typecheck:pubg`
  passed.
- `PUBG_SAAS_TEST_DATABASE_URL='postgresql://pubg_test:fixture_only@127.0.0.1:55432/pubg_test' pnpm test:pubg-saas`
  passed 80/80 with no skips, including M1 functional/auth/domain cases, new
  request limits, outbox 429 recovery and worker queue tests.
- `pnpm test:pubg` passed 68/68 private identity, presentation, Domain and
  plugin regressions. The private runtime was not started.
- The 200-team benchmark command is:
  `PUBG_SAAS_TEST_DATABASE_URL='postgresql://pubg_test:fixture_only@127.0.0.1:55432/pubg_test' pnpm --filter @agent/pubg-saas exec tsx tests/m2-200-team-load.benchmark.ts`.
- `python3 -m unittest discover -s scripts/tests -p 'test_pubg_saas_backup_restore.py' -v`
  passed 8/8. Python compilation, backup CLI help, migration/gateway/worker
  side-effect-free dry-runs, `pnpm check:architecture`, `pnpm check:secrets`
  and `git diff --check` passed.

An initial full SaaS run had one fixture failure: the onboarding test sends
more than the production default of 10 requests per user in a minute. That
fixture now sets explicit high limits; a separate four-dimension integration
test proves the production defaults are enforced. No source safety assertion
was removed or relaxed.

## Open acceptance gates

- No `age`, `pg_dump`, `pg_restore`, `psql`, or PostgreSQL command-line client
  was available for a real encrypted backup/restore rehearsal. The recovery
  tooling has not been exercised against even a disposable live database.
- `infra/pubg-saas` still lacks a Compose deployment template and the SaaS has
  no built/pinned independent image. Therefore clean Linux/ARM64/amd64 recovery,
  M204-offline/cloud-restored operation, and stop-public/private-Kurisu
  independence have not been performed. Docker build/up/down and deploy were
  not run.
- 200-team data/query/worker simulation ran only on the local isolated
  PostgreSQL fixture. It does not measure M204 memory/swap/RSS, production
  network egress, or an SLO.
- The live KOOK bot developer-account quota is 10,000 messages/day across all
  bots and resets at 12:00 Beijing. KOOK documents a large discount for a first
  reply within five minutes, but not an account aggregate visible to this bot;
  remaining developer-account usage and eligibility for 200 guilds are
  unverified. See [KOOK rate-limit headers](https://developer.kookapp.cn/doc/rate-limit)
  and [KOOK message quota](https://developer.kookapp.cn/doc/http/message).
- P4's deidentified prompt-accuracy benchmark, live API/model accuracy and
  latency, official PUBG quota feasibility, resource headroom and formal
  pre-release go/no-go remain open. No provider credentials or real guild were
  configured.

No production database, Docker service, CasaOS service, private OpenClaw,
9Router, or external cloud was changed. No deployment occurred.
