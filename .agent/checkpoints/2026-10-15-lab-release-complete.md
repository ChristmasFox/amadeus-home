# Lab 1.10.5 release complete — 2026-10-15

## Final status

Arthur's reordered authorization covered Lab only. The ordered sequence is
complete: source push, candidate build, guarded candidate deploy, controlled
Dreaming, privacy/index acceptance, and formal release. Final state is
`SOURCE_FIXED`, `BUILD_VERIFIED`, `LIVE_VERIFIED`, and `RELEASED`. No Gate,
PostgreSQL, M2, real secret, session-history SQLite, `AGENTS.md`, or Dreaming
schedule change occurred.

## Formal release

Formal release used the canonical `scripts/release-lab.sh release --apply`
path with `--promote-live-candidate`; the candidate was not rebuilt or
switched during promotion. Live digest/source/version matched the accepted P1
evidence. The script:

- Created the annotated local tag `lab/v1.10.5` pointing to release commit
  `0f109389378dc322dbc780997f3133b5f69eb53e`.
- Wrote released manifest
  `/Users/nyannyan/.local/state/amadeus/releases/lab-lab-maintainer-20261015T145222Z-released.json`.
- Sent the formal Owner release notification; the script confirmed
  `FORMAL_RELEASE_NOTIFICATION=sent`.

The release tooling contract intentionally does not push tags. The tag remains
local. Formal promotion performed no container switch. No rollback was
needed. A post-release `scripts/release-lab.sh status --live --manifest`
returned `DRIFT_STATUS=IN_SYNC`; the OpenClaw container is healthy.

## Runtime identity and acceptance

- Lab release version: `1.10.5`
- Image: `local/openclaw-amadeus:git-57e472ebe014-20261015140824`
- Runtime source: `57e472ebe014a0b4d3574d7ef30107340dc99308`
- Runtime digest: `sha256:4cb3c044925bb371b7232e47520b04d17633862549b9e315e555fbc9ce7aefd9`
- Formal release source/tag commit: `0f109389378dc322dbc780997f3133b5f69eb53e`
- P1 evidence: `/Volumes/Avalon/backups/operation-skuld/lab-memory/20261015T144403Z-post-dreaming/live-acceptance.json`

The P1 validator accepted `LIVE_VERIFIED`. After Dreaming, the protected
checkpoint at
`/Volumes/Avalon/backups/operation-skuld/lab-memory/20261015T144403Z-post-dreaming`
contains the SQLite online backup (`quick_check=ok`) and complete Workspace
copy, including memory. Incremental indexing completed at five files/92 chunks,
`dirty=false`; FTS was available, hybrid search was active, and the complete
vector index had 1024 dimensions. Keyword and semantic retrieval both returned
positive results.

The controlled Dreaming job succeeded at `2026-10-15T22:34:09+08:00`, used one
owner-allowlisted workspace, wrote Light and REM narrative entries, and
promoted zero candidates. Its `0 3 * * *` `Asia/Shanghai` schedule remains
enabled and unchanged; next run is `2026-10-16T03:00:00+08:00`. Before-read
admission, owner-target match, Telegram fail-closed behavior, and group/channel
exclusion passed. The six changed files had zero phone, ambiguous-number,
Owner-phone, WhatsApp-JID, or group-JID matches. No snippets were recorded.

## Protected source and release evidence

- Candidate build evidence:
  `/Volumes/Avalon/backups/operation-skuld/deploy/candidate-build-amadeus-openclaw-20261015140824/build-evidence.json`
- Candidate pre-switch checkpoint:
  `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261015141417`
- Post-Dreaming/index checkpoint and privacy evidence:
  `/Volumes/Avalon/backups/operation-skuld/lab-memory/20261015T144403Z-post-dreaming`
- Released manifest:
  `/Users/nyannyan/.local/state/amadeus/releases/lab-lab-maintainer-20261015T145222Z-released.json`

The earlier candidate Dreaming-preflight stop remains as a historical snapshot;
its executor/config conclusion was corrected by direct inspection of the
bundled Memory Core code and the successful controlled run above.
