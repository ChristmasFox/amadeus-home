# Lab live verification passed; formal release pending — 2026-10-15

## Scope and status

Arthur's reordered authorization applies only to Lab `nyannyan` / container
`openclaw`. Source push, candidate build, guarded deployment, Dreaming, privacy
review, and incremental index/retrieval acceptance completed. P1 is
`LIVE_VERIFIED`; formal release and `lab/v1.10.5` tag creation remain pending.
No Gate, PostgreSQL, M2, secret, session-history SQLite, `AGENTS.md`, or
scheduled-job definition was changed. The daily Dreaming schedule was not
paused or edited.

## Corrected Dreaming preflight conclusion

The prior candidate stop report said the enabled “Memory Dreaming Promotion”
job was not an executor because the live config had no explicit `dreaming`
entry and the job was an `agentTurn` with `memory_search` in its tool allowlist.
Direct inspection of the candidate's bundled code corrected that conclusion:

- `DEFAULT_MEMORY_DREAMING_ENABLED` is `true`; absence of an explicit entry
  does not disable Dreaming.
- The Memory Core-managed job payload carries the promotion trigger consumed
  by the `before_agent_reply` hook. The hook runs the Dreaming phases before
  the ordinary agent response path.
- The job remained enabled at `0 3 * * *` in `Asia/Shanghai`. It was invoked
  once through `openclaw cron run`; no schedule or job edit was made.

The run completed successfully at `2026-10-15T22:34:09+08:00`, with one
workspace, zero promotion candidates, and two completed narrative writes
(Light and REM). The job remains enabled; `nextRunAt` is
`2026-10-16T03:00:00+08:00`.

## Source isolation and privacy

The candidate contained the before-read peer-admission and classifier markers.
The sole configured WhatsApp peer matched the Owner target; Telegram direct
admission failed closed because its peer file is unconfigured; groups/channels
were excluded. The session-corpus audit reported zero suspicious files and
zero suspicious lines. The run used one eligible workspace.

A metadata-only scan of six files added/changed during the run recorded these
counts, without emitting source text or identifiers:

- Explicit phone-format/context matches: 0
- Ambiguous phone candidates: 0
- Owner-phone matches: 0
- WhatsApp JID occurrences: 0
- Group JID occurrences: 0

No transcript or memory snippets were retained in the evidence.

## Recovery and index acceptance

Before writing the derived index, the following protected checkpoint was
created outside Git:

`/Volumes/Avalon/backups/operation-skuld/lab-memory/20261015T144403Z-post-dreaming`

The agent SQLite snapshot used SQLite's online backup API and passed
`PRAGMA quick_check=ok`. The complete Workspace, including `memory/`, was
copied and its file tree matched source. The checkpoint directory is mode 0700;
the database and evidence files are mode 0600. The earlier pre-switch recovery
checkpoint remains available at
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261015141417`.

The authorized incremental command `openclaw memory index --agent main`
indexed five files. Status changed from three files/70 chunks and
`dirty=true` to five files/92 chunks and `dirty=false`. FTS is available,
hybrid search is active, and the 1024-dimensional vector index is complete.
A keyword query returned one positive result; a semantic paraphrase returned
two positive results. Snippets were not retained.

## Image and release gate

- Lab version: `1.10.5`
- Image: `local/openclaw-amadeus:git-57e472ebe014-20261015140824`
- Source: `57e472ebe014a0b4d3574d7ef30107340dc99308`
- Digest: `sha256:4cb3c044925bb371b7232e47520b04d17633862549b9e315e555fbc9ce7aefd9`
- P1 acceptance: external `live-acceptance.json`, accepted by
  `scripts/validate-lab-memory-acceptance.py` as `LIVE_VERIFIED`.
- Dreaming/privacy evidence: external `dreaming-verification.json` in the
  protected checkpoint above.

The read-only release plan passed for `lab/v1.10.5`, with promotion scope
`existing-live-openclaw-digest` and `CONTAINER_SWITCH=none`. No formal release
tag, release manifest, or formal release notification has been created/sent
yet. The remaining authorized step is to run the guarded formal release with
the candidate checkpoint and accepted P1 evidence. If it fails, retain the
live candidate and data, record the reason, and follow the release script's
tag/manifest notification rollback behavior.
