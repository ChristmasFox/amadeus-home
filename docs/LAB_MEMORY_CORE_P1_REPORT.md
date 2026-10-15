# Lab Memory Core P1 repair report

Date: 2026-10-15 (Asia/Shanghai)  
Status: **`SOURCE_FIXED` + `BUILD_VERIFIED`; Lab candidate deployed and live checks passed; controlled Dreaming stopped before run; P1 `LIVE_VERIFIED` and `RELEASED` remain incomplete**
Scope: source, configuration, temporary fixtures, a synthetic Embedding probe,
Lab index acceptance, and the later explicitly authorized candidate build and
Lab OpenClaw deployment. The derived index was rebuilt after a verified
external backup. The candidate deployment recreated only Lab OpenClaw; no
Gate service, session-history database, credential value, or source memory
content was changed. See the latest outcome below; earlier snapshots in this
report are historical and superseded where they conflict.

## Source repair

- The Lab template now explicitly allows and enables `memory-core`, assigns it
  to `plugins.slots.memory`, enables `memory.search`, and declares Dreaming at
  `03:00 Asia/Shanghai`. Semantic search remains configured for
  `Qwen/qwen3.7-text-embedding-flash`; one synthetic endpoint probe succeeded,
  while semantic retrieval remains unverified.
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
- The pinned Dreaming phase bundle now returns
  `SKIPPED_NO_ELIGIBLE_CORPUS` when every enabled Light/REM phase has no
  eligible entries. Those empty phases do not write a completed daily phase
  block or phase-specific signal; Memory Core skips durable promotion for the
  skipped workspace and logs `DREAMING_RESULT=SKIPPED_NO_ELIGIBLE_CORPUS`.
  The existing signal-ingestion stage still runs before candidate selection;
  this source result does not replace runtime proof of transcript isolation.
- The configured memory source remains `memory`; `rememberAcrossConversations`
  remains `false`. That flag is not used as authorization for session
  ingestion.
- The `openclaw_prepare.py` merge fixture now proves the managed Memory Core
  settings and memory slot from the template survive merging, while existing
  operator commands, metadata, security settings, and WhatsApp allow data are
  preserved. Stale prior memory settings do not override the managed template.
- Lab CI now runs the pinned-runtime config-validation fixture in addition to
  the Memory Core admission tests. Path filters cover that test and its
  `openclaw_test_runtime.py` helper, so changes to the schema-validation
  boundary retrigger the workflow.

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
- Dreaming is loaded and configured in the runtime. At this initial snapshot,
  Cron listed the `0 3 * * *` schedule in `Asia/Shanghai` with
  `lastRunStatus=ok`; the separate run-history query returned no records.
  Memory status reported no session corpus or session-ingestion state,
  `/workspace/memory` contained no files, `DREAMS.md` was absent, and no
  recall/promotion audit entries existed. This initial observation did not
  prove that Dreaming ran or promoted a candidate. A later metadata-only
  history query found seven retained records; see the follow-up below.
- The latest read-only follow-up at approximately `2026-10-15 12:30 UTC`
  reports 2 indexed files, 70 chunks, FTS enabled/available, hybrid search
  mode, a
  1024-dimension vector index, and `dirty=true`. The scanner reports 3 files,
  so the index is not current. Provider state remains `pending`; Dreaming has
  zero session-corpus files. This supersedes the earlier `dirty=false`
  snapshot. No search query, `--deep` provider readiness probe, Embedding
  request, index refresh, or Dreaming run was issued; no memory text was
  emitted.
- The sanitized Lab status snapshot at `2026-10-15T12:29:17Z` still reports
  OpenClaw healthy at the 1.10.4 candidate digest from source `4a57348`; the
  P1 source patch has not been built into that image. Product Radar remains
  healthy with source/version unavailable; drift remains `UNKNOWN` without a
  protected manifest.

## Authorized 9Router Embedding probe — 2026-10-15

- The live OpenClaw config was read with output restricted to nonsecret fields:
  provider `openai-compatible`, model `Qwen/qwen3.7-text-embedding-flash`,
  base URL `http://9router:20128/v1`, and API key reference
  `OPENCLAW_9ROUTER_API_KEY` present. No key value was emitted.
- One request was sent to the configured `/v1/embeddings` endpoint using only
  the synthetic text `Synthetic Lab Embedding interface probe: copper orchard
  orbit 42.` The response was HTTP 200, returned model
  `qwen3.7-text-embedding-flash`, and contained 1024 finite vector elements;
  provider usage reported 32 input tokens.
- The pre-request index snapshot was 2 files, 70 chunks, 3 scanned files,
  FTS enabled/available, vector enabled, hybrid search mode, and `dirty=true`.
  No memory text, search query, or application write was involved. This proves
  endpoint reachability, authentication, response shape, and the 1024-dimension
  contract; it does not prove semantic retrieval or `LIVE_VERIFIED` acceptance.

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

## Pre-reindex protected checkpoint — 2026-10-15

The authorized Lab run created and verified an external, mode-0700 checkpoint
at `/Volumes/Avalon/backups/operation-skuld/lab-memory/20261015T124516Z`.
The agent SQLite snapshot was produced with the online backup API and passed
both `PRAGMA quick_check` and `PRAGMA integrity_check` after loading the
pinned `sqlite-vec 0.1.9` `vec0` extension. The 340,561,920-byte snapshot SHA-256
is `a8b90f7c7bff9e0b87c9d528a4396edab46c0efa956feb22dc0b84b2f668a720`.
The mode-0600 memory archive includes `workspace/memory/` and
`workspace/MEMORY.md`; archive extraction matched the source tree hash and
`gzip -t` passed. `DREAMS.md` was absent. The metadata-only index baseline is
2 files / 70 chunks / 3 scanned, `dirty=true`, FTS available, 1024 vector
dimensions, and identity status `valid`. The generic Python verifier first
failed because `vec0` was not loaded; verification succeeded with the pinned
runtime extension. No live data or service was changed. Full evidence and the
recovery boundary are in
`.agent/checkpoints/2026-10-15-lab-memory-reindex-prewrite.md`.

## Authorized reindex and retrieval acceptance — 2026-10-15

- `openclaw memory index --force --agent main` exited 0. The resulting status
  is 3 indexed files / 3 scanned files, 70 chunks, `dirty=false`, FTS
  enabled/available, vector enabled at 1024 dimensions, hybrid mode, and a
  valid index identity. The embedding cache reports 72 entries.
- The exact keyword query returned 3 results; all 3 had positive text and
  vector scores. A different-worded semantic paraphrase returned 1 result with
  a positive vector score. Only result counts and numeric score summaries
  were retained; no memory snippets, paths, or text were emitted.
- The pre-write checkpoint remains intact and no rollback was needed. No
  session database was deleted or replaced, and no service restart occurred.
  Modified-file incremental-refresh and restart-persistence gates remain
  outstanding for full P1 `LIVE_VERIFIED` acceptance.

## Reordered Lab candidate outcome and Dreaming stop — 2026-10-15

The later explicit Lab-only authorization completed source push, candidate
build, and candidate deployment before starting Dreaming. The pushed source is
`57e472ebe014a0b4d3574d7ef30107340dc99308`; the Lab OpenClaw candidate is
version `1.10.5`, image
`local/openclaw-amadeus:git-57e472ebe014-20261015140824`, digest
`sha256:4cb3c044925bb371b7232e47520b04d17633862549b9e315e555fbc9ce7aefd9`.
`BUILD_VERIFIED` evidence confirms the image contains the latest before-read
peer-admission, backfill-admission, and no-corpus Dreaming fixes.

The candidate was deployed through the guarded Lab release wrapper, which used
`scripts/deploy-openclaw.sh`; no bare Compose command was used. A protected
pre-switch checkpoint was created at
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261015141417`.
The online SQLite backup, session backup, and Workspace backup are present.
Candidate health and Amadeus plugin registration passed. After the container
recreation, the memory index remained 3 files / 70 chunks, `dirty=false`, FTS
available, hybrid search, valid identity, and complete 1024-dimensional vector
state. The keyword query returned 3 results with positive text and vector
scores; the semantic paraphrase returned 3 positive vector scores. The running
image exposed the before-read Dreaming gate, admission classifier, backfill
admission, and no-corpus markers. Sanitized config checks found one WhatsApp
owner peer, no configured Telegram peer file (so Telegram direct admission
fails closed), and group/channel exclusion. No query text, snippets, phone
number, or peer identifier is included in the evidence.

Dreaming was stopped before invocation. The live
`plugins.entries.memory-core.config` has no `dreaming` entry. The existing
“Memory Dreaming Promotion” automation is enabled but is an `agentTurn` with
only `memory_search` allowed tools and delivery disabled; it is not an actual
Dreaming executor and was not run. No controlled Dreaming source read, memory
write, or output occurred, so there was no output on which to perform the
requested phone-number/cross-user/group leakage inspection. The candidate
remains healthy and live; rollback was not performed because candidate
application succeeded and the Dreaming stop occurred before any operation.
The protected checkpoint remains available.

`LIVE_VERIFIED` is still false: modified-file incremental refresh remains
unverified, and the authorized Dreaming run did not occur. No formal Lab
release or tag was created. Candidate build evidence is at
`/Volumes/Avalon/backups/operation-skuld/deploy/candidate-build-amadeus-openclaw-20261015140824/build-evidence.json`;
post-deploy acceptance and manifest are at
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261015141417/postdeploy-acceptance.json`
and `/Users/nyannyan/.local/state/amadeus/releases/lab-lab-maintainer-20261015T141417Z-candidate.json`.
Recovery and rollback boundary are recorded in
`.agent/checkpoints/2026-10-15-lab-candidate-deployment-dreaming-stop.md`.

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

## Earlier ordered Dreaming preflight stop — prior image, 2026-10-15 (superseded by the candidate outcome below)

Arthur authorized one controlled run restricted to Arthur's own WhatsApp
direct message. It was not invoked because the live OpenClaw 2026.9.4 image
contains neither `amadeus-memory-dreaming-peer-admission-v2` nor
`classifyDreamingSessionAdmission`. Its sanitized memory policy allows both
WhatsApp and Telegram, so the configured exclusions and peer-file reference
do not prove the requested source boundary is enforced before transcript
reads. Memory status showed zero session-corpus files, which does not prove
that no other session source could be read. The enabled Dreaming cron's
`lastRunStatus=ok` was not treated as evidence for the authorized controlled
run. A later metadata-only history query found seven retained scheduled-run
records. The existing job completed automatically on 2026-10-15 at 03:00
Asia/Shanghai with status `succeeded`, duration 200245 ms, and delivery not
requested; a prior Oct 13 run failed. The query excluded prompts, summaries,
session identifiers, and content. The job remains enabled and is next due
2026-10-16 at 03:00. Current Memory status reports zero session-corpus files,
suspicious files/lines, audit entries, and promotions; no session-ingestion
state exists, `DREAMS.md` is absent, and the memory directory contains one
zero-byte file. These facts do not establish which sources the scheduled run
read or its exact effects. No transcript or run content was read, and no cron
change was made. The ordered procedure stopped here; build/apply/release were
not started. See `.agent/checkpoints/2026-10-15-lab-dreaming-preflight-stop.md`.
The current Goal continuation is limited to source, tests, CI, documentation,
and harmless validation. Further live index operations, image builds,
restarts, deployments, and release tagging require fresh explicit
authorization.

## Validation and limits

Passed focused checks:

- `node scripts/test-patch-openclaw-memory-core.mjs` (arm64/amd64 loader
  environment, peer allow/deny, revoked/malformed allowlists, before-read
  order, and pin mismatch cases)
- `python3 scripts/test-openclaw-memory-policy.py`
- `python3 scripts/test-openclaw-group-image-policy.py` (uses an isolated
  temporary copy of pinned OpenClaw 2026.9.4 with repository patches applied;
  all 6 tests passed without skips and config validation returned `valid=true`)
- `node scripts/test-patch-openclaw-memory-core.mjs` now also checks empty
  Light/REM early-return ordering, aggregate skip reporting, durable-promotion
  bypass, index summary, idempotence, and the zero-workspace result. The pinned
  runtime fixture applies the patch twice and syntax-checks both modified
  Dreaming bundles.
- `python3 scripts/test-openclaw-speech-config.py`
- `bash scripts/test-openclaw-session-isolation.sh`
- Python/Node syntax checks, `git diff --check`, `pnpm check:secrets`

The pinned-runtime config-validation test and merge fixture are source evidence;
the GitHub Actions workflow itself has not run on GitHub.

`pnpm workflow:plan` classifies the Dockerfile change as
`RELEASE_BUILD_REQUIRED`; no Docker build was run. Therefore
`BUILD_VERIFIED`, `LIVE_VERIFIED`, and `RELEASED` remain false. The ordered
Lab acceptance is stopped before item 5 by the Dreaming preflight finding.
Besides the synthetic Embedding request and the two redacted retrieval queries
recorded above, no `memory reset`, session backfill, or manually controlled
Dreaming run was issued by this repair; the pre-existing scheduled execution
is described above. No file/database write outside the derived-index rebuild
was issued by us.
