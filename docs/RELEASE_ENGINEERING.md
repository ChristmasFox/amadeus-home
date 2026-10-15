# Lab / Gate release engineering

This runbook describes source and runtime release controls. It does not declare
Gate M2 accepted or authorize an apply, tag, registry push, production migration,
or container switch.

## Product identities

| Product | Version | Release notes | Formal tag | Local state |
| --- | --- | --- | --- | --- |
| Lab | Root `VERSION` | Root `RELEASE_NOTES.md` | `lab/vX.Y.Z` | External Lab maintenance profile |
| Gate | `apps/pubg-saas/package.json.version` | `apps/pubg-saas/RELEASE_NOTES.md` | `gate/vX.Y.Z` | Separate environment; M2 remains paused |

Root `package.json.version` is Monorepo metadata. Ordinary commits do not bump
either product. Candidate identity combines the full Git source revision with
each built image digest. The Docker tag is a locator; the recorded image digest
is the artifact identity.

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

All commands default to read-only or local verification:

```sh
scripts/release-lab.sh --help
scripts/release-lab.sh plan
scripts/release-lab.sh verify
scripts/release-lab.sh candidate
scripts/release-lab.sh status --live
scripts/release-lab.sh rollback-plan
```

`plan` wraps the existing `deploy-openclaw.sh` dry-run and image-impact
analysis. It reads live image references to show which images would rebuild;
it does not build or restart containers. `verify` runs the product's local
tests, typechecks, architecture and secret checks. `status --live` reads only
container/image identifiers, health, Compose file SHA-256 values, and a
SHA-256 fingerprint of the OpenClaw runtime config. It does not print config
contents or secrets.

Before a candidate apply, commit the reviewed source and create an external
state directory owned by the operator with mode `0700`. Its parent must also
remain outside Git. The CLI writes each completed manifest with mode `0600`:

```sh
scripts/release-lab.sh candidate --apply --approval-ref <review-id>
scripts/release-lab.sh status --live
```

The candidate uses the existing one-instance OpenClaw deploy path, preserves
the current product version, records the checkpoint, source revision, both
image identities, runtime config/Compose fingerprints, approval and validation
references, and reminds the operator after 48 hours. That reminder never stops
the service. Candidate mode skips the formal release notification and release
maintenance steps.

After candidate validation, prepare Lab's single-release notes and use the
version helper. A formal release requires a separate approval, a protected
external P1 Memory Core evidence JSON, and an explicit local tag action:

```sh
bash scripts/amadeus-version.sh check
scripts/release-lab.sh release --apply \
  --approval-ref <review-id> \
  --memory-acceptance /secure/external/lab-memory-acceptance.json \
  --create-tag
```

The memory evidence must report `LIVE_VERIFIED`, a runtime image digest, and
all required checks: plugin load, real Embedding, keyword FTS, semantic KNN,
hybrid search, incremental refresh, restart persistence, an actual Dreaming
run and persistence, and session isolation. Its accepted source must be an
ancestor of the proposed release and the Memory Core runtime files must be
unchanged since that accepted source. The CLI runs the guarded Lab deployment,
waits for its health checks, creates `lab/vX.Y.Z` only after those checks, then
records the protected manifest. It never pushes the tag. A failed external
manifest write after a successful switch requires manual reconciliation from
the emitted checkpoint; the wrapper does not automatically roll back.

Formal release remains blocked while P1 lacks real acceptance evidence. The
current P1 report is `SOURCE_FIXED + BLOCKED_OPERATOR_AUTHORIZATION`, not
`LIVE_VERIFIED`.

## Gate candidate and promotion flow

```sh
scripts/release-gate.sh --help
scripts/release-gate.sh plan --environment gate-staging
scripts/release-gate.sh verify
scripts/release-gate.sh candidate --environment gate-staging
scripts/release-gate.sh status --environment gate-staging --manifest <external-file> --runtime-snapshot <sanitized-snapshot>
scripts/release-gate.sh rollback-plan --environment gate-staging
```

Gate-Local remains the paused M2 environment. The Gate CLI does not query or
change it. Without a real snapshot from a protected environment adapter,
`status` returns `UNKNOWN`; synthetic snapshots are test evidence only. No
Gate-Staging or Gate-Prod adapter currently exists, so Gate `--apply` fails
closed. Adding an adapter requires a separate reviewed source change and
environment authorization.

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
