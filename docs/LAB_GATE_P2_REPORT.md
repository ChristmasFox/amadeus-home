# Lab / Gate independent versioning P2 report

Date: 2026-10-15 (Asia/Shanghai)  
Status: **`SOURCE_COMPLETE`**  
Scope: product version sources, SemVer helpers, release-note validation,
Gate CI checks, and release documentation. No product version was bumped, no
formal tag was created, and no build or runtime deployment was performed.

## Version sources and behavior

- Lab remains at root `VERSION=1.10.4`; root `RELEASE_NOTES.md` remains the
  single-release note for that version. `scripts/amadeus-version.sh` remains
  the compatible Lab entry point and now supports standard `patch`, `minor`,
  and `major` increments. Its parser rejects numeric identifiers with leading
  zeroes. A patch at 9 now advances to 10 rather than carrying to the minor.
- Gate remains at `apps/pubg-saas/package.json` version `0.1.0`. The root
  `package.json.version` remains Monorepo metadata. Gate has its own
  `apps/pubg-saas/RELEASE_NOTES.md` and
  `scripts/pubg-saas-version.sh` with independent show/check/notes/bump
  commands. The notes identify 0.1.0 as a development baseline and explicitly
  do not claim M2 acceptance or Gate-Prod launch.
- New formal tags are `lab/vX.Y.Z` and `gate/vX.Y.Z`; existing historical
  `v1.10.4` is unchanged. Candidate identity remains Git SHA plus immutable
  image digest. Version tools do not create tags or deploy.
- The Gate GitHub Actions workflow now validates Gate version/release notes
  and runs its SemVer fixture test on relevant PR and main changes. Its
  workflow has no registry publish or deployment step.
- Root guidance, architecture, developer workflow, and product READMEs now
  describe the independent version sources and Gate's same-digest promotion,
  migrator/schema compatibility, and recovery constraints.

## Validation

Passed:

- `bash scripts/amadeus-version.sh check`
- `bash scripts/test-amadeus-version.sh` — patch/minor/major transitions,
  ordinary patch carry, leading-zero rejection, and notes validation
- `bash scripts/pubg-saas-version.sh check`
- `bash scripts/test-pubg-saas-version.sh` — independent Gate transitions,
  leading-zero rejection, and one-version notes validation
- `pnpm check:architecture`
- `pnpm check:secrets`
- `git diff --check`
- `pnpm workflow:plan` — `FAST`; Docker build forbidden; 11 changed paths

Current source checks report Lab `1.10.4` and Gate `0.1.0`. No version file
was changed by the fixture tests. No live Gate M2 service or database was
modified. P3 release CLIs, candidate/manifest tracking, drift detection, and
build-impact analysis remain outstanding.
