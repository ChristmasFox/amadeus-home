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
| KNN / FTS | `LIVE_INDEX_STATUS_OBSERVED`; the latest read-only check reports 1024 dimensions, FTS enabled/available, hybrid mode, 2 indexed files, 70 chunks, and `dirty=true`; the scanner sees 3 files. Source audit confirms optional-provider loss retains FTS keyword results. A pinned source patch now reports `mode=fts-only` when FTS remains available, or `unavailable` otherwise. | The index is stale. No semantic paraphrase query, hybrid retrieval query, incremental refresh, forced rebuild, or restart-persistence check was run. The explicit mode patch is not built into the running image. Index status is not retrieval acceptance. |
| Dreaming | `SOURCE_TESTED`; 03:00 `Asia/Shanghai` schedule and allowlist admission are covered by source fixtures. | Prior read-only inspection had no run-history record or eligible corpus. No actual Dreaming run, candidate write, or persistence claim is made. |
| Session isolation | `SOURCE_TESTED`; peer allow/deny, missing/revoked/malformed allowlists, and admission-before-transcript-read fixtures pass. | Real transcript reads and memory writes were not authorized or performed. |
| Lab / Gate versions | `SOURCE_TESTED`; Lab SemVer transitions and Gate's independent version path pass sandbox tests. Current sources remain Lab `1.10.4` and Gate `0.1.0`. | No version bump or product tag was created. |
| Build impact | `SOURCE_TESTED`; a Memory Core patch-only change forces OpenClaw rebuild, shared Domain changes affect Lab and Gate, Presentation changes affect all consuming images, and unknown Docker inputs fail conservatively. | No Docker/OCI image was built. |
| Provenance and drift | `SOURCE_TESTED`; synthetic digest, source, Compose/config, health, tag, and expiry cases pass. A fresh read-only Lab snapshot observed both services healthy. | The doctor reports `UNKNOWN` because no protected manifest exists. Product Radar's legacy tag names an unreachable source SHA and its product version is unavailable. Gate has no configured environment adapter. |
| Rollback and persistence | `SOURCE_TESTED`; recovery paths and SQLite/PostgreSQL boundaries are documented; synthetic manifest and fail-closed cases pass. | No restore rehearsal or volume/database operation was performed. |
| Lab and Gate package regression | `PACKAGE_BUILD_VERIFIED` and `SOURCE_TESTED`; local package builds, typechecks, and tests passed for PUBG, Amadeus, Product Radar, and Gate. The Gate release CLI now preflights its database target. | The earlier Gate run without `PUBG_SAAS_TEST_DATABASE_URL` skipped 34 PostgreSQL-backed tests (121 passed, 0 failed). The new fixture proves `verify` stops before tests when the URL is missing and rejects remote, non-test, or query-overridden targets. No database-backed suite was rerun here; M2's database was not touched. |
| CI and multi-architecture OCI | Workflow YAML parses successfully. The Gate workflow defines an isolated PostgreSQL service, validates its `pubg_test` target, and performs amd64/arm64 OCI verification; Lab CI covers Memory Core admission, merged-config behavior, and the pinned OpenClaw 2026.9.4 schema check. | GitHub Actions was not run. No OCI image, registry push, tag, or deployment was produced. |

## Validation performed

- Release state and CLI fixtures: protected file mode, non-overwrite, approval
  and actor validation, credential-like reference rejection without echoing the
  supplied value, Lab-only memory evidence guard, product-scoped CLI help,
  synthetic drift states, multi-architecture OCI labels, and Lab dry-run with
  a stubbed `orb`.
- Memory Core admission and image impact fixtures, SemVer helpers, Lab lineage,
  developer workflow, and OpenClaw session-isolation checks.
- Provider-outage source fixture confirms `fts-only` is reported while explicit
  partial-keyword mode and normal hybrid mode keep their existing precedence.
- Gate release tooling fixtures confirm the loopback/test-name database
  preflight, reject query-parameter host overrides, and ensure missing/remote
  targets fail before tests without printing URL credentials.
- `python3 scripts/test-openclaw-group-image-policy.py` passed all 6 tests
  without skips; its pinned-runtime schema check is now wired into Lab CI.
- The current pinned compiled tools bundle accepted the new patch digest and
  passed a local JavaScript syntax check; no image build or runtime write ran.
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

The latest read-only Lab snapshot was captured at `2026-10-15T12:29:17Z`.
OpenClaw was healthy at image digest
`sha256:4f114efaca19335424915fdc7d365b03d7af474354fe49ff8ced4581f932dc9f`;
its immutable tag resolves to the full source SHA and Lab `1.10.4`. Product
Radar was healthy at digest
`sha256:1f708837c5d55fcb608108621d74402936a767397fb76af0b4c9c4fc655e396b`,
but its source/version are unknown because the tagged `633dd216` commit is not
reachable and the legacy image lacks the product provenance marker. The
snapshot contains Compose/config hashes only, not their contents. No runtime
write occurred.

## Completion boundary

P4 source/evidence consolidation is complete. P1 remains
`SOURCE_FIXED + BLOCKED_OPERATOR_AUTHORIZATION`; real Embedding, retrieval,
index rebuild, Dreaming, and post-deploy checks remain open. The individually
reviewable actions and their effects/recovery paths are listed in
[`docs/LAB_GATE_APPROVALS_REQUIRED.md`](LAB_GATE_APPROVALS_REQUIRED.md).

No Lab or Gate runtime was changed. No live secret, production database,
SQLite index, memory file, container, release version, formal tag, or external
registry was changed. Gate M2 remains paused and incomplete.
