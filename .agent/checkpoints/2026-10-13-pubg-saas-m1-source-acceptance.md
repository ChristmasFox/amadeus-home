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
  — 75/75 passed with no skips on the reused PostgreSQL 18 test instance.
  Includes same-match overlapping-account tenants, roster-only match reads,
  persisted sync state and friendly-damage facts fetched by the worker using
  fake PUBG API/CDN responses. A repository race test proves roster revocation
  waits for an in-flight bounded authorized read, then stale scopes are denied.
  A KOOK-to-PostgreSQL telemetry fixture verifies stored 37-point teammate
  damage reaches the user-facing response without claiming unavailable data is
  zero. A clean Node process imports `@agent/pubg-domain/core` without loading
  private `node:sqlite` modules.
- `pnpm typecheck:pubg` — passed.
- `pnpm typecheck:pubg-saas` — passed.
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

The re-audit's first KOOK integration attempt failed its new localized title
assertion: output contained the correct persisted `Alice → Bob：37 伤害 / 1 次`
facts but prefixed them with `today`. The handler was corrected to render
Chinese day labels; the targeted and full SaaS suites then passed. No tests were
removed and no security assertions were weakened. Earlier history includes a
fixture/assertion mismatch, an outdated follow-up expectation and one stale
built Domain artifact, all resolved by updating the fixture or rebuilding the
affected package. The most repeated/highest-cost command observed was
`pnpm install` against the default registry, which retried metadata requests
across about 460 lockfile entries and hit `ECONNRESET`; individual wall times
were not captured. A frozen mirror install passed age rules in about 0.9
seconds. No release-age exception or security-policy bypass was added.

## Reproduction and rollback

M1 functional source commit: `7f4735d` (`feat(pubg-saas): add AI queries and
scoped sync worker`). Re-audit remediation: `f16d6c1` (`fix(pubg-saas): close
M1 authorization and runtime boundaries`).

Build with `pnpm build:pubg-saas`. For local startup, provide independent
`DATABASE_URL`, `PUBLIC_PUBG_API_KEY`, `KOOK_BOT_ACCOUNT_ID` and
`KOOK_BOT_TOKEN`; set `MODEL_BASE_URL`, `MODEL_ID` and `MODEL_API_KEY` together
to enable natural-language planning. Apply schema with
`node apps/pubg-saas/dist/src/migrate-database.js --apply`, then run
`node apps/pubg-saas/dist/src/gateway.js --apply` and
`node apps/pubg-saas/dist/src/public-sync-worker.js --apply` as separate
processes. These are documented reproduction steps and were not run with live
credentials. For tests, set `PUBG_SAAS_TEST_DATABASE_URL` to a dedicated
isolated PostgreSQL URL and run `pnpm test:pubg-saas`; `pnpm test:pubg` exercises
private Kurisu without public PostgreSQL. Never use production/shared database
URLs. Roll back the re-audit with `git revert f16d6c1`; a full M1 source rollback
also reverts `7f4735d`. No runtime rollback is needed because nothing was
deployed or applied outside isolated test schemas.
