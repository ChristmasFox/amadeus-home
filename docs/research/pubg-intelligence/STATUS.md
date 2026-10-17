# PUBG Intelligence Lab status ledger

Updated: 2026-10-17
Branch: `research/pubg-intelligence`

| Stage | Source | Build | Live / data evidence |
| --- | --- | --- | --- |
| R0 — Dataset audit and local workbench | Complete; report at [`docs/reports/PUBG_INTELLIGENCE_R0_DATA_AUDIT.md`](../../reports/PUBG_INTELLIGENCE_R0_DATA_AUDIT.md) | Previously verified | Read-only snapshot and local page established before R1 |
| R1 — Battle & match reconstruction | Implemented; stable intermediate schema `1`, parser `battle-reconstruction-v1` | Focused package tests, typechecks, and app build verified; final ledger updated with commit | Real read-only snapshot returned 71 episodes, 167 circle samples, 114 circle transitions; eight episodes manually reviewed; see [`R1_EVALUATION.md`](R1_EVALUATION.md) |
| R2 — Tactical and social algorithms | Complete; schema `1`, rules `tactical-social-rules-v1` | Focused package/app tests, typechecks, builds, secrets scan, and diff check verified | Real read-only snapshot: 30/30 matches analyzed; rule coverage and limits at [`R2_EVALUATION.md`](R2_EVALUATION.md) |
| R3 — Natural language assistant and presentations | Complete; `research-assistant-v1`, scoped read-only AI SDK tools, typed evidence claims, three templates, real local 9Router path | 39 intelligence tests, 4 Lab API tests, package/app builds and typechecks verified | Current local page returned a real AI SDK answer with linked evidence against the 543-match snapshot; see [`R3_EVALUATION.md`](R3_EVALUATION.md) |
| R4 — Experiment/evaluation loop | Complete; versioned replay engine, deterministic fixture corpus, baseline/candidate comparison, counterexamples, local review registry | 29 intelligence tests, 2 Lab API tests, builds/typecheck/secrets scan passed | Live replay and bounded review write returned 201; snapshot unchanged; see [`R4_EVALUATION.md`](R4_EVALUATION.md). Promotion gate remains closed without historical holdout. |
| R5 — Controlled Gate adoption | Versioned Gate API, tenant-authorized PostgreSQL adapter, repo-wide Gate-Local auto-candidate authorization, full-backup/rollback flow, and exact-single-tenant canary selection; see [`R5_EVALUATION.md`](R5_EVALUATION.md) | PR #14, #15, and #16 checks green; PR #15/#16 merged only after all checks passed; 38 local Gate autopilot tests passed | Gate-Local candidate `e90b36f` is live and healthy; one exact tenant allowlist enabled; full encrypted backup verified; M2 remains paused |
| Persistent raw Telemetry archive | `pubg-raw-telemetry-archive-v1`; full response captured before parsing; gzip, SHA-256, atomic files, Match-ID deduplication, permanent retention, and top-100-only historical backfill | Domain 40, Intelligence 39, plugin 14, Lab 4 tests; all affected builds/typechecks passed | Newest 100 real matches archived and hash-verified; repeat backfill fetched none; local replay used zero CDN requests; see [`RAW_TELEMETRY_ARCHIVE_EVALUATION.md`](RAW_TELEMETRY_ARCHIVE_EVALUATION.md) |

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

**SOURCE_FIXED** — Added `research-assistant-v1` to `packages/pubg-intelligence`, wired server-side typed AI SDK tools and a required typed answer-submission tool into the Lab UI, retained squad/date/match scope, anonymized private identifiers in prompts, and kept experiment writes in a separate local SQLite file. The OpenAI-compatible provider explicitly sets `stream: false` for 9Router. Unsupported circle-cause and directed-revive prompts abstain rather than borrowing unrelated match-store evidence. Full contract and limits are in [`R3_EVALUATION.md`](R3_EVALUATION.md).

**BUILD_VERIFIED** — Intelligence tests: 39 passed; Lab API tests: 4 passed. Domain tests: 40 passed; PUBG plugin tests: 14 passed. Package and app typechecks/builds, `pnpm check:secrets`, and `git diff --check` passed.

**LIVE_VERIFIED** — `http://192.168.5.3:4179` returned HTTP 200 for the page, client module, bootstrap, and a scoped real-data research API call against the read-only snapshot (543 matches). The current local owner-only 9Router configuration made five model calls in the e2e flow; planner and assistant both used the AI SDK, and the assistant returned a validated answer with linked evidence. The no-model deterministic fallback and evidence-gap abstention remain covered by tests. See [`R3_EVALUATION.md`](R3_EVALUATION.md) for exact verification.

**RELEASED** — Not a product release. This is a stage commit on `research/pubg-intelligence`; no Lab or Gate production deployment occurred.

## Persistent raw Telemetry archive

**SOURCE_FIXED** — Added complete-response archiving before feature parsing, versioned gzip/manifest storage with raw and compressed SHA-256 verification, atomic publication, immutable captures with Match-ID deduplication, and no eviction. Existing OpenClaw prefetch/download paths now reuse the same response and retry state; the Lab reader prefers verified local data. Historical backfill is read-only and hard-capped at the 100 newest matches, and rejects archive paths inside the repository. The existing React page, match filtering, and separate experiment store remain in place. See [`RAW_TELEMETRY_ARCHIVE_EVALUATION.md`](RAW_TELEMETRY_ARCHIVE_EVALUATION.md).

**BUILD_VERIFIED** — Domain 40, Intelligence 39, PUBG plugin 14, and Lab 4 tests passed. Domain/Intelligence/plugin builds and Lab typecheck/build passed. `pnpm check:architecture`, `pnpm test:architecture`, `pnpm check:secrets`, and `git diff --check` passed.

**LIVE_VERIFIED** — The 543-match read-only snapshot's newest 100 all had allowed assets. Backfill archived 100, failed 0; repeat selected 100 existing captures with no new fetch; 100/100 archive entries passed hash verification. Aggregate raw size was 2,101,398,745 bytes and gzip size 152,437,525 bytes. The snapshot fingerprint stayed stable. Local archive replay returned HTTP 200/`available` with zero CDN calls. The restarted page returned HTTP 200, bootstrap reported the model enabled and 543 matches, and an actual scoped 9Router research call answered through the AI SDK with five claims and four evidence references.

**RELEASED** — Source is prepared for this research branch; no Lab production candidate was deployed. The OpenClaw plugin and persistent volume integration are source-verified. Future production ingestion remains pending the existing Lab candidate path; only local snapshot replay and historical backfill were live-verified here.

## R4 — Experiment/evaluation loop

**SOURCE_FIXED** — Added `pubg-intelligence-evaluation-v1`, an offline fixed-fixture replay using the actual R1/R2 pipeline, whole-match development/holdout splitting, SHA-256 dataset provenance, version/config/runtime/resource manifests, side-by-side metrics, error/counterexample evidence, and local bounded review labels. Results and reviews stay in the separate experiment store. The Lab source snapshot stays read-only. Details and exact fixture counts are in [`R4_EVALUATION.md`](R4_EVALUATION.md).

**BUILD_VERIFIED** — Intelligence tests: 29 passed; Lab API tests: 2 passed. Intelligence build, Lab typecheck/build, `pnpm check:secrets`, `git diff --check`, and the one-command replay passed.

**LIVE_VERIFIED** — `http://192.168.5.3:4179`, its Vite client module, and `/api/bootstrap` returned HTTP 200; bootstrap showed 543 matches / 283 telemetry-feature matches. Live replay and fixture review returned HTTP 201. The separate experiment registry listed the new run; source snapshot fingerprint remained unchanged. Eight synthetic cases produced holdout candidate TP=1/FP=0/FN=0/TN=2 versus baseline TP=1/FP=1/FN=0/TN=1, with two unresolved labels. The gate is deliberately closed: the holdout is small and synthetic, and no independently labeled historical holdout is available.

**RELEASED** — Stage implementation is committed and pushed to `research/pubg-intelligence`; no product release or production deployment occurred.

## R5 — Controlled Gate adoption

**SOURCE_FIXED** — Added versioned package API `@agent/pubg-intelligence/gate` 1.0.0 (`gate-compact-facts-v1`) and a Gate-only, tenant-authorized PostgreSQL adapter with bounded reads, typed AI SDK tool registration, default-off canary allowlist, KOOK rendering, redacted evidence aliases, and fail-closed SQLite/config checks. Gate-Local authorization now uses the repository Git common directory across linked worktrees with no expiry or per-worktree/terminal opt-in. Every candidate requires a verified encrypted full PostgreSQL backup; destructive migrations warn and proceed; migration or health/smoke failure restores the database, previous image, and configuration. Canary selection prefers one explicit test/fixture/canary marker and, when none exists, uses the sole tenant of the already-verified Gate-Local Bot; ambiguous selection still stops. No migration, new service, Lab database access, tenant-isolation relaxation, or permission-assertion change was added. Compact persisted facts do not contain raw event streams, so R5 intentionally does not claim R1 episode or first-knock reconstruction. Full contract and limitations are in [`R5_EVALUATION.md`](R5_EVALUATION.md).

**BUILD_VERIFIED** — After rebasing onto PR #12 merge `f2deb0e14b43f296f193a393e11b673962ada254`, local PUBG builds and typechecks passed; PUBG Intelligence had 32 passing tests, Lab had 2, and Gate had 204 tests total / 159 passed / 45 PostgreSQL/provider-backed tests skipped locally because no dedicated database URL is configured. The Gate autopilot suite passed 36 tests for the ACL-preserving rollback fix and 38 tests for canary selection, authorization, tenant isolation, and backup behavior. PR #14 checks completed green; PR #15 and #16 were each merged after all three GitHub Actions passed, including isolated PostgreSQL, pgvector, and amd64/arm64 OCI build. `pnpm check:secrets`, Python compilation, architecture checks, and diff checks passed. PR #12's unified `GateMemoryPlugin` path and memory dependency remain intact alongside the R5 canary tool.

**LIVE_VERIFIED** — Gate-Local source `e90b36f0281f78514e1aa2df65a8906adfd9c418` runs image `local/pubg-saas:git-e90b36f0281f78514e1aa2df65a8906adfd9c418` (portable image digest `sha256:b9063ee922dad157b8d479473bc347fd65225976834b0ddb0e88d9063ee8dbf0`). PostgreSQL, egress-proxy, Gateway, and Worker all reported healthy; both app containers and egress-proxy use the candidate image. The PUBG Intelligence canary is enabled for one exact tenant allowlist; the ID is redacted from output. The full encrypted PostgreSQL checkpoint at `~/.local/share/pubg-saas-backup/gate-local-20261016T181118Z-e90b36f0281f` is mode 0700 and reports `verified_recoverable`; `pubg-saas.dump.age` is 1,981,947 bytes with SHA-256 `c4c21d8b13413191d340e9fa74be06b12457b4d7ae6a5b491663df9d55f8f8f3`, and its restore listing has 308 entries. No migration delta was present. The R5 AI SDK tool itself was previously tested with a mock model and fake scoped repository; no real model-provider call is claimed.

**RELEASED** — Gate-Local canary candidate is deployed (not a formal Gate product release or tag). PR #14 merged as `9954570199480d004e4db7bd4a9550926829cf5c`; PR #15, which preserves PostgreSQL owner/ACL metadata during automatic rollback, merged as `e69d92c570134db66935b777230318818127ddb0`; PR #16, which supports the sole unmarked tenant on the verified Gate-Local Bot, merged as `e90b36f0281f78514e1aa2df65a8906adfd9c418`. The external checkpoint above contains encrypted full-database and Gateway configuration backups plus prior Compose/environment copies. If migration or post-switch health/smoke checks fail, the candidate automatically stops Gateway/Worker, restores the encrypted database with `pg_restore --single-transaction --clean --if-exists`, restores the prior image/configuration, and restarts the prior app. The canary can also be disabled by setting `GATE_PUBG_INTELLIGENCE_ENABLED=0` and reloading Gateway. M2 remains PAUSED with no clearance created or resumed.

## Runtime note

The repo’s `pnpm devctl goal status` reports that `.agent/runtime/goal-state.json` is absent in this worktree. This ledger tracks repository acceptance evidence; no Goal runtime state was created or modified.
