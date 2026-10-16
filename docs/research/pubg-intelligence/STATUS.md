# PUBG Intelligence Lab status ledger

Updated: 2026-10-17
Branch: `research/pubg-intelligence`

| Stage | Source | Build | Live / data evidence |
| --- | --- | --- | --- |
| R0 — Dataset audit and local workbench | Complete; report at [`docs/reports/PUBG_INTELLIGENCE_R0_DATA_AUDIT.md`](../../reports/PUBG_INTELLIGENCE_R0_DATA_AUDIT.md) | Previously verified | Read-only snapshot and local page established before R1 |
| R1 — Battle & match reconstruction | Implemented; stable intermediate schema `1`, parser `battle-reconstruction-v1` | Focused package tests, typechecks, and app build verified; final ledger updated with commit | Real read-only snapshot returned 71 episodes, 167 circle samples, 114 circle transitions; eight episodes manually reviewed; see [`R1_EVALUATION.md`](R1_EVALUATION.md) |
| R2 — Tactical and social algorithms | Complete; schema `1`, rules `tactical-social-rules-v1` | Focused package/app tests, typechecks, builds, secrets scan, and diff check verified | Real read-only snapshot: 30/30 matches analyzed; rule coverage and limits at [`R2_EVALUATION.md`](R2_EVALUATION.md) |
| R3 — Natural language assistant and presentations | Complete; `research-assistant-v1`, scoped read-only AI SDK tools, typed evidence claims, three templates | 26 intelligence tests, 2 Lab API tests, package/app builds and typechecks verified | Real snapshot returned 200 for trend and both acceptance questions; unsupported circle cause and directed-revive fallback abstained; see [`R3_EVALUATION.md`](R3_EVALUATION.md) |
| R4 — Experiment/evaluation loop | Complete; versioned replay engine, deterministic fixture corpus, baseline/candidate comparison, counterexamples, local review registry | 29 intelligence tests, 2 Lab API tests, builds/typecheck/secrets scan passed | Live replay and bounded review write returned 201; snapshot unchanged; see [`R4_EVALUATION.md`](R4_EVALUATION.md). Promotion gate remains closed without historical holdout. |
| R5 — Controlled Gate adoption | Source implemented; versioned Gate API and default-off, tenant-allowlisted Gate PostgreSQL adapter; see [`R5_EVALUATION.md`](R5_EVALUATION.md) | Local typecheck/build and non-database suites passed; isolated PostgreSQL integration suite still requires CI database | No Gate runtime/data access or deployment; feature flag remains off |

## R1 acceptance evidence

**SOURCE_FIXED** — Added versioned, deterministic battle reconstruction to `packages/pubg-intelligence`; exposed a match→episode→event drilldown; kept the Lab database open read-only and the signed asset URL/results in memory. The episodes API enforces the selected squad and date range.

**BUILD_VERIFIED** — Domain tests: 39 passed. Intelligence tests: 13 passed. Lab API tests: 1 passed. Intelligence and Lab typechecks and builds passed. `pnpm check:secrets` and `git diff --check` passed.

**LIVE_VERIFIED** — `http://192.168.5.3:4179` returned HTTP 200 from the page and bootstrap route; bootstrap listed 534 matches. A scoped real-snapshot episode query returned HTTP 200 with 10 in-match episodes, 167 circle samples, 24 in-match circle transitions, zero duplicate timeline assignments, and evidence linked for every returned timeline event. Unknown/post-match phase counts are shown in [`R1_EVALUATION.md`](R1_EVALUATION.md). The browser automation surface was unavailable, so visual browser interaction was not independently confirmed.

- Fixed sanitized telemetry fixture replays deterministically with stable IDs and zero duplicate timeline assignments.
- Exact 28-second contact and 120-second knock outcome boundaries, +1-second splits, overlap, same-team negative case, duplicate DBNO, unknown timestamp/team, revive/kill chain, circle changes, and sampled positions are covered by focused tests.
- Each episode includes timeline/source references and evidence IDs; the UI drills from filtered match to episode to source event.
- The API validates the selected squad and date range before returning episode data. Production Lab SQLite remains read-only; fetched telemetry and reconstructed data stay in process memory.
- Manual review counts and limits are published in [`R1_EVALUATION.md`](R1_EVALUATION.md).

## R2 acceptance evidence

**SOURCE_FIXED** — Added deterministic combat, coordination, social, and rotation candidates to `packages/pubg-intelligence`; connected per-match evidence and scope-limited recurrent-pair analysis to the Lab UI/API. Candidates expose rule/schema versions, explicit metrics and denominators, sample size, quality grade, assumptions, support evidence, and counterexamples. The source SQLite was copied via read-only snapshot and its before/after fingerprints matched; experiment writes remained in a separate temporary database. No Gate/Lab production deployment or source-data mutation was performed.

**BUILD_VERIFIED** — Intelligence tests: 19 passed; Lab API tests: 1 passed. Both packages' typechecks and builds passed; `pnpm check:secrets` and `git diff --check` passed. Sanitized fixtures cover deterministic replay, stable IDs, duplicate prevention, null/incomplete states, time/distance thresholds, and event citations. See [`R2_EVALUATION.md`](R2_EVALUATION.md) for commands, metric contracts, and aggregate results.

**LIVE_VERIFIED** — `http://192.168.5.3:4179` returned HTTP 200 for the page, bootstrap, match list, one scoped match analysis, and the 30-match cross-match query. The snapshot contained 543 matches and 283 with cached telemetry; the selected 30-match query analyzed all 30 with zero unavailable matches and returned six recurrent-pair candidates. A selected match returned 19 tactical candidates and 46 evidence references (40 event-level, six match-level absence references). Source completeness kept all recurrent candidates at low quality; missing samples remain explicit. Full per-rule coverage and limitations are in [`R2_EVALUATION.md`](R2_EVALUATION.md).

- No R2 real-data precision/recall claim is made: a stratified, independently labeled benchmark is an R4 deliverable.

## R3 acceptance evidence

**SOURCE_FIXED** — Added `research-assistant-v1` to `packages/pubg-intelligence`, wired server-side typed AI SDK tools and structured cited claims into the Lab UI, retained squad/date/match scope, anonymized private identifiers in prompts, and kept experiment writes in a separate local SQLite file. Unsupported circle-cause and directed-revive prompts abstain rather than borrowing unrelated match-store evidence. Full contract and limits are in [`R3_EVALUATION.md`](R3_EVALUATION.md).

**BUILD_VERIFIED** — Intelligence tests: 26 passed; Lab API tests: 2 passed. Package and app typechecks/builds, `pnpm check:secrets`, and `git diff --check` passed.

**LIVE_VERIFIED** — `http://192.168.5.3:4179` returned HTTP 200 for the page and scoped research API against the read-only snapshot (543 matches, 283 cached parser/feature matches). The trend query returned eight citations; both evidence-gap questions abstained with zero claims/citations. The source fingerprint was unchanged. No AI configuration is present locally, so a real model provider call is not live-verified; the AI SDK path was exercised with a mock model.

**RELEASED** — Not a product release. This is a stage commit on `research/pubg-intelligence`; no Lab or Gate production deployment occurred.

## R4 — Experiment/evaluation loop

**SOURCE_FIXED** — Added `pubg-intelligence-evaluation-v1`, an offline fixed-fixture replay using the actual R1/R2 pipeline, whole-match development/holdout splitting, SHA-256 dataset provenance, version/config/runtime/resource manifests, side-by-side metrics, error/counterexample evidence, and local bounded review labels. Results and reviews stay in the separate experiment store. The Lab source snapshot stays read-only. Details and exact fixture counts are in [`R4_EVALUATION.md`](R4_EVALUATION.md).

**BUILD_VERIFIED** — Intelligence tests: 29 passed; Lab API tests: 2 passed. Intelligence build, Lab typecheck/build, `pnpm check:secrets`, `git diff --check`, and the one-command replay passed.

**LIVE_VERIFIED** — `http://192.168.5.3:4179`, its Vite client module, and `/api/bootstrap` returned HTTP 200; bootstrap showed 543 matches / 283 telemetry-feature matches. Live replay and fixture review returned HTTP 201. The separate experiment registry listed the new run; source snapshot fingerprint remained unchanged. Eight synthetic cases produced holdout candidate TP=1/FP=0/FN=0/TN=2 versus baseline TP=1/FP=1/FN=0/TN=1, with two unresolved labels. The gate is deliberately closed: the holdout is small and synthetic, and no independently labeled historical holdout is available.

**RELEASED** — Stage implementation is committed and pushed to `research/pubg-intelligence`; no product release or production deployment occurred.

## R5 — Controlled Gate adoption

**SOURCE_FIXED** — Added versioned package API `@agent/pubg-intelligence/gate` 1.0.0 (`gate-compact-facts-v1`) and a Gate-only, tenant-authorized PostgreSQL adapter with bounded reads, typed AI SDK tool registration, default-off canary allowlist, KOOK rendering, redacted evidence aliases, and fail-closed SQLite/config checks. The protected Gate-Local candidate tool now supports explicit `--database-backup full` for this code-only deployment. No migration, new service, Lab database access, or Gate data write was added. Compact persisted facts do not contain raw event streams, so R5 intentionally does not claim R1 episode or first-knock reconstruction. Full contract and limitations are in [`R5_EVALUATION.md`](R5_EVALUATION.md).

**BUILD_VERIFIED** — After rebasing onto PR #12 merge `f2deb0e14b43f296f193a393e11b673962ada254`, local PUBG builds and typechecks passed; PUBG Intelligence had 32 passing tests, Lab had 2, and Gate had 204 tests total / 159 passed / 45 PostgreSQL/provider-backed tests skipped locally because no dedicated database URL is configured. The 36 Gate autopilot safety tests, architecture check, secrets scan, and diff check passed. GitHub Actions for rebased source `e7e626d495bf79f7fd1482a4d49b5ca8b5d8e22e` passed all six checks: verify, source/upstream shape, Lab regression, isolated PostgreSQL source/database, pgvector, and amd64/arm64 OCI build. PR #12's unified `GateMemoryPlugin` path and memory dependency remain intact alongside the R5 canary tool.

**LIVE_VERIFIED** — Not verified against Gate runtime or data. Tests used a mock AI model and fake PostgreSQL repository; no Lab SQLite or Gate-Local database was accessed and no deployment occurred.

**RELEASED** — Not released yet. PR #12 merged as `f2deb0e14b43f296f193a393e11b673962ada254`; PR #13 was rebased onto it with its memory changes preserved, and all six checks passed at `e7e626d495bf79f7fd1482a4d49b5ca8b5d8e22e`. PR #13 merge and the guarded Gate-Local target preflight, explicit PostgreSQL backup, image switch, health checks, and runtime canary verification remain pending. No schema migration is included. M2 remains paused.

## Runtime note

The repo’s `pnpm devctl goal status` reports that `.agent/runtime/goal-state.json` is absent in this worktree. This ledger tracks repository acceptance evidence; no Goal runtime state was created or modified.
