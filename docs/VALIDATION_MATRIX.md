# Amadeus validation matrix

This matrix is the default for 1.4.5 development. It preserves the release gates while preventing unrelated full-suite or image work during an implementation phase.

| Changed area | During edit | Phase gate | Release gate | Docker build |
| --- | --- | --- | --- | --- |
| docs, `.agent`, release evidence | `git diff --check`, JSON/Markdown checks | optional consistency check | one final full gate | no |
| tracked secret migration scripts | `bash -n`, tracked-file and leak fixture | fresh-clone + secret bundle rehearsal | `check:secrets` and fresh clone | no |
| storage shell / scheduler / GC | `bash -n`, storage fixture | `test:storage-runtime`, GC and scheduler fixtures | full test/typecheck/build once | no |
| backup / migration shell | `bash -n`, fixture SQLite/pg/artifact checks | backup/readiness fixture | full test/typecheck/build once | no |
| manifest / runbook / service inventory | JSON parse, contract test | `test:skuld-consistency` | architecture + full suite once | no |
| Immich reclaim/readiness shell | `bash -n`, isolated state fixture | migration-readiness + reclaim fixture | full suite once | no |
| Amadeus/Identity runtime source | targeted typecheck/test | affected package build if needed | full gate; affected image only | OpenClaw only |
| Product Radar runtime source | targeted typecheck/test | affected package build if needed | full gate; affected image only | Product Radar only |
| Dockerfile, dependency or lockfile | static checks | affected build | full gate | required affected image |
| OpenClaw config/compose only | parse and contract checks | no-build rehearsal | live acceptance | no |

## Evidence rules

- `pnpm workflow:plan` runs before each implementation phase.
- Successful checks may be reused only when their input scope has not changed; source changes invalidate the relevant check.
- Successful commands emit one summary line; failed commands retain bounded diagnostics.
- Fresh-clone rehearsal sets `AMADEUS_FRESH_CLONE_REHEARSAL=1` and runs a curated non-recursive suite.
- Live acceptance validates runtime truth only; it does not repeat local source gates.
