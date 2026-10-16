# Gate Memory Foundation — KOOK / AI SDK

> This is a **source foundation**, not a Gate-Local memory deployment. P0–P3
> now provide scoped working context and hybrid long-term recall using
> synthetic embeddings in acceptance fixtures. Automatic learning, real
> provider validation and Dreaming are not implemented. Lab Memory Core
> 1.10.5 remains completely independent.

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

1. P0/P1 completed the bounded working window, same-scope quote lookup, and
   extractive rolling checkpoint. Full PostgreSQL history remains available;
   citation-aware historical retrieval is still future work.
2. P2 added the Gate-only Embedding adapter, explicit configuration, egress
   guard, contract validation, and budgets. Lab credentials and its observed
   provider route are not reused; real Gate provider entitlement remains
   unverified.
3. P2 added an optional pgvector schema and isolated fixture. The normal
   PostgreSQL startup path remains extension-free; live Gate image or schema
   changes remain separately gated.
4. P3 integrated scoped hybrid read-only recall with fixed fallbacks and a
   dedicated context budget. The details and synthetic acceptance evidence
   are recorded below.
5. P4/P5 remain future work: any transcript consolidation or memory writer
   needs explicit privacy, consent, conflict, prompt-injection, and
   deduplication rules. No group memory is written merely because an LLM saw
   a message.

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

- P3 wires `GateMemoryStore` through `MemoryRetriever` into AI SDK prompt
  assembly. The acceptance path uses synthetic embeddings. Real provider
  entitlement, semantic quality, and live Gate acceptance remain unverified.
  There is still no autonomous conversation summarization or memory
  consolidation; existing full message archives remain.
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

Next: citation-aware historical retrieval, hybrid semantic recall with
**Gate-owned** Embedding credentials, private scoped indexes and consent-aware
consolidation. No runtime migration or Gate-Local deployment is implied by a
source merge.

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

## P0 conversation-context audit — 2026-10-16

### Runtime source path and trust fences

1. `KookIngressQueue.ingestGatewayEvent` validates and deduplicates the
   KOOK event, records its durable ingress row with the admission-time channel
   binding revision/team snapshot, and stores the current human message.
   `adoptProvisionedBinding` updates that ingress and current transcript row
   together if this event safely creates a team binding.
2. The public handler receives a leased job and calls
   `PublicQueryAuthorizer.loadAgentConversation` before `runPublicKookAgent`.
   For group context, the authorizer checks the current binding generation,
   freshly checks KOOK channel membership, then locks/reloads the active
   ingress lease and checks the binding again before reading. A denied or
   unavailable channel-membership check suppresses historical context while
   allowing ordinary chat to proceed; each PUBG tool still performs its own
   fresh authorization. Direct-message history uses the bot-and-actor-derived
   `dm:<bot>:<user>` channel and an active direct-event lease.
3. The SQL history read matches the transcript's group scope, tenant, team,
   and binding revision against the current `channel_binding_versions` row
   and active ingress lease. It selects at most 80 prior rows, restores them
   to chronological order, and resolves reply links only from that selected
   scope. A current quote can trigger one additional lookup under the same
   scope and lease. Binding changes during the read yield an empty context.
4. `buildGateWorkingContext` selects recent turns within a 4,000-token
   *estimate* budget, clips current quote context to 1,000 estimated tokens,
   and passes the current user message separately without clipping. The
   estimate is `conservative_unicode_char_v1` (ASCII code point = one-third
   token; other code point = one token), not the configured provider's actual
   tokenizer. A scoped extractive checkpoint can fill the 1,000-token
   episodic-summary slot; the separate 1,000-token long-term-recall slot stays
   reserved and unused.
5. On completion, the ingress queue revalidates the active lease and current
   binding before writing the assistant transcript and transactional outbox.
   Provider diagnostics retain usage totals and status only, not prompt or
   completion text.

### Schema, regression evidence, and search behavior

- Migration `0015_kook_agent_conversation.sql` stored bot/channel/speaker,
  source/reply IDs, content, and expiry, with no team or binding provenance.
  Migration `0017_public_context_retention.sql` changed transcript expiry to
  infinity. Therefore an old group row cannot safely be assigned to a later
  binding based on its channel alone.
- New, source-only migration `0022_scoped_agent_conversation.sql` adds
  nullable scope columns and a scope/recent index. Existing group rows remain
  unscoped archives and are not injected. A legacy direct row is backfilled
  only when its retained durable ingress proves the same bot, direct event,
  and actor-derived DM channel. The migration has **not** been applied to
  Gate-Local.
- Synthetic isolated-PostgreSQL regression coverage exercises a team rebind:
  the old generation is visible only within its original generation, and the
  new generation receives no prior team's transcript. It also checks that
  removed channel membership yields no historical window. The migration
  fixture proves safe direct-message backfill while legacy group provenance
  remains null.
- Lexical memory recall still filters by bot, memory scope, actor/channel,
  tenant/team, and binding revision. A 10,000-row synthetic cross-scope
  `EXPLAIN` selected `idx_gate_memory_scope_recent` with the complete scope in
  its index condition; CJK `lower(memory_key/content) LIKE ...` remains a
  filter within the selected scope. `searchLexical` now applies a 500 ms
  PostgreSQL statement timeout by default (configurable from 10 to 10,000
  ms). The plan does not prove sublinear behavior for a large single scope;
  `pg_trgm` or another text index remains future work.
- Focused source verification passed: 18 tests across
  `public-query-authorizer.test.ts`, `gate-context-builder.test.ts`,
  `kook-agent-ingress.integration.test.ts`,
  `kook-public-query-handler.test.ts`, and
  `gate-memory-foundation.test.ts`; SaaS TypeScript typecheck and
  `git diff --check` passed. These tests use the isolated local PostgreSQL
  fixture, not Gate-Local.

### Provider and PostgreSQL baseline

- The Gate Compose source pins PostgreSQL
  `postgres:18.1-bookworm@sha256:cc9f4143a8d2fa8cf3749d0cb4d26ecf2d53a77a2ac807e9ebd67ae22426221a`.
  The image is the standard PostgreSQL image; source migrations add no
  extension, and migration `0021_gate_memory_foundation.sql` explicitly
  avoids assuming pgvector. No pgvector extension or embedding adapter is
  implemented by this source change.
- A read-only Gate-Local probe, when performed under the canonical local host
  profile, should first record the running PostgreSQL container image ID/digest
  and then run `SELECT version();` and
  `SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';`.
  An empty extension result means vector is unavailable in that database.
  This audit did not connect to or query the Gate-Local database; the M2
  checkpoint still says `PAUSED / BLOCKED_BY_RELEASE_ENGINEERING`. No runtime
  mutation, migration, or deployment was performed.
- Model configuration is `MODEL_BASE_URL`, `MODEL_ID`, and `MODEL_API_KEY`;
  a non-HTTPS HTTP endpoint is accepted only when its exact host:port appears
  in `MODEL_ALLOWED_INTERNAL_HOSTS`. Compose supplies
  `PUBG_SAAS_EGRESS_PROXY` and requires it, so application requests use the
  guarded egress proxy. The public agent has a 300,000 ms total timeout,
  including a 270,000 ms tool-loop and 30,000 ms finalization budget. Token
  usage is recorded when the provider returns it. The tool loop has no new
  fixed step cap. There is no application monetary cost cap or Gate-owned
  embedding-provider configuration yet.

### Exact source and fixture changes in this audit

- Application: `apps/pubg-saas/src/application/gate-context-builder.ts`,
  `gate-memory-store.ts`, `kook-ingress-queue.ts`,
  `kook-public-query-handler.ts`, and `public-query-authorizer.ts`.
- Migration/bootstrap/export: `apps/pubg-saas/src/infrastructure/postgres/migrations/0022_scoped_agent_conversation.sql`,
  `apps/pubg-saas/src/infrastructure/postgres/migrate.ts`, and
  `apps/pubg-saas/src/index.ts`.
- Tests: `apps/pubg-saas/tests/gate-context-builder.test.ts`,
  `gate-memory-foundation.test.ts`,
  `kook-agent-ingress.integration.test.ts`, and
  `public-query-authorizer.test.ts`.
- Documentation: `docs/GATE_MEMORY_ARCHITECTURE.md`.

This closes the source-level cross-binding regression and bounded ordinary
chat context baseline. It does not close Gate M2, deploy Gate-Local, implement
semantic memory retrieval, or complete P1–P6 of the active Goal.

## P1 bounded-context follow-up — 2026-10-16

- Migration `0023_kook_conversation_checkpoints.sql` adds a scope-digested
  checkpoint row with binding provenance, generation, coverage timestamps and
  count, selected source event IDs, a digest of the source transcript slice,
  and a rebuildable flag. Raw transcript rows remain authoritative.
- `KookIngressQueue.complete` rebuilds a deterministic, extractive checkpoint
  in the same completion transaction. Its boundary query skips only the fixed
  80-message working window and reads at most 100 older rows through the
  scoped conversation index. It stores at most 1,000 estimated tokens from
  source-backed excerpts. No extra model call or autonomous fact inference is
  involved. Identical source rows retain the same generation; changed source
  slices increment it. When no usable scoped checkpoint row exists, ordinary
  chat proceeds with recent history alone.
- The authorizer returns a checkpoint only after the same fresh channel
  membership, current binding revision, durable ingress lease, and actor/bot
  checks used for history. The handler injects it as a labeled **user-role**
  context item, never as system instructions. It is low-trust history, not a
  factual authority or semantic memory.
- Context planning uses a 24,000-token engineering envelope, with estimated
  reserves of 4,000 for system/tool definitions, 5,000 for tool results,
  2,000 for the final answer, and 1,000 for future long-term recall. Recent
  turns, quote, and checkpoint each keep their 4,000/1,000/1,000 initial
  budgets; the current message remains separate and intact. These are
  conservative estimates, not the configured provider tokenizer or a claim
  about every provider's model context size. The AI SDK keeps its existing
  uncapped step behavior and timeouts; the builder reserves estimated space
  for tool results and the final answer without changing domain/tool output.
- An isolated PostgreSQL test seeds 1,000 synthetic turns, verifies the
  80-row recent cap and scope index plan, resolves a quote outside the recent
  window, observes the scoped checkpoint, checks rebuild idempotency and
  verifies a team rebind returns no old-generation history or checkpoint. The
  measured synthetic read completed below the 2,000 ms test ceiling. The
  focused suite passed 20/20 with no skips; SaaS typecheck passed. The
  migration remains source-only and was not applied to Gate-Local.

Exact P1 source and fixture changes:

- `apps/pubg-saas/src/application/gate-context-builder.ts`
- `apps/pubg-saas/src/application/gate-conversation-checkpoints.ts`
- `apps/pubg-saas/src/application/kook-conversation-agent.ts`
- `apps/pubg-saas/src/application/kook-ingress-queue.ts`
- `apps/pubg-saas/src/application/kook-public-query-handler.ts`
- `apps/pubg-saas/src/application/public-query-authorizer.ts`
- `apps/pubg-saas/src/index.ts`
- `apps/pubg-saas/src/infrastructure/postgres/migrate.ts`
- `apps/pubg-saas/src/infrastructure/postgres/migrations/0023_kook_conversation_checkpoints.sql`
- `apps/pubg-saas/tests/gate-context-builder.test.ts`
- `apps/pubg-saas/tests/public-query-authorizer.test.ts`
- `docs/GATE_MEMORY_ARCHITECTURE.md`

P1 source acceptance is ready for its committed phase gate. P1 does not add
semantic recall, Gate-owned embeddings, model-generated summaries, or a real
Gate-Local deployment.

## P2 Gate-owned embedding and optional pgvector source — 2026-10-16

- `GateMemoryEmbeddingProvider` uses AI SDK `embedMany` with the existing
  `@ai-sdk/openai-compatible` adapter and Gate's `createPublicModelFetch`
  egress guard. It reads only separate `GATE_MEMORY_EMBEDDING_*` settings,
  including a separate key and an explicit `GATE_MEMORY_EMBEDDING_ENABLED=1`
  switch. The default remains unconfigured; chat credentials are ignored.
  HTTPS is required except for an exact internal host:port allowlist entry.
  No live model probe or provider request was made in this phase.
- Embedding batches have per-call timeout, input-byte/token ceiling, batch
  limit, request/token daily budgets, SHA-256 content hashes and a contract
  containing provider, model, dimensions, L2 normalization and index version.
  Responses are checked for exact dimension, finite nonzero unit vectors and
  contract drift. UTF-8 byte count is used as a conservative byte-level
  tokenizer ceiling; it is a spend guard estimate, not a provider invoice or
  exact tokenizer report. Budget failures and unknown provider outcomes do
  not refund a possibly billed request.
- Migration `0024_gate_memory_embedding_jobs.sql` adds a transactional
  upsert/delete outbox and daily usage accounting using built-in PostgreSQL
  types only. Fact revisions remain authoritative. Create, revise,
  remember-again and forget enqueue the matching revision atomically; reads
  filter revoked facts immediately, before the delete worker removes vectors.
  Worker leases, source revision checks, current binding checks and
  idempotent upserts prevent stale index jobs from reviving facts.
- Migration `0025_gate_memory_pgvector.sql` is intentionally excluded from
  startup migrations. An operator must first install the extension and
  separately apply this optional schema. It adds versioned `vector` rows and
  a BTREE scope-first index only; it does not create HNSW or IVFFlat indexes.
  Exact cosine recall filters bot, DM actor or channel/tenant/team/binding,
  provider, model, dimension, index version, source revision and revocation
  before limiting results. Search reports `semantic` or `lexical_only` with a
  fixed fallback reason, and its optional metrics callback receives only
  duration and those fixed labels, never query or memory text.
- The synthetic fixture uses the pinned `pgvector/pgvector:pg18-bookworm`
  image in a disposable PostgreSQL service. It runs ordinary migrations,
  proves the optional migration works as a non-superuser after extension
  installation, verifies transactional rollback and the BTREE query plan,
  tests synonym-style semantic lookup with a fixture provider, checks
  cross-actor isolation, daily budget fallback and immediate revocation, then
  restores a `pg_dump` snapshot and verifies both source facts and vectors.
  The ordinary PostgreSQL 18 job continues to test startup without vector.
  No Gate-Local extension, image switch, migration, provider call or runtime
  deployment occurred; M2 remains `PAUSED / BLOCKED_BY_RELEASE_ENGINEERING`.
- This phase provides provider and SQL foundations only. It does not verify
  a real model ID, provider entitlement, billing, semantic quality, production
  latency, or connect `GateMemoryStore` to Agent prompt assembly. The fixture
  proves code paths with synthetic vectors; real model and Gate-Local
  acceptance remain separate authorizations.

P2 source changes are in `apps/pubg-saas/src/application/gate-memory-*`,
`apps/pubg-saas/src/infrastructure/ai/gate-memory-embedding-*`, migrations
`0024` and `0025`, the focused provider/foundation/pgvector tests, and
`.github/workflows/pubg-saas.yml`.

## P3 scoped hybrid recall and prompt injection boundary — 2026-10-16

- Migration `0026_gate_memory_retrieval_metadata.sql` adds source kind,
  reliability, expiry, and supersession metadata. Recall SQL excludes
  revoked, superseded, expired, and unknown-source facts before ranking.
  Exact, lexical, and semantic searches all run under one freshly resolved
  scope; every database statement retains its current ingress lease and
  binding-generation fence.
- `MemoryRetriever` requests exact/key, lexical, and semantic candidates in
  parallel, then combines them with reciprocal-rank fusion, source reliability,
  freshness, a semantic threshold, canonical-key/revision deduplication, and
  a minimum relevance threshold. It returns fixed `hybrid`, `lexical_only`,
  or `disabled` modes and fixed reason labels. Diagnostic metrics contain only
  counts, duration, mode, and reason; prompt context omits source event IDs.
- Every natural-language Agent turn attempts recall without a keyword trigger.
  Missing scope or retrieval failures yield no memory context and do not stop
  ordinary chat. Current-message tools retain their independent authorization.
  Recalled text is injected as bounded user-role data under explicit
  instructions to ignore embedded commands and never use memory as identity,
  authorization, or PUBG evidence. The 1,000-token long-term slot is fitted
  with the same conservative estimator used by context planning.
- Focused synthetic tests cover paraphrased semantic recall through the real
  AI SDK Agent, untrusted prompt-injection content, ordinary chat without
  memory, lexical timeout/unconfigured fallback, authorization failure,
  revocation before vector deletion, and old versus new channel binding
  revisions. The optional pgvector fixture also verifies backup/restore.
  No provider API request or Gate-Local connection, migration, or deployment
  was made; M2 remains `PAUSED / BLOCKED_BY_RELEASE_ENGINEERING`.

P3 source changes are in `apps/pubg-saas/src/application/gate-memory-*`,
`gate-context-builder.ts`, `kook-public-query-handler.ts`,
`kook-conversation-agent.ts`, migration `0026`, and focused retriever,
context-builder, foundation, and pgvector tests.

## P4 explicit DM writer and revocation — 2026-10-16

- The public KOOK handler sends only a current **direct message** to a bounded
  AI SDK tool call with a strict Zod intent schema. It sees no conversation
  history, permissions, tenant/channel selection, database tools, or SQL. A
  group message bypasses the writer before classification. Normal chat proceeds
  when the classifier returns `none`; model and schema failures do not create
  a write suggestion.
- `GateMemoryWriteCoordinator` re-resolves the current trusted DM ingress
  scope. It accepts only high-confidence self-authored explicit requests with
  verbatim evidence. Only stable preferences and verifiable facts can be
  saved; sensitive disclosures, third-party subjects, instruction/prompt
  injection, self-harm or harm-risk text, episodic events, and ephemeral
  context are refused. Stable preferences have no expiry; verifiable facts
  require a 30- or 90-day validity window. Writes use canonical keys, trusted
  source provenance and reliability, duplicate/conflict checks, revision CAS,
  and the existing current-lease SQL fence.
- A new explicit `remember` after a tombstone invokes `rememberAgain`, whose
  database fence requires a newly received event after revocation. Replays of
  an event consult its receipt before classification; the unique DM event
  constraint and idempotency hash prevent a retry from creating another
  mutation. Migration `0027_gate_memory_write_receipts.sql` stores scope/event
  identifiers, canonical key and outcome, but no memory content. Group shared
  memory remains unwritable.
- A user can list, correct and forget personal DM facts. Listing displays
  source category, revision, update date, and validity when present. Revocation
  excludes a fact from lexical and semantic recall immediately; vector deletion
  remains queued. Forgetting a memory does **not** delete its raw KOOK
  transcript, protected backups, or the content-free idempotency receipt; the
  receipt currently has no automatic expiry. `/pubg privacy` explains this
  lifecycle, including persistent transcript retention.
- The isolated PostgreSQL synthetic KOOK fixture exercises remember/replay,
  conflict, CAS correction, list, expiring fact, sensitive and third-party
  refusal, immediate forget/no recall, explicit restore, another actor's DM
  isolation, and group bypass. It does not connect to Gate-Local or send a real
  provider request. M2 remains `PAUSED / BLOCKED_BY_RELEASE_ENGINEERING`.

P4 source changes are in `gate-memory-store.ts`, new
`gate-memory-writer.ts`, `kook-public-query-handler.ts`, `gateway.ts`,
migration `0027_gate_memory_write_receipts.sql`, focused writer fixtures, and
the KOOK privacy notice. Async consolidation, automated learning, and runtime
deployment remain out of scope.
