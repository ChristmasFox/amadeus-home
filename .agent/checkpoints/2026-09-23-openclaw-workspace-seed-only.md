# Amadeus 1.4.8 — Phase 1 workspace authority checkpoint

- Status: Phase 1 implementation and focused verification passed; no runtime or external storage was changed.
- Git workspace context moved to `integrations/openclaw/workspace-seed/*.seed.md`; seed-only semantics are documented alongside the files.
- `openclaw_prepare.py` creates only missing workspace files. Existing directory metadata, files, symlinks, non-file paths, and `memory/**` remain untouched; unsafe workspace-root symlinks fail closed.
- Added plan-only `scripts/openclaw-workspace-sync.sh`; writes require exactly one `--approve-file` and non-regular paths are refused.
- Evidence: `pnpm test:openclaw-workspace`, `pnpm test:architecture`, `pnpm check:architecture`, session-isolation test, Python compile, shell syntax, `git diff --check`, and `pnpm check:secrets` passed.
- Architecture scanning distinguishes explicit negative policy statements from active references and excludes test harnesses; fixture tests still reject active old-host and retired-runtime references.
- Next: Phase 2 complete-state inventory and SQLite/session database discovery, then cold snapshot/verify/restore implementation. The first operator boundary remains Phase 6; no approval has been requested or consumed.
