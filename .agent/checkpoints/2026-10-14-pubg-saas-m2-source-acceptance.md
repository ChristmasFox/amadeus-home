# PUBG KOOK SaaS M2 source acceptance — 2026-10-14

This records source, isolated synthetic validation, and a disposable local
PostgreSQL recovery exercise only. It does not approve deployment, public
exposure, use of live KOOK/PUBG/model credentials, clean-host/cloud recovery, or
changes to private Kurisu/9Router. M1 evidence and reproducible startup
instructions remain in
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
  create only explicitly named disposable databases.
- The M2 P6 source follow-up adds a pinned-base multi-stage SaaS Dockerfile,
  Compose with separate internal PostgreSQL and outbound app networks, resource
  and process caps, a loopback-only PostgreSQL backup port, file-backed Compose
  secrets, and separate bootstrap, migrator, app and backup roles. The migration
  service is an explicit one-shot; `compose up` does not build an image. The
  rendered config check passed with placeholder-only files.
- The backup follow-up adds a six-hour UTC `systemd` timer, a one-shot backup
  job, and a retention command that requires `--apply` plus an exact output-dir
  match. Retention cannot be set below seven days and removes only complete,
  matching encrypted artifact/manifest pairs. The timer has not been installed
  or allowed to run on M204.
- The first real restore reproduction failed with PostgreSQL's
  `schema "public" already exists`: the archived TOC creates `public`, which a
  newly created database already has. The restore tool now omits exactly that
  TOC entry, creates the target from `template0`, restores as `pubg_migrator`,
  and reapplies app DML, backup SELECT and future migration default grants.

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
  passed 14/14 after adding TOC/schema, restore-grant, retention, checksum and
  deletion-guard tests. The backup job passed `bash -n`. A one-shot run of
  `scripts/pubg-saas-backup-job.sh` created an encrypted artifact/manifest pair
  and completed the seven-day retention scan against the isolated PostgreSQL
  fixture; all temp keys and artifacts were removed. Python
  compilation, backup CLI help, migration/gateway/worker
  side-effect-free dry-runs, `pnpm check:architecture`, `pnpm check:secrets`
  and `git diff --check` passed.
- A real `age` + PostgreSQL 18 fixture rehearsal passed: created an ephemeral
  age identity, backed up the reused isolated `pubg_test` database, verified
  checksum/decryptability/archive structure, restored into a new disposable
  database, and matched all 35 public base-table counts. App DML succeeded but
  app DDL was denied; backup SELECT succeeded but backup writes were denied;
  migrator DDL and default app/backup grants succeeded. The restore took 0.43s
  on this local fixture. The disposable database and temporary roles were
  removed with guarded cleanup; temp keys/artifacts were outside Git and
  deleted. This does not measure an independent host RTO.
- `docker compose --env-file .env config --quiet`, shell syntax checks for the
  URL entrypoint and PostgreSQL role bootstrap, the entrypoint password URL
  encoding probe, architecture scan, secrets scan and diff check passed. No
  image build or container start was attempted.

An initial full SaaS run had one fixture failure: the onboarding test sends
more than the production default of 10 requests per user in a minute. That
fixture now sets explicit high limits; a separate four-dimension integration
test proves the production defaults are enforced. No source safety assertion
was removed or relaxed.

## Open acceptance gates

- Dockerfile and Compose syntax were not validated by building or starting
  containers. The image tag still needs to be built from a reviewed immutable
  Git commit for actual clean Linux/ARM64/amd64 execution.
- The real restore and one-shot scheduled job used the same dedicated
  PostgreSQL 18 test service, not a fresh Linux/cloud host. The six-hour timer
  has not been installed or observed over time; independent-storage recovery is
  not proven yet.
- Compose's normal outbound bridge is not an egress policy. Private/LAN/link-
  local/metadata denial and approved endpoint allowlisting must be enforced and
  tested externally before real credentials are installed.
- M204-offline/cloud-restored operation and stop-public/private-Kurisu
  independence have not been performed. No Docker build/up/down or deploy was
  run.
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
