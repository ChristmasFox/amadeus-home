# Gate memory package boundary — pre-extraction baseline

This document records the implementation boundary before `@agent/memory` is
introduced. It is a migration map, not a desired permanent layout.

## Current ownership

| Concern | Current implementation | Gate-specific coupling |
| --- | --- | --- |
| Trusted identity and read/write authorization | `PublicQueryAuthorizer` plus `KookIngressJob` | KOOK bot, actor, direct-message/channel scope, team binding revision, active lease |
| Long-term memory storage and lexical search | `application/gate-memory-store.ts` | PostgreSQL `gate_memory_entries`, ingress lease checks, KOOK scope SQL, embedding job/budget tables |
| Recall selection and semantic/lexical fusion | `application/gate-memory-retriever.ts` | Uses Gate store entry types and embedding client; ranking and explanation are generic candidates for extraction |
| Explicit remember/correct/forget | `application/gate-memory-writer.ts` | AI SDK intent classifier plus Gate receipts, ingress scope, PostgreSQL writes and KOOK replies |
| Automatic learning admission and per-user controls | `application/gate-memory-consolidation.ts` consent service | KOOK DM identity, transcript/event joins, consent versions, PostgreSQL leases and admission rows |
| Light/REM candidate planning and persistence | `application/gate-memory-consolidation.ts` worker | AI SDK planner, Gate source provenance, candidate SQL, CAS against long-term memory and vector jobs |
| Deep promotion policy | `@agent/memory` deterministic evidence policy plus the Gate worker adapter | Gate adapter loads consent-scoped evidence, usage signals, tombstones, and revision CAS state |
| Embedding config and provider | `infrastructure/ai/gate-memory-embedding-{config,provider}.ts` | Gate environment names and Gate public-egress policy; provider construction belongs in the adapter |
| Embedding indexing and generations | `application/gate-memory-index-{worker,generation}.ts` | PostgreSQL migrations, Gate binding-version SQL, Gate batch admin command |
| Runtime defaults and wiring | `application/gate-memory-feature-flags.ts`, `gateway.ts` | Gate environment flags, model, pool and lifecycle |
| User commands and privacy text | `application/kook-management-handler.ts`, `gate-memory-admin.ts` | KOOK command syntax, owner/admin process and runtime config |
| Schema and migrations | `infrastructure/postgres/migrations/0021` through `0029` | Gate PostgreSQL migration runner and deployment lifecycle |

## Existing behavior evidence

- `gate-memory-writer.integration.test.ts` covers immediate explicit remember,
  correction, listing, forget/tombstone, receipts, scope checks and replay.
- `gate-memory-retriever.test.ts`, `gate-memory-pgvector.test.ts` and
  `gate-memory-recall-eval.test.ts` cover lexical/semantic retrieval, fallback,
  bounded context and explainable results.
- `gate-memory-foundation.test.ts` and the PostgreSQL/vector suites cover
  direct-message and channel/binding scope isolation and revoked writes.
- `gate-memory-embedding-provider.test.ts` covers capability detection,
  invalid config, bounded requests and provider failure.
- `gate-memory-consolidation.integration.test.ts` covers consent versions,
  admitted-source provenance, Light/REM batching, candidate persistence,
  revocation races and group exclusion. A regression in the same suite asserts
  ordinary replies finish while a background Dreaming planner is still blocked.
- `gate-memory-deep.integration.test.ts` covers evidence consolidation,
  across-day promotion, recall/use support, correction revisions, forget
  barriers, and sensitive, third-party, and prompt-injection rejection.

## Extraction constraints and known gaps

The generic package should take the pure memory contracts, candidate/retrieval
policies, scoring/fusion, lifecycle, Light/REM/Deep orchestration, and nightly
schedule calculation. It must communicate through small ports for storage,
model planning, embeddings, clock and logging.

Gate must retain identity, authorization, transcript/event provenance, consent
commands, PostgreSQL adapters/migrations, provider configuration and runtime
wiring. The current `KookIngressJob`, Pool types, Gate SQL and environment keys
must not cross into `@agent/memory`.

At the original baseline `gateway.ts` ran Light every 30 seconds and REM every
six hours. P2 removed direct Light/REM promotion. P3 adds deterministic Deep
evidence scoring and a Gate adapter that revalidates consent and source
provenance before a revision-CAS write. The nightly scheduler remains planned
Goal work.

## P2 behavior update

Ordinary DM Light/REM output is retained as an expiring, source-linked
candidate observation. The worker no longer writes it to `gate_memory_entries`
or queues embeddings. A person may still explicitly confirm a candidate, and
explicit remember/correct/forget remains immediate. Recall and successful
prompt-use signals retain memory key/revision, source and request event IDs,
and a normalized query fingerprint for 90 days; query text and memory content
are not copied into the signal table.

## P3 behavior update

REM folds matching same-key, same-value candidates while retaining only live
source events under the current consent version. Deep requires at least two
supporting observations from a reliable self-authored DM source. They must be
repeated across two UTC dates, or supported by distinct recall queries and an
actual-use signal. The deterministic policy scores source reliability,
observation count, dates, recalls, distinct queries, use, recency, and competing
values; confidence from the planner is not sufficient. The Gate adapter filters
sensitive, third-party, and prompt-injection source text again before writing.
Forget tombstones cannot be restored by Deep; explicit remember/correct stays
immediate. P4 still owns scheduling Light -> REM -> Deep at local 03:00.
