# Amadeus validation matrix

This matrix is the default for 1.4.5 development. It preserves the release gates while preventing unrelated full-suite or image work during an implementation phase.

| Changed area | During edit | Phase gate | Release gate | Docker build |
| --- | --- | --- | --- | --- |
| docs, `.agent`, release evidence | `git diff --check`, JSON/Markdown checks | optional consistency check | one final full gate | no |
| tracked secret migration scripts | `bash -n`, tracked-file and leak fixture | fresh-clone + secret bundle rehearsal | `check:secrets` and fresh clone | no |
| storage shell / scheduler / GC | `bash -n`, storage fixture | `test:storage-runtime`, GC and scheduler fixtures | full test/typecheck/build once | no |
| backup / migration shell | `bash -n`, fixture SQLite/pg/artifact checks | backup/readiness fixture | full test/typecheck/build once | no |
| manifest / runbook / service inventory | JSON parse, contract test | `test:skuld-consistency` | architecture + full suite once | no |
| Immich reclaim/readiness shell | `bash -n`, isolated state fixture | migration-readiness + reclaim fixture | full suite once | no |
| Amadeus/Identity runtime source | targeted typecheck/test | affected package build if needed | full gate; affected image only | OpenClaw only |
| Product Radar runtime source | targeted typecheck/test | affected package build if needed | full gate; affected image only | Product Radar only |
| Dockerfile, dependency or lockfile | static checks | affected build | full gate | required affected image |
| OpenClaw config/compose only | parse and contract checks | no-build rehearsal | live acceptance | no |

## Evidence rules

- `pnpm workflow:plan` runs before each implementation phase.
- Successful checks may be reused only when their input scope has not changed; source changes invalidate the relevant check.
- Successful commands emit one summary line; failed commands retain bounded diagnostics.
- Fresh-clone rehearsal sets `AMADEUS_FRESH_CLONE_REHEARSAL=1` and runs a curated non-recursive suite.
- Live acceptance validates runtime truth only; it does not repeat local source gates.

## PUBG KOOK SaaS source implementation

The active source Goal is `docs/PUBG_KOOK_SAAS_V0_1_GOAL.md`. During domain,
private plugin, or public app changes, use the PUBG workflow:

```sh
pnpm workflow:plan
pnpm build:pubg
pnpm typecheck:pubg
pnpm test:pubg
pnpm build:pubg-saas
pnpm typecheck:pubg-saas
PUBG_SAAS_TEST_DATABASE_URL=postgresql://localhost:5432/pubg_saas_test pnpm test:pubg-saas
node apps/pubg-saas/dist/src/gateway.js
node apps/pubg-saas/dist/src/migrate-database.js
pnpm check:architecture
pnpm check:secrets
git diff --check
```

`pnpm build:pubg` is needed when the plugin consumes a newly exported Domain
symbol. Public Postgres integration tests use an isolated database selected by
`PUBG_SAAS_TEST_DATABASE_URL`; they never create or alter a non-test server by
default. Docker builds, Compose changes, runtime restarts, KOOK credentials and
external exposure remain outside source-phase validation.

The two built entry-point smoke commands run without `--apply`: they connect to
no service and apply no schema changes. SaaS integration coverage includes
durable ingress/restart, actor ordering/admission bounds, callback mutation
receipt recovery, name-based onboarding/roster/self-claim, channel revision and
scope-change rejection, public API admission/header backoff, prior-schema upgrades and fixture gateway-to-channel/DM
delivery including system-join welcome metadata validation and replay.
Public repository fixtures include cross-shard ID collisions, registered-roster
and DM access checks, foreign telemetry denial and atomic legacy shard migration.
Fixture and local Postgres results do not establish live KOOK, quota, model-provider,
backup/restore or 200-squad acceptance.
