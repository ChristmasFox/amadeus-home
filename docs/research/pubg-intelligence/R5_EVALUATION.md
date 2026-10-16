# R5 — Controlled Gate adoption

Updated: 2026-10-17
Branch: `research/pubg-intelligence`
Gate API: `@agent/pubg-intelligence/gate` `1.0.0`
Gate compact-facts rule: `gate-compact-facts-v1`

## SOURCE_FIXED

`packages/pubg-intelligence` now exports a dedicated Gate subpath, `@agent/pubg-intelligence/gate`, at semver `1.0.0` for the compact Domain telemetry facts that Gate actually persists. The dedicated entrypoint does not import Lab experiment storage or SQLite modules. The API validates match identity, current parser/feature versions, the authorized roster, evidence shape, the feature cap, and that the persisted fact's raw event array is empty. It reports integrity-checked fight outcomes and explicitly in-match directed teammate damage; it excludes pre-match damage and marks unknown phase, missing/current-version cache gaps, and invalid fight-integrity results as incomplete or unavailable. It emits response-local evidence aliases rather than raw account, match, or event IDs.

The Gate adapter takes only the `AuthorizedPublicQuery` created by the existing KOOK authorizer. It rejects any repository whose storage provenance is not `postgres`, reads only `listMatches` and exact-version feature `get` calls on that scoped repository, uses a 7- or 30-day window, caps reads at 30 matches, and limits feature-read concurrency to four. It never refreshes PUBG data or writes to Gate PostgreSQL. The existing PostgreSQL repository continues to enforce tenant/team membership and team-scoped feature keys. Gate does not import, configure, or connect to the Lab SQLite store.

The AI SDK tool is registered only when `GATE_PUBG_INTELLIGENCE_ENABLED=1` and a valid runtime-only `GATE_PUBG_INTELLIGENCE_CANARY_TENANT_IDS` allowlist are both present. The tool rechecks the current trusted KOOK authorization before reading, and a tenant outside the allowlist receives no data. Both flags default off; invalid or duplicate allowlist entries fail closed. The tool returns a deterministic KOOK-ready rendering plus structured coverage, version, integrity, and evidence-alias fields. Aggregate diagnostics record bounded match/cache counts and elapsed milliseconds without tenant IDs. Existing `kook_agent_runs` captures model token usage.

The guarded Gate-Local candidate tool now accepts an explicit `--database-backup full` apply option. It selects the existing encrypted, authenticated PostgreSQL checkpoint path for a reversible code-only release; the default behavior is unchanged. This allows the requested pre-deployment PG backup without manufacturing a schema migration or bypassing the protected candidate pipeline.

No SQL migration or additional service was added: the current Gate sync already persists compact telemetry facts in its own PostgreSQL database. This source format intentionally does not support R1 episode reconstruction or first-knock attribution in Gate. Raw events are discarded by the Domain feature-store compaction step, so R5 does not infer event-stream claims from fight aggregates or add a second raw-telemetry store. This is the data-contract boundary for this adoption.

## BUILD_VERIFIED

- `pnpm --filter @agent/pubg-intelligence build` — passed.
- `pnpm --filter @agent/pubg-intelligence test` — 32 passed.
- `pnpm --filter @agent/pubg-intelligence-lab typecheck` — passed.
- `pnpm --filter @agent/pubg-intelligence-lab test` — 2 passed.
- `pnpm --filter @agent/pubg-intelligence-lab build` — passed.
- `pnpm --filter @agent/pubg-saas typecheck` — passed.
- `pnpm test:pubg-saas` — 204 total; 159 passed, 45 PostgreSQL/provider-backed tests skipped because no dedicated test database is configured.
- `pnpm --filter @agent/pubg-saas build` — passed.
- `pnpm typecheck:pubg-saas`, `pnpm typecheck:pubg`, and `pnpm test:pubg` — passed after rebase.
- `pnpm check:architecture`, `pnpm check:secrets`, and `git diff --check` — passed.
- `pnpm install --lockfile-only` — passed.
- Gate OCI image package check: `docker build --platform linux/arm64 ...` passed; importing `@agent/pubg-intelligence/gate` from the built runtime image confirmed API `1.0.0` loads without `node:sqlite`.
- Gate autopilot safety suite: 36 tests passed, including the explicit full-database-backup selector and preserved default code-only behavior; Python compile, architecture check, secrets scan, and diff checks passed. PR #12 merged as `f2deb0e14b43f296f193a393e11b673962ada254`. PR #13 was rebased onto that merge; the conflict resolution retained the Gate memory plugin/dependency and added the R5 canary adapter. GitHub Actions for rebased source `e7e626d495bf79f7fd1482a4d49b5ca8b5d8e22e` passed all six checks, including isolated PostgreSQL, pgvector, and amd64/arm64 OCI build.

Local tests verify default-off and exact-tenant canary selection, no reads for a non-canary tenant, the typed AI SDK tool loop, response rendering through the KOOK adapter, bounded PostgreSQL adapter calls, stale/partial states, compact-facts validation, out-of-roster rejection, and evidence alias stability. The existing PostgreSQL repository integration test now checks that Tenant A cannot read Tenant B's match-scoped feature record; the KOOK integration test exercises the canary tool against a real disposable Gate PostgreSQL fixture when the CI database is available.

The full local Gate release verification did not run its database-backed suite. `bash scripts/release-gate.sh verify` stopped before tests with `GATE_TEST_DATABASE=BLOCKED reason=missing` because `PUBG_SAAS_TEST_DATABASE_URL` is not configured. Do not treat the 45 skipped local checks as passes. GitHub Actions for rebased PR #13 source SHA `e7e626d495bf79f7fd1482a4d49b5ca8b5d8e22e` passed all six checks, including the isolated Gate PostgreSQL tests, pgvector safety fixture, and amd64/arm64 OCI build. The initial CI run exposed a missing workspace-package build/copy step; the fix is covered by these passing runs.

## LIVE_VERIFIED

No Gate PostgreSQL runtime was queried for this source-stage verification and no Gate-Local deployment was performed. The typed AI SDK tool path was exercised with a mock model and an authorized fake repository; the feature adapter rejects a SQLite provenance and the non-canary integration path performs zero feature reads. This is test evidence, not real Gate data evidence.

## RELEASED

Not released yet. PR #12 is merged and PR #13 has green checks on its rebased head. The Gate-Local operator opt-in file is present with owner-only permissions, but guarded target preflight, an explicit `--database-backup full` PostgreSQL checkpoint, image health checks, and runtime canary verification remain pending. No migration is required by this source change. The user selected an existing Gate-Local test tenant; the local runtime allowlist still needs verification, without emitting the tenant ID. M2 remains paused.

## Rollback

The capability defaults off and is removed by setting `GATE_PUBG_INTELLIGENCE_ENABLED=0` or removing the canary tenant allowlist entry, then reloading the Gateway. For an application regression, use the existing guarded Gate-Local candidate checkpoint to restore prior Gateway/Worker image and environment configuration. Keep the current PostgreSQL volume; this change adds no schema state. The existing automatic health/smoke rollback remains the failed-candidate path.
