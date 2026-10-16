# PUBG Intelligence Lab status ledger

Updated: 2026-10-17
Branch: `research/pubg-intelligence`

| Stage | Source | Build | Live / data evidence |
| --- | --- | --- | --- |
| R0 — Dataset audit and local workbench | Complete; report at [`docs/reports/PUBG_INTELLIGENCE_R0_DATA_AUDIT.md`](../../reports/PUBG_INTELLIGENCE_R0_DATA_AUDIT.md) | Previously verified | Read-only snapshot and local page established before R1 |
| R1 — Battle & match reconstruction | Implemented; stable intermediate schema `1`, parser `battle-reconstruction-v1` | Focused package tests, typechecks, and app build verified; final ledger updated with commit | Real read-only snapshot returned 71 episodes, 167 circle samples, 114 circle transitions; eight episodes manually reviewed; see [`R1_EVALUATION.md`](R1_EVALUATION.md) |
| R2 — Tactical and social algorithms | Complete; schema `1`, rules `tactical-social-rules-v1` | Focused package/app tests, typechecks, builds, secrets scan, and diff check verified | Real read-only snapshot: 30/30 matches analyzed; rule coverage and limits at [`R2_EVALUATION.md`](R2_EVALUATION.md) |
| R3 — Natural language assistant and presentations | Complete; `research-assistant-v1`, scoped read-only AI SDK tools, typed evidence claims, three templates | 26 intelligence tests, 2 Lab API tests, package/app builds and typechecks verified | Real snapshot returned 200 for trend and both acceptance questions; unsupported circle cause and directed-revive fallback abstained; see [`R3_EVALUATION.md`](R3_EVALUATION.md) |
| R4 — Experiment/evaluation loop | Not started | — | — |
| R5 — Controlled Gate adoption | Not started; no Gate integration in R1 | — | No Gate deployment or data access |

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

## Runtime note

The repo’s `pnpm devctl goal status` reports that `.agent/runtime/goal-state.json` is absent in this worktree. This ledger tracks repository acceptance evidence; no Goal runtime state was created or modified.
