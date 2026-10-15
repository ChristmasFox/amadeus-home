# Lab Memory Core P1 repair report

Date: 2026-10-15 (Asia/Shanghai)  
Status: **`SOURCE_FIXED` + `BLOCKED_OPERATOR_AUTHORIZATION`**  
Scope: source, configuration, temporary fixtures, and read-only runtime
inspection. No Lab/Gate service was restarted or deployed; no memory content,
session transcript, credential value, index, or application database was
changed in the live runtime.

## Source repair

- The Lab template now explicitly allows and enables `memory-core`, assigns it
  to `plugins.slots.memory`, enables `memory.search`, and declares Dreaming at
  `03:00 Asia/Shanghai`. Semantic search remains configured for
  `Qwen/qwen3.7-text-embedding-flash`; this is still pending a real Embedding
  request and is not asserted as working.
- The OpenClaw 2026.9.4 patch requires complete session metadata and a valid
  admission policy. It permits only direct WhatsApp/Telegram sessions whose
  parsed peer matches the channel's protected allowlist. Unknown channels,
  groups, channels, external-content origins, missing metadata, missing keys,
  and unavailable or malformed allowlists are denied.
- Telegram's protected peer file is derived from the existing operator-owned
  `channels.telegram.allowFrom`. Only numeric Telegram user IDs are accepted;
  all listed peers are represented in a mode-0600 file under the OpenClaw
  config mount. Existing mismatched, symlinked, non-regular, or hard-linked
  files fail closed. No peer ID is printed or embedded in the image.
- The Dreaming caller and session-backfill caller are pinned by source hash
  and checked to apply admission before `scanSessionIngestionSource`. Manual
  archive inputs without trustworthy session-origin metadata are excluded.
  The plugin manifest patch adds the Telegram allowlist schema field.
- The configured memory source remains `memory`; `rememberAcrossConversations`
  remains `false`. That flag is not used as authorization for session
  ingestion.

## Read-only runtime evidence

- The running OpenClaw version is 2026.9.4. `memory-core` was reported as
  enabled, loaded, and bundled. Its runtime config schema accepts
  `memory.search.enabled`, provider/model, remote URL and SecretRef, sources,
  cross-conversation flag, plugin enablement, and the memory slot.
- `openclaw memory status --json` reported 2 files, 70 chunks, a complete
  1024-dimension vector index, FTS enabled and available, 72 cached embeddings,
  `dirty=false`, and a valid index identity. The container database path is
  `/home/node/.openclaw/agents/main/agent/openclaw-agent.sqlite`. These are
  index-state facts only; they do not prove semantic retrieval or a successful
  request to the configured Embedding model.
- The 9Router model catalog included the configured Embedding model ID, but no
  request was sent to `/v1/embeddings`. Route compatibility, returned
  dimensions, billing, and error behavior are unverified. The status payload
  reports provider state `pending`.
- Dreaming is loaded and configured in the runtime. Cron lists the
  `0 3 * * *` schedule in `Asia/Shanghai` with `lastRunStatus=ok`; the separate
  run-history query returned no run records. Memory status reports no session
  corpus or session-ingestion state, `/workspace/memory` contains no files,
  `DREAMS.md` is absent, and no recall/promotion audit entries exist. The
  available evidence does not prove that a Dreaming phase ran or promoted a
  candidate; there was no eligible session corpus at inspection time.
- The latest read-only follow-up at `2026-10-15 12:08 UTC` reports 2 indexed files,
  70 chunks, FTS enabled/available, hybrid search mode, a 1024-dimension vector
  index, and `dirty=true`. The scanner reports 3 files, so the index is not
  current. The Dreaming audit still reports zero session-corpus files and no
  session-ingestion file. This supersedes the earlier `dirty=false` snapshot.
  No search query, `--deep` provider readiness probe, Embedding request, index
  refresh, or Dreaming run was issued; no memory text was emitted.

## Provider-outage source audit

- Read-only inspection of the pinned 2026.9.4 Memory Core source found that an
  optional Embedding provider failure retains FTS keyword retrieval when FTS
  is available. The manager records `custom.searchMode=fts-only` after provider
  initialization fails, and returns keyword-only results rather than claiming
  vector matches. Required-provider failures remain unavailable.
- The search tool did not forward that manager status into its returned `mode`:
  it used only runtime debug `effectiveMode`, which is absent on this fallback
  path, and its diagnostic defaulted to `n/a`. This left the caller without an
  explicit semantic-unavailable signal even though FTS results were retained.
- The source patch now maps the pinned manager status to `mode=fts-only` and
  `debug.effectiveMode=fts-only` when FTS is enabled and available; otherwise
  it reports `unavailable`. The patch checks the pinned compiled tools
  bundle digest and fails closed on drift; a fixture covers FTS-only, hybrid,
  explicit partial-keyword mode, idempotency, and an incomplete patch marker.
  Local validation passed with `node scripts/test-patch-openclaw-memory-core.mjs`.
  The exact compiled tools bundle from the running pinned image was also piped
  through the patch and JavaScript syntax check without writing to the image.
- This new patch has not been built into an image or exercised by a live search.
  The running image still has the prior behavior. No live query was issued.
  Source follow-up commit: `48b88ac`.

## Rebuild and recovery procedure

Before any approved rebuild:

1. Record the current `openclaw memory status --json` fields without emitting
   memory snippets: database path, model/provider, vector dimensions and
   state, FTS state, file/chunk counts, dirty flag, and index identity. Resolve
   the current host bind source from the live container mount at that time;
   do not assume a path from chat history.
2. Create a protected, out-of-Git checkpoint using SQLite's online backup API
   for `openclaw-agent.sqlite`, with mode 0600 and a mode-0700 parent. Verify
   the backup with SQLite `PRAGMA quick_check` and record its digest and
   metadata only. Do not copy a live SQLite database file without its WAL
   state or put the backup in Git.
3. Obtain separate approval for the first provider probe and for the
   stateful rebuild. The probe may incur API cost. Confirm the actual model
   ID, successful vector response and dimension before rebuilding; it must
   match the recorded 1024-dimension index contract or stop.
4. Use `openclaw memory index --force --agent main` for a full reindex. Do not
   use `memory reset` as a shortcut: it clears the derived index and embedding
   cache. Capture only status fields and error codes, not query hits or
   snippets.
5. Verify keyword FTS, approved paraphrase retrieval, hybrid behavior,
   incremental refresh, `dirty=false`, and persistence after a separately
   approved restart. If the provider fails, retain FTS and report semantic
   search unavailable. Do not restore the entire SQLite backup over newer
   memory/forget/promotion writes; preserve both copies and review the write
   window before any restore.

Dreaming acceptance separately needs an approved controlled run. First prove
there is eligible allowlisted session corpus; then verify only a constrained
candidate or a documented `SKIPPED_NO_ELIGIBLE_CORPUS` result, with no
unauthorized source in the output. Existing `lastRunStatus=ok` alone is not
accepted as execution evidence.

## Validation and limits

Passed focused checks:

- `node scripts/test-patch-openclaw-memory-core.mjs` (arm64/amd64 loader
  environment, peer allow/deny, revoked/malformed allowlists, before-read
  order, and pin mismatch cases)
- `python3 scripts/test-openclaw-memory-policy.py`
- `python3 scripts/test-openclaw-group-image-policy.py` (uses an isolated
  temporary copy of pinned OpenClaw 2026.9.4 with repository patches applied;
  config validation returned `valid=true`)
- `python3 scripts/test-openclaw-speech-config.py`
- `bash scripts/test-openclaw-session-isolation.sh`
- Python/Node syntax checks, `git diff --check`, `pnpm check:secrets`

`pnpm workflow:plan` classifies the Dockerfile change as
`RELEASE_BUILD_REQUIRED`; no Docker build was run. Therefore
`BUILD_VERIFIED`, `LIVE_VERIFIED`, and `RELEASED` remain false. No HTTP POST,
Embedding request, memory search query, `memory index`, `memory reset`, session
backfill, Dreaming run, or file/database write was issued for this repair.
