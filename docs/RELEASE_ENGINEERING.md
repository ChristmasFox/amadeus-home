# Lab / Gate release engineering

This runbook describes source and runtime release controls. Lab publication is
the automatic one-stage main-merge path below. Gate M2 remains paused, and this
runbook does not authorize Gate-Staging/Prod promotion.

## Product identities

| Product | Version | Release notes | Formal tag | Local state |
| --- | --- | --- | --- | --- |
| Lab | Root `VERSION` | Root `RELEASE_NOTES.md` | `lab/vX.Y.Z` | External Lab maintenance profile |
| Gate | `apps/pubg-saas/package.json.version` | `apps/pubg-saas/RELEASE_NOTES.md` | `gate/vX.Y.Z` | Separate environment; M2 remains paused |

Root `package.json.version` is Monorepo metadata. Lab feature PRs do not carry a
separate version-only PR: after a green main merge, the M204 deploy timer adds
the next patch version and one release note as a bot commit. Gate versions
remain independent. The recorded image digest is the artifact identity; the
Docker tag is a locator.

New image builds carry OCI labels for source revision, product version, and
build timestamp, plus
`com.amadeus.release.provenance=amadeus-product-release-v1`. The marker
distinguishes product values from labels inherited from an upstream base
image. The Lab runtime reader trusts standard labels only when this marker is
present; legacy images fall back to an immutable tag and reachable Git source,
otherwise provenance remains unknown. Gate CI verifies labels and the marker
in both amd64 and arm64 OCI images and verifies descriptor/config hashes. CI
builds and tests on PRs and main pushes; it does not create release tags, push
a registry image, or deploy. Changes under `packages/pubg-domain` trigger Lab
and Gate checks; `packages/presentation` triggers Lab, Product Radar, and Gate
checks.

## Lab command flow

The normal Lab release is one automatic operation after a PR is merged to
`main` and the `lab-regression` check passes. A short M204 launchd timer reads
GitHub's check status; it does not expose the private Lab host to GitHub Actions
and does not run on Gate.

```sh
scripts/release-lab.sh --help
scripts/release-lab.sh plan
scripts/release-lab.sh verify
scripts/release-lab.sh status --live
scripts/release-lab.sh rollback-plan
python3 scripts/lab-auto-release.py status
```

The read-only `release-lab.sh` commands remain useful for planning, local
verification and runtime inspection. Manual Lab `candidate` and `release`
promotion commands have been retired. The M204 timer increments the root
`VERSION` patch, writes the matching single-release note, commits both files to
`main` without a separate version PR, waits for that commit's CI, and then:

1. Creates and verifies a protected external Lab checkpoint.
2. Builds an immutable OpenClaw image from the versioned main commit.
3. Switches only the OpenClaw Compose image.
4. Requires OpenClaw container health, WhatsApp linked/running/connected, and
   a real native PUBG stats query.
5. On any failed post-switch check, restores the prior Compose image/config and
   verifies the prior container health and health endpoint. Persistent user
   data is preserved.
6. On success, records the released runtime manifest, pushes `lab/vX.Y.Z`, and
   creates the GitHub Release from `RELEASE_NOTES.md`.

The timer stores only its small control state under
`~/.local/state/amadeus/lab-auto-release` (mode `0700`); deployment logs and
release manifests stay outside Git with mode `0600`. It retries a rolled-back
deployment after a short cooldown. Remove the scheduled job with
`python3 scripts/lab-auto-release.py uninstall`; protected backups and release
records remain available for recovery.

## Gate candidate and promotion flow

```sh
scripts/release-gate.sh --help
scripts/release-gate.sh plan --environment gate-staging
scripts/release-gate.sh verify
scripts/release-gate.sh candidate --environment gate-staging
scripts/release-gate.sh status --environment gate-staging --manifest <external-file> --runtime-snapshot <sanitized-snapshot>
scripts/release-gate.sh rollback-plan --environment gate-staging
```

Gate M2 remains paused. The protected Gate-Local candidate path may switch a
safe application candidate while preserving that pause; it neither resumes
M2 nor creates M2 clearance. Without a real snapshot from a protected
environment adapter, `status` returns `UNKNOWN`; synthetic snapshots are test
evidence only. No Gate-Staging or Gate-Prod adapter currently exists, so those
Gate `--apply` operations fail closed. Adding an adapter requires a separate
reviewed source change and environment authorization.

`release-gate.sh verify` now refuses to run the SaaS suite without
`PUBG_SAAS_TEST_DATABASE_URL` targeting loopback and a database named `test`,
`testing`, or with a `_test`/`_testing` suffix. This prevents the release check
from silently passing while PostgreSQL-backed tests are skipped and keeps the
test runner away from a remote/shared database. URI query parameters and
fragments are rejected so they cannot override connection fields. GitHub
Actions validates its isolated `pubg_test` service with the same check.

The eventual promotion path builds one Gate image for a committed source,
records its multi-platform digest, and promotes that exact digest from
Gate-Local to Gate-Staging and then Gate-Prod without rebuilding. Each
environment must use its own credentials, database, session data, and Bot
identity. The public registry, cloud host, and Gate-Prod remain separate
approval decisions.

Before a Gate migration, verify the exact image and schema contract, validate
the current database, create and verify a protected encrypted backup, and
confirm the migration is idempotent and compatible with both the old and new
application versions. Run the one-shot Migrator first with the same image
digest as Gateway and Worker. Verify the resulting schema and constraints,
then replace Gateway and Worker in a controlled order and check health and
KOOK connection state. Keep the PostgreSQL volume throughout. Application
rollback is allowed only when the new schema remains backward compatible;
otherwise use a reviewed forward repair or a specific recovery plan. The
whole PostgreSQL volume is not an automatic rollback target.

## Manifests and drift doctor

`infra/release/release-manifest.template.json` is a template only. Runtime
records are written outside Git under the protected state directory. The
manifest records product/environment/status, product version, full release
source SHA, every controlled image reference and digest, per-image provenance,
build/deploy times, schema version, checkpoint, actor, approval, and validation
references. The Lab runtime record also stores SHA-256 fingerprints of the
actual Compose files and the final OpenClaw config, never those file contents.

The runtime doctor compares the manifest with a fresh runtime snapshot and the
product tag. It reports `IN_SYNC`, `UNRELEASED_CANDIDATE`, `SOURCE_DRIFT`,
`IMAGE_DRIFT`, `RUNTIME_DRIFT`, or `UNKNOWN`. At 48 hours it prints a review
reminder and records `AUTOMATIC_ACTION=none`. It does not restart, overwrite,
roll back, or push images.

```sh
scripts/release-lab.sh status --live
scripts/release-gate.sh status --environment gate-staging \
  --manifest /secure/state/gate-gate-staging-<timestamp>-candidate.json \
  --runtime-snapshot /secure/status/gate-staging-runtime.json
```

`release-state.py write` and `compose` require `--apply`, an existing external
mode-0700 state directory, a new output path, and a valid manifest. They never
overwrite an existing record. `release-state.py doctor` is read-only.

## Build impact and lineage

`scripts/image-impact.py` reads the active Dockerfile's local `COPY` and
BuildKit bind-mount inputs and computes the workspace dependency closure for
each image. `pnpm-lock.yaml`, workspace metadata, root package metadata, and
`.dockerignore` conservatively affect every image. A Dockerfile construct the
analyzer cannot prove returns `UNKNOWN`, which triggers a rebuild. Git moves
and deletions are considered; untracked non-ignored build inputs are included
in dry-run analysis. Image builds themselves remain opt-in through the release
workflow.

Lab accepts legacy 12-digit image build timestamps and current 14-digit
timestamps when resolving source lineage. An unavailable source commit still
requires the existing explicit full two-image `--lineage-bridge`; the release
CLI does not force or synthesize lineage.

## Rollback

`rollback-plan` is read-only. Lab recovery uses the protected deploy checkpoint
and saved Compose files; it preserves live SQLite/WAL, Workspace, and memory
files, and does not restore an old whole-data snapshot over newer writes. Gate
recovery keeps PostgreSQL in place and follows schema compatibility. Any
actual recovery needs a separate explicit approval and a reviewed checkpoint.
