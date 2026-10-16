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
