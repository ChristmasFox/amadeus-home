# PUBG KOOK SaaS M1 source acceptance — 2026-10-13

This is a source and isolated-test checkpoint, not a production or deployment
checkpoint. The active objective remains `docs/PUBG_KOOK_SAAS_V0_1_GOAL.md`;
M2 is still in progress.

## M1 scope delivered

- KOOK self-service team setup, PUBG name resolution, account claims, fresh
  permission checks, durable ingress/outbox and tenant/team-scoped sessions
  are connected to the executable app.
- Fixed stat/leaderboard/self-stat/review/friendly-fire/team-damage queries use
  the shared deterministic Domain. Natural-language requests run through the
  Vercel AI SDK with bounded structured `QueryPlan`, authorized roster/session
  validation, follow-up context and per-tenant usage accounting. No route IDs
  or SQL reach the model; unsupported facts remain unavailable.
- The independent SaaS worker loads registered PostgreSQL rosters, uses the
  shared Domain API synchronization and telemetry prefetch pipeline, and writes
  through a scope-pinned PostgreSQL repository. Public API player discovery
  uses shared PostgreSQL admission. API and telemetry requests are restricted
  to official hosts/paths, redirects are rejected, response bodies are capped,
  and the API credential is never forwarded to the telemetry CDN.
- Shared public match rows merge account facts. Repository reads filter players
  to the current team roster; team-specific sync state and telemetry remain
  tenant/team/config scoped. Roster add/replace clears team sync state so a
  changed roster re-expands already-cached match details.

## Acceptance evidence

- `PUBG_SAAS_TEST_DATABASE_URL=<dedicated isolated PostgreSQL URL> pnpm test:pubg-saas`
  — 74/74 passed, PostgreSQL 18. Includes same-match overlapping-account
  tenants, roster-only match reads, persisted sync state and friendly-damage
  facts fetched by the worker using fake PUBG API/CDN responses.
- `pnpm typecheck:pubg` — passed.
- `pnpm test:pubg` — 68/68 private identity, presentation, Domain and PUBG
  plugin tests passed; no private runtime was started.
- `pnpm build:pubg-saas` — passed.
- `node apps/pubg-saas/dist/src/public-sync-worker.js`,
  `node apps/pubg-saas/dist/src/gateway.js`,
  `node apps/pubg-saas/dist/src/migrate-database.js` — all side-effect-free
  dry-runs passed without arguments.
- `pnpm check:secrets` and `git diff --check` — passed.

No real KOOK guild, live PUBG key, external model endpoint, production
database, Docker/Compose, 9Router, private OpenClaw or deployment action was
used. The development environment had no runtime/model credentials configured,
so real provider accuracy, P95 latency, KOOK eligibility and 200-team capacity
are unverified. The Goal's deidentified P4 prompt benchmark and P3 real-guild
acceptance remain open.

## Current M2 work

The worker is a sequential bounded ingestion loop suitable for source-level M1
closure. M2 still needs queue/lease and starvation behavior under load, 200-team
simulation, API/message quota math, measured P95/RSS/connection headroom,
operational metrics/alarms, encrypted external backup, restore and migration
rehearsal, clean-host recovery, and the stop-public/restore-public independence
drills. No capacity claim is made from this M1 fixture.

## Previous bottleneck record

The previous test blockage was a fixture/assertion mismatch and an outdated
expected clarification code after follow-up semantics changed. Fixtures and
expectations were corrected without deleting coverage or weakening security
assertions. A worker integration retry also initially loaded a stale built
Domain artifact; rebuilding `@agent/pubg-domain` made the test use current source.
The earlier default-registry pnpm install retries hit metadata `ECONNRESET`;
their individual durations were not recorded. A frozen mirror install passed
the release-age policy, installed the pinned older AI SDK dependency set, and
was recorded at about 0.9 seconds. No release-age exception or security-policy
bypass was added.

## Reproduction and rollback

M1 functional source commit: `7f4735d` (`feat(pubg-saas): add AI queries and
scoped sync worker`).

Build locally with `pnpm build:pubg-saas`; worker/gateway/migration commands
without arguments remain dry-run. Before PostgreSQL tests, provide
`PUBG_SAAS_TEST_DATABASE_URL` for a dedicated disposable/test-only database; do
not use a production/shared URL. Roll back this source unit with
`git revert 7f4735d`. No runtime rollback is needed because nothing was deployed
or applied outside isolated test schemas.
