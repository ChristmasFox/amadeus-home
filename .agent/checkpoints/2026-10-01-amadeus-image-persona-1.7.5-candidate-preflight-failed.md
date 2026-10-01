# Amadeus image persona 1.7.5 — candidate preflight stopped before apply

Date: 2026-10-01 (Asia/Shanghai)
Status: `HARD_GATE_FAILED_BEFORE_RUNTIME_SWITCH`

## Source and validation

- Implementation/version source commit: `a242570` (`feat(amadeus): natural image lifecycle messaging 1.7.5`), pushed to `origin/main`.
- Canonical source `VERSION`: `1.7.5`.
- Focused image lifecycle/delivery tests, full `pnpm test:amadeus` (107 plugin tests), `pnpm test:delivery` (73 tests plus the pinned integration AST/provider contract), `pnpm typecheck:amadeus`, `pnpm build:amadeus`, `pnpm check:architecture`, candidate-deploy fixture, `pnpm check:secrets`, version check, and `git diff --check` passed.

## Immutable candidate hard-gate failure

- Candidate tag: `local/openclaw-amadeus:git-a24257068abe-20261001055126`.
- Candidate manifest: `sha256:f5897a41061d03ac7f38cc3c09dc6fe67fa9ab1da7a1a45bc8e10db86b647976`.
- Image syntax/node preflight passed.
- Required runtime product-version preflight failed: the candidate contains `/opt/amadeus/VERSION` with mode `0600`; the image's default `node` user cannot read it (`Permission denied`). A root-only read confirmed mode `600`; the required default-user read failed.
- Deployment script exited non-zero at candidate validation. No protected production checkpoint was created because the gate precedes checkpoint creation. No Compose update, OpenClaw restart, plugin patch, release notification, or production apply occurred.

## Rollback / current production verification

This was a pre-switch abort, so the previous production runtime never left service; no runtime restore was needed. Direct post-failure verification:

- Running image remains `local/openclaw-amadeus:git-628703c803e7-20260930184906`.
- Its source commit resolves to `VERSION=1.7.4`.
- OpenClaw `/healthz` is healthy.
- Existing Amadeus Gateway registration is present.
- Candidate tag is not running in any container.

The rejected candidate remains only as a local build artifact and must not be applied. Manual owner WhatsApp acceptance remains operator-waived, but no post-deploy technical acceptance was performed because apply was correctly stopped.

## Required before any new rollout attempt

Treat this release attempt as halted, not as permission to bypass or repeat a failed gate. If a later authorized continuation is made, fix the image-file permissions in source (make `/opt/amadeus/VERSION` readable by the runtime `node` user), add/adjust the preflight regression, rerun the required validation and candidate build, then create a protected rollback checkpoint before any production switch. The live runtime remains 1.7.4 until a fully validated later apply.


## Remediation source (not a production apply)

Commit `431d90f` corrects the candidate permission defect: Dockerfile normalizes the baked version file to 0644, and `scripts/amadeus-version.sh` now writes canonical version files as 0644; fixture assertions cover both. This remediation does not make the rejected `a242570` candidate valid. Any new candidate must be built from the corrected commit and revalidated from the beginning.
