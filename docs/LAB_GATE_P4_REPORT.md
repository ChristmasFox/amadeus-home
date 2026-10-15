# Lab / Gate P4 delivery evidence

Date: 2026-10-15 (Asia/Shanghai)
Status: **`SOURCE_EVIDENCE_COMPLETE; LIVE_ACCEPTANCE_GATES_OPEN`**

P4 consolidates the P0–P3 evidence and records what is source-tested, package
built, live-observed, and still awaiting authorization. It does not certify a
formal release or complete Gate M2.

## Acceptance matrix

| Area | Evidence and status | Remaining boundary |
| --- | --- | --- |
| Memory Core plugin/config | `SOURCE_TESTED`; P1 read-only runtime inspection reported the pinned OpenClaw 2026.9.4 `memory-core` enabled and loaded. Config/admission fixtures pass. | No post-change image build or deployment; this does not establish current post-deploy behavior. |
| Embedding | `SOURCE_CONFIGURED`; the catalog contained the configured model ID. | No `/v1/embeddings` request was sent. Actual model compatibility, authentication, returned vector dimension, billing, and semantic availability remain unknown. |
| KNN / FTS | `LIVE_INDEX_STATUS_OBSERVED`; the inspected index reported 1024 dimensions, complete vector index, FTS enabled, and `dirty=false`. | No semantic paraphrase query, hybrid query, incremental refresh, forced rebuild, or restart-persistence check was run. Index status is not retrieval acceptance. |
| Dreaming | `SOURCE_TESTED`; 03:00 `Asia/Shanghai` schedule and allowlist admission are covered by source fixtures. | Prior read-only inspection had no run-history record or eligible corpus. No actual Dreaming run, candidate write, or persistence claim is made. |
| Session isolation | `SOURCE_TESTED`; peer allow/deny, missing/revoked/malformed allowlists, and admission-before-transcript-read fixtures pass. | Real transcript reads and memory writes were not authorized or performed. |
| Lab / Gate versions | `SOURCE_TESTED`; Lab SemVer transitions and Gate's independent version path pass sandbox tests. Current sources remain Lab `1.10.4` and Gate `0.1.0`. | No version bump or product tag was created. |
| Build impact | `SOURCE_TESTED`; a Memory Core patch-only change forces OpenClaw rebuild, shared Domain changes affect Lab and Gate, Presentation changes affect all consuming images, and unknown Docker inputs fail conservatively. | No Docker/OCI image was built. |
| Provenance and drift | `SOURCE_TESTED`; synthetic digest, source, Compose/config, health, tag, and expiry cases pass. Missing actual runtime evidence reports `UNKNOWN`. | No live drift doctor was run against a new runtime snapshot; Gate has no configured environment adapter. |
| Rollback and persistence | `SOURCE_TESTED`; recovery paths and SQLite/PostgreSQL boundaries are documented; synthetic manifest and fail-closed cases pass. | No restore rehearsal or volume/database operation was performed. |
| Lab and Gate package regression | `PACKAGE_BUILD_VERIFIED` and `SOURCE_TESTED`; local package builds, typechecks, and tests passed for PUBG, Amadeus, Product Radar, and Gate. | Gate's run without `PUBG_SAAS_TEST_DATABASE_URL` skipped 34 PostgreSQL-backed tests (121 passed, 0 failed). M2's database tests were not pointed at any live database. |
| CI and multi-architecture OCI | Workflow YAML parses successfully. The Gate workflow defines an isolated PostgreSQL service and amd64/arm64 OCI verification; Lab CI covers Memory Core admission and package regressions. | GitHub Actions was not run. No OCI image, registry push, tag, or deployment was produced. |

## Validation performed

- Release state and CLI fixtures: protected file mode, non-overwrite, approval
  and actor validation, credential-like reference rejection without echoing the
  supplied value, Lab-only memory evidence guard, synthetic drift states,
  multi-architecture OCI labels, and Lab dry-run with a stubbed `orb`.
- Memory Core admission and image impact fixtures, SemVer helpers, Lab lineage,
  developer workflow, and OpenClaw session-isolation checks.
- Local package builds: `pnpm build:pubg`, `pnpm build:amadeus`,
  `pnpm build:product-radar`, and `pnpm build:pubg-saas`.
- Local typechecks: `pnpm typecheck:pubg`, `pnpm typecheck:amadeus`,
  `pnpm typecheck:product-radar`, and `pnpm typecheck:pubg-saas`.
- Product tests: `pnpm test:pubg`, `pnpm test:amadeus`,
  `pnpm test:product-radar`, and `pnpm test:pubg-saas` with the test database
  variable explicitly unset.
- Architecture, secret, workflow-scope, version, shell/Python syntax, YAML
  syntax, `pnpm workflow:plan`, and `git diff --check` checks.

`pnpm workflow:plan` classifies the Dockerfile changes as
`RELEASE_BUILD_REQUIRED`. Package builds above are local source builds; no
Docker build or Compose action followed. The P3 runbook is
[`docs/RELEASE_ENGINEERING.md`](RELEASE_ENGINEERING.md), and detailed phase
evidence remains in the [P0 audit](LAB_GATE_P0_BASELINE_AUDIT.md), [P1 report](LAB_MEMORY_CORE_P1_REPORT.md),
[P2 report](LAB_GATE_P2_REPORT.md), and [P3 report](LAB_GATE_P3_REPORT.md).

## Completion boundary

P4 source/evidence consolidation is complete. P1 remains
`SOURCE_FIXED + BLOCKED_OPERATOR_AUTHORIZATION`; real Embedding, retrieval,
index rebuild, Dreaming, and post-deploy checks remain open. The individually
reviewable actions and their effects/recovery paths are listed in
[`docs/LAB_GATE_APPROVALS_REQUIRED.md`](LAB_GATE_APPROVALS_REQUIRED.md).

No Lab or Gate runtime was changed. No live secret, production database,
SQLite index, memory file, container, release version, formal tag, or external
registry was changed. Gate M2 remains paused and incomplete.
