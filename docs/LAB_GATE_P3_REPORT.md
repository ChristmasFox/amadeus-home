# Lab / Gate release engineering P3 report

Date: 2026-10-15 (Asia/Shanghai)
Status: **`SOURCE_COMPLETE_WITH_GATE_ENVIRONMENT_APPLY_BLOCKED`**
Scope: product release CLIs, protected manifest/status tooling, build impact,
OCI provenance, shared CI and operational documentation. No runtime service,
database, secret, image, release tag, or registry was changed.

## Release entry points

- `scripts/release-lab.sh` exposes `plan`, `verify`, `candidate`, `release`,
  `status`, and `rollback-plan`. Its apply path delegates to the existing
  `scripts/deploy-openclaw.sh`, requires `--apply` plus a non-secret
  `--approval-ref`, and requires a clean committed tree. Candidate keeps the
  Lab version and uses the existing single-instance candidate path. Formal
  release requires `--create-tag` and an external P1 Memory Core acceptance
  report. It creates `lab/vX.Y.Z` only after deployment health passes; it does
  not push the tag.
- After a successful Lab candidate or release, the wrapper reads a sanitized
  actual runtime snapshot and writes a new external mode-0600 manifest under
  an already-protected mode-0700 state directory. Existing records cannot be
  overwritten. If post-switch manifest recording fails, the wrapper reports
  that state explicitly and preserves the deploy checkpoint for reconciliation;
  it does not automatically roll back.
- `scripts/release-gate.sh` exposes the same planning, verification, status,
  and rollback-plan commands. At report time, Gate-Local apply was rejected
  while M2 was paused. Policy was updated on 2026-10-16: safe Gate-Local
  candidates may now deploy with M2 still paused and without M2 clearance.
  Gate-Staging/Prod apply is rejected until a reviewed source-controlled
  environment adapter exists. Its help is scoped to Gate environment,
  approval, tag, and manifest options and states the adapter boundary; it no
  longer lists Lab-only build, lineage, or memory evidence flags. The help fix
  and its regression fixture are in commit `8d1c62e`. `verify` now requires a
  validated loopback test database before invoking the SaaS suite, so missing
  or unsafe targets cannot silently skip PostgreSQL-backed cases. The
  database guard is in `af48ed6`. No Gate environment was queried or modified.
- A current `release-gate.sh --help` check caught unquoted heredoc expansion:
  shell treated the documented test-database variable and backticked names as
  commands, emitted errors, and omitted the literal constraints. `release-cli.sh`
  now prints the product usage line separately and uses a quoted heredoc for
  option text. The regression fixture requires empty stderr and the literal
  database-variable and name constraints in Gate help. The fix and fixture
  are committed as `d712cb3`.
- `scripts/release-state.py` validates and writes manifests and compares them
  with runtime snapshots. It checks the product tag, per-image source/version/
  build provenance, digest, Compose image reference and Compose file digest,
  service health/state, schema version, and the Lab OpenClaw config fingerprint.
  It returns `UNKNOWN` when evidence is absent. A candidate older than 48 hours
  produces a review reminder with `AUTOMATIC_ACTION=none`.
- `scripts/validate-lab-memory-acceptance.py` blocks a formal Lab release until
  an external `LIVE_VERIFIED` report records the required real checks and its
  accepted runtime source remains unchanged in the proposed release.

## Build impact and artifact provenance

- `scripts/image-impact.py` parses Dockerfile `COPY`/`ADD` and BuildKit bind
  inputs, then computes each image's workspace dependency closure from package
  manifests. Lock/workspace/root metadata and `.dockerignore` affect every
  image. Unparseable Docker inputs return `UNKNOWN`, which the Lab deploy
  wrapper treats as a rebuild. Git changes include staged, unstaged,
  untracked, deleted, and renamed paths.
- The reproduced P0 false negative is fixed: changing only
  `scripts/patch-openclaw-memory-core.mjs` classifies OpenClaw for rebuild.
  PUBG Domain changes classify Lab plus Gate; Presentation changes classify
  OpenClaw, Product Radar, and Gate. Docs and unrelated scripts reuse images.
- OpenClaw, Product Radar, and Gate OCI images receive labels for full source
  revision, product version, build time, and the product-owned
  `com.amadeus.release.provenance` marker. The Lab runtime reader trusts those
  labels only when that marker is present, so labels inherited from an upstream
  base image cannot masquerade as Lab provenance. Legacy images fall back to
  immutable tag plus reachable Git source; an unreachable source remains
  unavailable. Gate's multi-platform OCI checker verifies amd64/arm64 config
  hashes and provenance labels. No image was built during this phase. The
  lineage parser accepts legacy 12-digit and current 14-digit UTC tag
  timestamps; a missing source commit still requires the existing explicit
  two-image lineage bridge.
- Added `lab-source.yml` so shared Domain/Presentation changes run Lab tests;
  the existing Gate workflow runs its product tests and multi-architecture OCI
  build. Both workflows are read/test/build only. Neither contains a registry
  publish, release-tag, or deploy step.

## Validation

Passed focused local fixtures and source checks:

- `python3 scripts/test-image-impact.py`
- `python3 scripts/test-release-tooling.py` — manifest file permissions,
  digest/config/health drift, 48-hour reminder, synthetic OCI platforms and
  labels, CLI approval/actor/reference guards, memory-evidence option guards,
  product-specific CLI help, output non-disclosure, and Lab candidate dry-run
  with a stubbed `orb`
- Gate test-database fixtures — accepts only loopback `test`/`testing` or
  `_test`/`_testing` database names, rejects URI query/fragment overrides, and
  verifies missing/remote targets fail before package tests without printing
  URL credentials
- `python3 scripts/test-release-tooling.py` passes with the new no-shell-
  expansion help checks; `bash -n scripts/release-cli.sh` passes, and actual
  Gate help prints the complete test-database requirement without stderr.
- `python3 scripts/test-lab-memory-acceptance.py` — incomplete live checks and
  post-acceptance Memory Core source drift fail closed
- `bash scripts/test-developer-workflow.sh`
- `bash scripts/test-openclaw-lineage-compatibility.sh`
- `bash scripts/amadeus-version.sh check`
- `bash scripts/pubg-saas-version.sh check`
- shell syntax and Python compilation checks
- `pnpm test:workflow`
- `pnpm check:architecture`
- `pnpm check:secrets`
- `git diff --check`
- `pnpm workflow:plan` classified the combined Dockerfile/source set as
  `RELEASE_BUILD_REQUIRED`; Docker build and Compose remain unrun.

The first `pnpm workflow:plan -- ...` attempt used unsupported argument
forwarding; the direct `scripts/developer-workflow.sh --files ...` invocation
then classified the release tooling itself as `FAST`. PyYAML is unavailable.
Both workflow files pass the system Ruby YAML parser; this checks YAML syntax
only, not GitHub Actions schema semantics. No external dependency was installed
and Actions itself was not run.

## Limits and recovery notes

- A read-only `scripts/release-lab.sh status --live` follow-up at
  `2026-10-15T12:29:17Z` successfully captured both Lab services. OpenClaw was
  healthy at digest
  `sha256:4f114efaca19335424915fdc7d365b03d7af474354fe49ff8ced4581f932dc9f`;
  its legacy image tag resolves to source
  `4a5734826eca479f59a2fd039fd12f9ff5d03580` and Lab `1.10.4`. Product Radar
  was healthy at digest
  `sha256:1f708837c5d55fcb608108621d74402936a767397fb76af0b4c9c4fc655e396b`,
  but its `633dd216` image source is absent from the current Git object database
  and the old image has no product-owned provenance marker. Its source and
  product version therefore remain unavailable. The drift doctor returned
  `UNKNOWN` because there is no protected release manifest. The adapter now
  handles absent Docker label maps and rejects inherited base-image labels as
  product provenance. This provenance and Memory Core status follow-up is
  committed as `48b88ac`; no image was built from it.
- The P1 report remains `SOURCE_FIXED + BLOCKED_OPERATOR_AUTHORIZATION`; no
  external `LIVE_VERIFIED` report exists. The formal release command therefore
  remains blocked.
- Gate M2 remains paused. Gate-Staging and Gate-Prod have no host profiles or
  release adapters. `status` without a sanitized real snapshot returns
  `UNKNOWN`; synthetic fixtures are not live evidence.
- Release manifests and runtime snapshots contain only non-secret identifiers,
  image digests, health, and file hashes. The actual state directory and
  manifest records are not in Git.
- No Docker build ran. The earlier P1 candidate deploy fixture remains
  unverified because the configured OrbStack machine lacks
  `node:22-bookworm-slim`; that test created no container.
- No candidate apply, release, tag, push, database migration, secret change,
  Embedding request, memory rebuild, or Compose operation ran.

## Subsequent authorized Lab candidate and release — 2026-10-15

After the source-only P3 phase, Arthur separately authorized the Lab-only
candidate sequence. The 1.10.5 OpenClaw image was built from
`57e472ebe014a0b4d3574d7ef30107340dc99308` at
`sha256:4cb3c044925bb371b7232e47520b04d17633862549b9e315e555fbc9ce7aefd9`;
it includes the before-read peer-admission patch. Candidate application went
through `scripts/release-lab.sh candidate` and the existing
`scripts/deploy-openclaw.sh` guarded path, with an external protected
pre-switch checkpoint. No bare Compose apply was used. Post-switch health,
retrieval, source admission, and the later controlled Dreaming/index evidence
are detailed in the P1 report and release checkpoint.

After the P1 evidence validator returned `LIVE_VERIFIED`, formal promotion
created local tag `lab/v1.10.5`, wrote the protected external released manifest,
and delivered the formal owner notification. Promotion reused the live
candidate digest without a container switch. A fresh read-only
`scripts/release-lab.sh status --live --manifest <released-manifest>` at
`2026-10-15T15:40:47Z` returned `DRIFT_STATUS=IN_SYNC` for OpenClaw.

This continuation also fixed a potentially unbounded snapshot query in
`scripts/lab-runtime-snapshot.py` (`2e9f66c`): config and Compose hashes now use
direct `sha256sum` calls with a 30-second subprocess timeout, with a focused
timeout/fail-closed fixture. A fresh runtime snapshot completed successfully.
No Product Radar rebuild/apply was performed: its legacy image source remains
unavailable, and the current `--build-radar` apply path would also reconcile
and restart OpenClaw. Gate remains paused; no Gate apply, DB action, image
build, tag, or release was performed in this continuation.

## Product Radar-only apply guard — 2026-10-15

The Lab deployment script now rejects apply when only Product Radar is selected
for a fresh build, including `--build-auto` when OpenClaw is reusable. This
prevents the Lab-default deployment path from restarting OpenClaw for a Radar-
only source drift. `scripts/test-deploy-radar-only-apply.py` uses a synthetic
OrbStack stub to verify explicit and automatic rejection while preserving the
Radar-only dry-run; the stub records only image inspection and no build or
Compose command. The separate Product Radar apply path remains an open source
engineering limitation. No image build or runtime operation was performed.

## Gate OCI verifier and CI semantics follow-up — 2026-10-16

BuildKit OCI archives may include attestation manifests beside runnable
platform images. The verifier previously treated an attestation's synthetic
`unknown/unknown` config as a runnable image and checked it for Gate product
labels. Commit `5a6a81f` now skips config/platform/provenance checks only for
descriptors marked as attestations, while retaining blob digest validation
and requiring both `linux/amd64` and `linux/arm64` runnable images. The
synthetic OCI fixture includes attestation manifests and verifies that a wrong
product version still fails. `python3 scripts/test-release-tooling.py` passed.

Commit `b143ab1` also removes a race in the durable KOOK ingress test by
waiting for both the handler count and durable sequence before asserting the
blocked-handler state. Gate validation passed `pnpm typecheck:pubg-saas`,
`pnpm test:pubg-saas` (155/155, zero skips), `pnpm typecheck:pubg`,
`pnpm test:pubg` (71/71), architecture and secret checks, and `git diff
--check`. The PostgreSQL suite used a disposable loopback-only, tmpfs-backed
PostgreSQL 18.1 fixture and removed its exact container afterward; M2's
existing database and services were not queried or changed.

The official actionlint v1.7.12 macOS ARM64 release was SHA-256 verified and
passed against all five `.github/workflows/*.yml` files. Its binary was
removed after use. GitHub-hosted Actions have not run because these local
source commits have not been pushed; this report does not claim a remote CI
run. No image build, runtime deploy, database migration, tag, release, or push
occurred for this follow-up.
