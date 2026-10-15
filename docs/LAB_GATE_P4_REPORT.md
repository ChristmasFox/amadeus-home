# Lab / Gate P4 delivery evidence

Date: 2026-10-15 (Asia/Shanghai)
Status: **`SOURCE_EVIDENCE_COMPLETE; LAB_P1_LIVE_VERIFIED_AND_RELEASED; GATE_M2_ACCEPTANCE_OPEN; PRODUCT_RADAR_PROVENANCE_UNKNOWN`**

P4 consolidates the P0–P3 evidence and records what is source-tested, package
built, live-observed, and still awaiting authorization. At the initial source
consolidation it did not certify a formal release; the later Lab release is
recorded in the superseding section below. Gate M2 remains incomplete.

The acceptance matrix below is the P4 phase-close snapshot. Read the
superseding section at the end for current Lab acceptance and release status.

## Acceptance matrix

| Area | Evidence and status | Remaining boundary |
| --- | --- | --- |
| Memory Core plugin/config | `SOURCE_TESTED`; P1 read-only runtime inspection reported the pinned OpenClaw 2026.9.4 `memory-core` enabled and loaded. Config/admission fixtures pass. | No post-change image build or deployment; this does not establish current post-deploy behavior. |
| Embedding | `LIVE_SYNTHETIC_PROBE_PASSED`; one synthetic request to the configured 9Router endpoint returned HTTP 200, 1024 finite dimensions, and 32 input tokens. No memory text was sent. | This proves endpoint reachability, authentication, and response shape, not post-build Memory Core provider readiness. The source patch has not been built into the live image. |
| KNN / FTS | `LIVE_INDEX_ACCEPTANCE_PARTIAL`; after a verified external backup, force reindex completed with 3/3 files, 70 chunks, FTS available, hybrid mode, and `dirty=false`. A keyword query returned 3 results with positive text/vector scores; a paraphrase returned 1 positive vector match. | Modified-file incremental refresh and restart persistence remain unverified. The image containing current Memory Core patches has not been built or deployed. |
| Dreaming | `SOURCE_TESTED`; 03:00 `Asia/Shanghai` schedule and before-read allowlist admission are covered by source fixtures. The authorized controlled run was stopped before invocation. | A metadata-only query later found the pre-existing scheduled job completed at 2026-10-15 03:00 (200245 ms; delivery not requested); the Oct 13 scheduled run failed. The live image lacks the admission marker/function and its sanitized policy allows WhatsApp and Telegram, so source isolation and exact effects are unverified. No transcript or run content was read. The job remains enabled; next due 2026-10-16 03:00. |
| Session isolation | `SOURCE_TESTED`; peer allow/deny, missing/revoked/malformed allowlists, and admission-before-transcript-read fixtures pass. | The live image does not contain the admission patch, so runtime enforcement is not verified. The Dreaming acceptance stopped before any transcript read. |
| Lab / Gate versions | `SOURCE_TESTED`; Lab SemVer transitions and Gate's independent version path pass sandbox tests. Current sources remain Lab `1.10.4` and Gate `0.1.0`. | No version bump or product tag was created. |
| Build impact | `SOURCE_TESTED`; a Memory Core patch-only change forces OpenClaw rebuild, shared Domain changes affect Lab and Gate, Presentation changes affect all consuming images, and unknown Docker inputs fail conservatively. | No Docker/OCI image was built. |
| Provenance and drift | `SOURCE_TESTED`; synthetic digest, source, Compose/config, health, tag, and expiry cases pass. A fresh read-only Lab snapshot observed both services healthy. | The doctor reports `UNKNOWN` because no protected manifest exists. Product Radar's legacy tag names an unreachable source SHA and its product version is unavailable. Gate has no configured environment adapter. |
| Rollback and persistence | `SOURCE_TESTED`; recovery paths and SQLite/PostgreSQL boundaries are documented; synthetic manifest and fail-closed cases pass. A protected online SQLite backup was verified before the authorized derived-index rebuild. | No full restore rehearsal or database-volume operation was performed. The pre-write backup remains available; no rollback was needed. |
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

The baseline read-only Lab snapshot was captured at `2026-10-15T12:29:17Z`.
OpenClaw was healthy at image digest
`sha256:4f114efaca19335424915fdc7d365b03d7af474354fe49ff8ced4581f932dc9f`;
its immutable tag resolves to the full source SHA and Lab `1.10.4`. Product
Radar was healthy at digest
`sha256:1f708837c5d55fcb608108621d74402936a767397fb76af0b4c9c4fc655e396b`,
but its source/version are unknown because the tagged `633dd216` commit is not
reachable and the legacy image lacks the product provenance marker. The
snapshot contains Compose/config hashes only, not their contents. No runtime
write occurred during that P4 snapshot.

## Subsequent authorized Lab acceptance — 2026-10-15

After the P4 source/evidence consolidation, the separately authorized Lab
sequence completed one synthetic Embedding probe and a backed-up derived-index
rebuild. Detailed sanitized evidence is in
[`LAB_MEMORY_CORE_P1_REPORT.md`](LAB_MEMORY_CORE_P1_REPORT.md) and the
pre-write checkpoint is `.agent/checkpoints/2026-10-15-lab-memory-reindex-prewrite.md`.
The controlled Dreaming acceptance then stopped before invocation because the
current image lacks the source admission guard. A later metadata-only query
found a separate automatic scheduled run at 2026-10-15 03:00 Asia/Shanghai;
its source isolation and exact effects remain unverified, and the next run is
due 2026-10-16 03:00 while the existing job remains enabled. No run content was
read and no cron change was made. No candidate image, deployment, release
version, tag, or registry publish was created. No Gate runtime, PostgreSQL
data, session history, source memory file, or credential was changed.

## Completion boundary

P4 source/evidence consolidation is complete. P1 remains `SOURCE_FIXED`, with
partial live evidence for Embedding and index retrieval; `LIVE_VERIFIED` is
not established. Incremental refresh, restart persistence, runtime admission,
Dreaming, candidate build, and post-deploy checks remain open. The ordered Lab
acceptance stopped at item 4 before candidate build. The individually
reviewable actions and their effects/recovery paths are listed in
[`docs/LAB_GATE_APPROVALS_REQUIRED.md`](LAB_GATE_APPROVALS_REQUIRED.md).

No Lab or Gate service was restarted or replaced. The authorized derived
SQLite index was rebuilt after backup; no session-history database, production
PostgreSQL, source memory file, live secret, container definition, release
version, formal tag, or external registry was changed. Gate M2 remains paused
and incomplete.

## Superseding Lab acceptance and release — 2026-10-15

The preceding completion-boundary snapshot is historical. After separate
Lab-only authorization, the 1.10.5 candidate containing before-read peer
admission was built and applied through the guarded release/deploy path. P1
acceptance is now `LIVE_VERIFIED`: the protected evidence validates all
required checks, including the real 9Router 1024-dimension response, keyword
and semantic retrieval, incremental indexing, clean `dirty=false` state,
Dreaming execution/persistence, and source isolation. The index had 5 files /
92 chunks and remained clean after an already completed rollback restart;
this persistence evidence required no restart in the correction continuation.
Dreaming read one owner-allowlisted workspace, excluded groups/channels, and
the metadata privacy scan found no phone-number or peer-ID matches. The
existing 03:00 Asia/Shanghai schedule remains enabled and unchanged.

Lab 1.10.5 is `BUILD_VERIFIED`, `LIVE_VERIFIED`, and `RELEASED`; its local
annotated tag is `lab/v1.10.5`. The current live OpenClaw image is healthy and
the released manifest status is `IN_SYNC`. The formal promotion made no
container switch. Since Arthur's correction, no Lab config edit, restart,
index write, image build, or release action occurred. The withdrawn
Dreaming-enable/restart authorization is not active.

Remaining boundaries are product-specific: GitHub Actions has not run because
the branch was not pushed; publishing remains separately unauthorized; Gate
M2's human KOOK acceptance/Go-No-Go remains open and M2 was not resumed. The
current Product Radar image is healthy but its legacy source/version remain
`UNKNOWN`; the read-only plan selects a rebuild, and its current apply path
would also reconcile/restart OpenClaw, so no Product Radar operation was
attempted. The later source guard blocks that Radar-only apply before build or
checkpoint; no isolated Product Radar apply path exists yet. These limits do
not change Lab OpenClaw's verified release status.

## Local source verification refresh — 2026-10-16

The Gate PostgreSQL suite was run locally against a new isolated `pubg_test`
database using the workflow image
`postgres:18.1-bookworm@sha256:cc9f4143a8d2fa8cf3749d0cb4d26ecf2d53a77a2ac807e9ebd67ae22426221a`.
Host port `55439` was loopback-only, the data directory was tmpfs-backed, and
the container was capped at 768 MiB / 1 CPU and removed after the run.
`scripts/validate-pubg-saas-test-database.py` accepted the target;
`pnpm test:pubg-saas` passed 155/155 with zero skips. No Gate-Local M2 database
or service was queried or changed.

The private `pnpm test:pubg` suites passed 71/71, `pnpm test:workflow` passed,
and `python3 scripts/test-release-tooling.py` passed its synthetic manifest,
drift, OCI attestation, CLI-guard, and test-target cases. The database-backed
source regression is now locally verified, but GitHub Actions remains unrun
because this branch has not been pushed. Publishing/pushing still requires its
separate approval. Arthur's real KOOK acceptance and M2 Go/No-Go remain open;
no OCI build, registry push, Lab/Gate deployment, or formal Gate release was
performed.
