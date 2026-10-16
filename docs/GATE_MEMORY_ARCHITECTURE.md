# Gate Memory Foundation — KOOK / AI SDK

> This is a **source foundation**, not a Gate-Local memory deployment. No
> automatic learning, semantic recall or Dreaming is claimed as implemented.
> Lab Memory Core 1.10.5 remains completely independent.

## Boundaries

Gate currently keeps durable raw KOOK messages in its own PostgreSQL and runs
Vercel AI SDK `ToolLoopAgent`. Loading all raw messages into a prompt is not
long-term memory. The deployed PostgreSQL 18.1 image is not a pgvector build.
Do not copy Lab's SQLite, sessions, Owner allowlists or provider API keys.

- **Transcript:** full persisted KOOK history; long retention does not imply
  injecting all turns into every model request.
- **Working context:** bounded recent turns, quoted-message linkage, scoped
  rolling summaries and on-demand historical evidence under a token budget.
- **Long-term memory:** separate, versioned, revisable/revocable entries with
  source event provenance. Model-suggested facts are untrusted candidates.

### Scope

- DM personal preferences: `botAccountId + userId`, never group/team memory.
- Group notes: `botAccountId + channelId + tenantId + teamId +
  bindingRevision`; no cross-channel, tenant or rebinding leakage.
- The memory scope must come from the current durable KOOK ingress lease,
  fresh binding and membership checks, not tool args or model output.
- Missing/revoked identity, inaccessible team or stale binding means deny.
- Do not import private PUBG statistics or any other user's DM into group
  memory. A remembered note is untrusted context, never an authorization rule.

## First source milestone

1. Migration `0021_gate_memory_foundation.sql` adds constrained and indexed
   PostgreSQL memory storage. No transcript backfill and no vector extension.
2. `GateMemoryStore` provides scoped create, compare-and-swap correction,
   forget/tombstone, recent bounded reading and *lexical-only* search.
   Replays cannot revive a tombstone or overwrite another memory revision.
3. `PublicQueryAuthorizer` resolves memory scopes only from validated leases
   and current authorization. SQL parameters never expose tenant selection
   to the model. Read/write calls must re-resolve the current trusted scope.
4. Tests cover field validation, isolation across bots, DM actors, teams,
   channels, binding generations, correction, revocation and no-authority.
5. No model-facing memory write tool or Gate runtime migration/deployment
   is part of this milestone; Gate M2 acceptance remains independent.

## Further milestones

1. Replace the unbounded prompt-history load with a bounded working window
   plus summary/checkpoint and citation-aware historical retrieval. Keep the
   full PostgreSQL history; preserve meaningful reply/quote relations.
2. Add a Gate-only Embedding adapter with an explicit key and routing policy,
   dimension/model-index contract, timeouts, cost caps and rate limits. The
   Lab 9Router Qwen embedding result (1024 dimensions) **does not** prove
   Gate has provider entitlement or authorization. Do not share Lab secrets.
3. For SaaS scale, evaluate a pgvector-capable PostgreSQL image or a separate
   isolated vector index. Default PostgreSQL text search cannot supply robust
   Chinese semantic search; bounded lexical fallback is not a substitute.
4. Add low-priority consolidation of *trusted* transcripts into candidate
   memory, with explicit privacy, consent, conflict, prompt-injection and
   deduplication rules. No group shared memory write merely because an LLM
   saw a message. Deletion and revocation must be testable.
5. Integrate scoped read-only recall into AI SDK after privacy, latency and
   token budget tests. Real KOOK human acceptance plus explicit Gate deploy
   selection are required before claiming LIVE_VERIFIED.

## Audit remediation — 2026-10-16

Source follow-up: `fix(gate-memory): audit authorization, lexical recall and lifecycle`
(PR #7). The Gate-Local deployment boundary remains unchanged.

- Channel memory admission is **read-only**: the active KOOK ingress is
  reconstructed and membership is freshly checked, without entering the
  side-effecting PUBG query `authorize()` transaction. No row-lock/session
  creation, extension, or advisory lock occurs for a memory lookup.
- Each memory SQL statement additionally verifies the **currently active
  ingress lease and channel binding generation**, preventing a stale scope
  object from reading or mutating another binding after a concurrent rebind.
  The real KOOK-to-PostgreSQL integration fixture exercises that boundary.
  KOOK remote membership checks cannot be made atomic with PostgreSQL
  transactions; an administrative revocation on KOOK after the HTTP check
  remains subject to ordinary propagation timing.
- Lexical fallback uses Chinese Han bigrams and ranks **the complete
  authorized scope** in SQL before limiting final returned rows. Older facts
  no longer disappear merely because 128 newer entries exist. This may
  still return weak lexical candidates; it is **not** semantic recall and
  is intended to be supplemented by scoped Embeddings.
- Memory input now rejects Unicode control/format/surrogate characters,
  including bidi overrides and zero-width hiding controls. This does not
  replace prompt-injection defenses for recalled content.
- `forget` clears content while leaving a versioned tombstone, preventing
  replay. `rememberAgain` is a separate explicit CAS operation requiring
  a **newly admitted event after the revocation**; the prior event cannot
  revive a forgotten value. It is not exposed to LLM write tools.
- GitHub SaaS CI uses a real PostgreSQL 18.1 service. Memory tests hard-fail
  rather than silently skip when `CI=true` without a DB URL; the audited
  run covered actual trusted DM/group ingress, stale leases, permissions,
  version changes, correction/forget, and old-but-relevant lexical search.

### Explicitly unfinished

- The current Gate memory store still is **not wired to AI SDK prompt
  assembly**, cannot autonomously summarize conversations, and has no
  semantic embedding/vector index. Existing full message archives remain.
- There is no automatic deletion of inaccessible **old channel generations**.
  Their isolation is intentional; implement a reviewed retention/erasure
  policy, safe cleanup preview, and protected Gate backup before scheduling
  irreversible deletion. Do not make a rebind silently promote old team
  memory to another channel.
- KOOK direct-message account suspension/block lists do not currently exist
  as a separately authoritative Gate policy; the DM admission uses the
  authenticated, active trusted event lease and remains separate from PUBG
  team membership. Add an explicit bot-level block policy if the product
  introduces such a feature.
- Removing a memory entry does not by itself delete its original raw KOOK
  transcript or historical backups; holistic privacy erasure needs a separate
  retention and recovery design.

Next: bounded prompt assembly and hybrid semantic recall with **Gate-owned**
Embedding credentials, private scoped indexes and consent-aware consolidation.
No runtime migration or Gate-Local deployment is implied by a source merge.

## Follow-up lexical audit — 2026-10-16

- The lexical search no longer short-circuits when the query has no
  bigrams: a single Han character, single Latin letter or emoji can match
  the complete original string. An empty/invalid query is still rejected.
- Mixed Han/Latin runs are split by script before generating Han bigrams.
  Prefix/wildcard characters are escaped before being bound to PostgreSQL
  LIKE predicates; there is no SQL string interpolation of user input.
- User-facing memory content may include a ZWJ **only inside an actual emoji
  sequence**. Keys and unsafe control/format characters remain rejected.
  U+FE0F variation selectors were already allowed (they are not `Cf`).
- SQL prefilters by actual lexical overlap **before scoring** and still ranks
  across the full authorized scope; it does not reintroduce a newest-N cap.
  This reduces unnecessary scoring but **does not guarantee indexed,
  sublinear text search**: short CJK LIKE predicates may still scan all
  memories inside a scope. Before scaling Gate beyond small-team use, add
  an explicitly reviewed pg_trgm/other suitable index, verify actual
  migrator CREATE EXTENSION privileges, inspect EXPLAIN plans, load-test
  large scopes and set a tested query-time budget. Avoid silently dropping
  older memory to satisfy a latency limit.
- KOOK binding JOIN predicates now live in a shared helper used by
  PUBG authorization and memory checks. Membership still comes from the
  fresh KOOK API and memory operations retain their statement-level fence.
- `rememberAgain` is retained as a tested *explicit restore primitive*,
  not wired to any Agent tool or autonomous learning. Removing it now
  would reintroduce the previously reviewed inability to intentionally
  restore a tombstone; actual user-facing consent is a later milestone.
