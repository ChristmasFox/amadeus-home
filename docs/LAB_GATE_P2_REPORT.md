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

At P2 phase close, source checks reported Lab `1.10.4` and Gate `0.1.0`. No
version file was changed by the fixture tests. No live Gate M2 service or
database was modified. P3 release CLIs, candidate/manifest tracking, drift
detection, and build-impact analysis remained outstanding at that point; see
the subsequent phase and release evidence below and in the P3 report.

## Subsequent Lab 1.10.5 release — 2026-10-15

The P2 source phase above completed before the separately authorized Lab
candidate/release sequence. Root `VERSION` and the single-release notes now
identify Lab `1.10.5`; Gate remains on its independent `0.1.0` development
baseline. After P1 evidence passed, formal promotion created the local
annotated tag `lab/v1.10.5` at source commit
`0f109389378dc322dbc780997f3133b5f69eb53e` and recorded external manifest
`/Users/nyannyan/.local/state/amadeus/releases/lab-lab-maintainer-20261015T145222Z-released.json`.
The running OpenClaw artifact remains the verified immutable candidate from
`57e472ebe014a0b4d3574d7ef30107340dc99308`; promotion made no container
switch. The tag remains local, no Gate version/tag was created, and no Gate
runtime or database was modified. See the current P1 and P3 follow-ups for
live evidence and status.
