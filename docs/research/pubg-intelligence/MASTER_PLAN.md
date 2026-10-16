# PUBG Intelligence Lab — Research & Delivery Plan

Status: PLANNED (no implementation complete)  
Branch: `research/pubg-intelligence`  
Scope: Lab historical PUBG telemetry research; Gate consumes only validated, versioned insights.  
Owner of execution: Codex via /goal, with stage-by-stage acceptance.

## 0. Goals and non-goals

Build a **private, local-only research workbench** for squad telemetry: select history/matches/players, ask natural-language questions, inspect reconstructable evidence and counterexamples, compare algorithm versions, and evolve presentation templates. Develop a reusable deterministic `packages/pubg-intelligence` package; do not integrate experimental results into production Gate prematurely.

Non-goals: no generic multi-agent framework, custom workflow engine, SaaS billing, public dashboard, auto-modification or auto-deployment of algorithms, live match guidance, replacing existing `packages/pubg-domain` data sync.

## 1. Existing boundaries to preserve

- `packages/pubg-domain`: shared PUBG API/domain and telemetry features for both Lab and Gate. Reuse, don't fork rules.
- Lab: OpenClaw, SQLite historical cache/telemetry, private credentials.
- Gate: `apps/pubg-saas`, AI SDK and separate PostgreSQL/tenant identity. **No direct access to Lab data, sessions, secrets, or memory.**
- Existing deployment, scheduled prefetch, production bot identity and releases are not to be changed by research work.
- Public repository: never commit raw identifiable match/player exports, API keys, database copies, WhatsApp identifiers, secrets or personal logs.

Proposed new paths (adapt only after inspecting actual workspace dependencies):
- `apps/pubg-intelligence-lab/`: local React+TypeScript UI, chat-like research interface, private server routes.
- `packages/pubg-intelligence/`: pure analyzers for reconstruction, combat, coordination, social, insight evidence, evaluation.
- `docs/research/pubg-intelligence/`: plans, data audit and benchmark methodology; no raw private data.
- `.local/` or other existing ignored storage: snapshots, reports, experiment notes; verify ignore rules before writing.

## 2. Safety & scientific rules (all phases)

1. Analyze via a read-only **consistent SQLite snapshot** of Lab, preferably SQLite backup API; research process must not open a production writer, run migrations, or mutate cache. Never commit/copy the DB to Git.
2. Keep test server listening on 127.0.0.1 by default; local-only auth boundary; prevent unauthenticated public/LAN access and broad CORS. Queries parametrized, user-selected sample caps and execution timeouts; no arbitrary SQL/code/shell from LLM tools.
3. Original evidence preserved/referencable in snapshot, feature schema and algorithm versioned; every finding includes match/time/player/event references, sample N, quality/coverage and uncertainty. Null or missing != zero.
4. Distinguish fact, inference, hypothesis and narrative. No invented confidence probabilities, claims of causal certainty, or ungrounded social intent. Position/event sampling constraints must be explicit.
5. AI can ask questions and select authorized **read-only** research tools; never change validated algorithms, production configuration or data by natural-language request.
6. Evaluate false positives, missing telemetry, squad-composition variation, bots, map/mode, survivorship bias and confounding factors. Maintain counterexample set, reproducible fixtures, regression tests, version comparison.
7. Only merge stable generic algorithms to main via review and existing CI; no automatic production deploy or Lab/Gate cross-instance DB integration.

## 3. Delivery stages and acceptance gates

### R0 — Dataset audit and a real, private test page
**Inputs**: actual monorepo, local Lab SQLite schema, cached match and telemetry features, sync logs.

Tasks:
- Inventory schema and migrations; verify whether raw telemetry is retained or only derived features; check match detail, parser/feature versions, telemetry event coverage, gaps/duplicates and identifiers, query costs.
- Produce a **locally generated** data report: per-event counts, matches with/without raw telemetry, timeline range, map/mode, unique players/teams, missing fields, anomalies, constraints on L1/L2 reconstruction.
- Separate any sanitized aggregate audit summary from private detailed audit output.
- Bootstrap local-only React+TS workbench with match browser, player/squad/time filters, data completeness labels, event timeline viewer, chat input and evidence pane.
- If no viable model is configured, support deterministic query modes and clearly disable AI mode; do not fake AI answers or telemetry.
- Design smallest viable read-only research API and fixture-backed smoke tests; use actual snapshot for optional local end-to-end verification.

Acceptance:
- Research page starts locally and cannot bind publicly by default.
- Can choose squad/match/time window, list match IDs and show actual persisted evidence or explicit "not available".
- Database source remains byte-for-byte unchanged; no secrets or private exports in Git.
- A reproducible audit command, sanitized summary, unit tests, browser smoke test, and R0 limitations are documented.
- **Stop** if insufficient raw telemetry exists; first make explicit acquisition/retention proposal without changing production sync blindly.

### R1 — Battle & match reconstruction
Tasks:
- Normalize events, timestamps, player/team references, revive/knock/death state, circle transitions and sampled positions.
- Segment engagements with explicit heuristics, conflict handling, event provenance and unknown-state fallbacks; handle overlap and multiple squads.
- Produce engagement timeline and participants, first knock, team survival, knock→kill/revive chains and measured time windows.
- UI drilldown from match to episode to underlying events. Define stable typed intermediate schema and parser version.

Acceptance:
- Deterministic replay of fixed, sanitized fixtures; no event duplication; reproducible IDs; controlled boundary/overlap tests.
- Compare manually verified episodes (include counterexamples) and publish precision/recall or transparent error counts, not arbitrary "accuracy".
- Evidence trace for every reconstructed engagement; ambiguity surfaced visibly.

### R2 — Tactical and social algorithms
Tasks:
- Combat: first knock, follow-up hits, advantage conversion when identifiable.
- Coordination: teammate distance *at sampled times*, combat onset separation, isolated engagements, response windows; never infer unobstructed line of sight from distance alone.
- Social: directed ally damage, rescue, common engagement relationships, favorite pairs and antagonistic-but-playful event candidates.
- Rotation: circle windows, movement and blue zone damage only when supported by available events.
- Derive per-match insight candidates with explicit rule version, denominator, sample size, support events, counterexamples and quality grading.
- Avoid opaque composite ratings until backed by calibration.

Acceptance:
- Fixtures for each metric including null/missing/incomplete modes.
- Validate at least 20–30 available matches *if dataset supports it*; otherwise disclose sample limit.
- Analysts can inspect a finding and disprove/report it with exact match/event references.
- No data-specific hardcoded player names, fixed test team, or fabricated insights.

### R3 — Natural language research assistant and presentations
Tasks:
- Chat-like UI: natural language questions; preserve selected scope, evidence references and follow-ups.
- Reuse Vercel AI SDK existing dependencies where appropriate, server-registered read-only typed tools for match search, episodes, comparison, metric aggregations and evidence lookup.
- Structured insight contract: fact/inference/hypothesis; source references, counts, assumptions, uncertainty, algorithm version.
- Templates: tactical coaching, squad humor, chronological story; shared typed facts, no new numbers invented by LLM, never falsely assign intentions.
- Link response paragraphs to metrics, episodes and counterexamples; export sanitized, explicit reports only.

Acceptance:
- Ask “为什么我们第三圈经常团灭？” and “我和 B 谁救谁更多？” against the snapshot; system can respond with supported evidence, abstain on insufficient data.
- Conversation context does not silently change scope, identity or leak raw keys/DB paths.
- Compare two templates on same insight: numerical facts identical; wording differs.
- Tests for tool permissions, prompt injection, missing data, unsupported claims and repeatability.

### R4 — Experiment/evaluation loop
Tasks:
- Define benchmark fixtures, annotated engagements, stratified historical holdout and reviewer feedback labels; split by match/time to prevent leakage.
- Register experiments: dataset snapshot fingerprint, algorithm/parser version, thresholds/config, result metrics, runtime and resource usage, provenance.
- Offline batch evaluations and side-by-side baseline vs candidate comparisons with changes in false-positive and false-negative cases; counterexample browser and failure taxonomy.
- Collect human corrections as review labels; never let the model update production rules autonomously.
- Assess templates: groundedness, usefulness, diversity, no defamatory/manipulative claims, human preference. Keep a versioned report manifest.

Acceptance:
- One-command offline replay on fixture corpus.
- Diff includes changed episodes/insights, evidence, regressions, unresolved cases.
- Clear promotion gate: tests green, baseline not regressed on critical labels, human reviewed, no privacy violations.

### R5 — Controlled Gate adoption
Tasks:
- Extract stable engine as versioned package API, not new microservice by default. Respect existing `pubg-domain` contracts.
- Gate obtains insights **only from its own authorized data** and PostgreSQL adapter, never from Lab SQLite.
- Preserve per-tenant and per-player boundaries, quotas, fallbacks, stale/partial indicators and AI tool permissions.
- Introduce feature flag/canary, output rendering in KOOK, rollback path and perf/cost observability.

Acceptance:
- Tenant A cannot query tenant B's raw events or derived insight.
- Existing stats, telemetry prefetch and bot conversations regression-tested.
- Gate-Local canary before production; explicit manual approval and release checklist.
- Measurable usefulness from actual squad testers, with opt-out and corrections.

## 4. Dependency / implementation order

R0 → R1 → R2 → R3 → R4 → R5 is the **promotion order**. R3 UI shell can be scaffolded during R0; preliminary evaluation fixtures should start during R1; do not interpret this as permission to skip acceptance. R2 and R3 may iterate within the research branch. Keep focused commits and a stage-specific changelog.

## 5. Initial experiment questions (hypotheses, not conclusions)

- Do early team knocks disproportionately follow sampled teammate separation?
- Does first-knock advantage convert to battle wins in comparable engagements?
- When rescues fail, is the cause observable from time windows or simply unknown?
- Are circle-3 casualties related to late rotations, controlling for map/phase?
- Which player pairs produce most validated rescue, friendly-fire and shared engagement events, adjusting for opportunities and shared match counts?
- Which "funny story" candidates have both strong evidence and low risk of misleading players?

## 6. Execution contract for Codex /goal

1. Work exclusively on `research/pubg-intelligence`; verify clean tree and current branch before implementation.
2. Read this plan, inspect actual repository code, **challenge assumptions** against real schema; report deviations before implementation decisions.
3. Execute only one stage at a time; finish tests and stage report before advancing; use the real snapshot only from authorized local environment.
4. Do not change production deployment, personal Lab runtime, existing Gate service, cron, or private credentials as part of an experiment.
5. Document tested behaviors vs not tested; no “done” without observed artifacts. Commit code and **sanitized** research docs; never commit private datasets.
6. Deliver each stage with commands, tests run, errors/limitations, data quality, algorithm version and next-stage entry criteria.

### Suggested first goal

`/goal Implement R0 from docs/research/pubg-intelligence/MASTER_PLAN.md on research/pubg-intelligence. Audit the actual Lab SQLite telemetry persistence and repository contracts first; build a local-only read-only PUBG Intelligence Lab UI with match browser, filtering, chat input scaffold and evidence drilldown. Do not invent telemetry results or change production. Deliver audit methodology, sanitized report, verified test commands and explicit R0 acceptance evidence. Stop after R0.`

## 7. Status ledger

- Branch created: yes (`research/pubg-intelligence`).
- This document: planning artifact only.
- R0: not started.
- R1: not started.
- R2: not started.
- R3: not started.
- R4: not started.
- R5: not started.

Update status only upon actual verified work and commit.