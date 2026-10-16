# Gate memory package boundary

This document records the current source boundary for `@agent/memory` and its
Gate adapter. Gate-specific authorization and persistence stay in the SaaS app.

## Current ownership

| Concern | Current implementation | Gate-specific coupling |
| --- | --- | --- |
| Trusted identity and read/write authorization | `PublicQueryAuthorizer` plus `KookIngressJob` | KOOK bot, actor, direct-message/channel scope, team binding revision, active lease |
| Long-term memory storage and lexical search | `application/gate-memory-store.ts` | PostgreSQL `gate_memory_entries`, ingress lease checks, KOOK scope SQL, embedding job/budget tables |
| Recall selection and semantic/lexical fusion | `@agent/memory` `MemoryRecallService`; `application/gate-memory-retriever.ts` adapter | Supplies Gate authorization, PostgreSQL search, embedding calls and content-free usage-signal persistence |
| Explicit remember/correct/forget | `@agent/memory` `MemoryWriteService`; `application/gate-memory-writer.ts` adapter | AI SDK intent classifier plus Gate receipts, ingress scope, PostgreSQL writes and KOOK replies |
| Automatic learning admission and per-user controls | `application/gate-memory-consolidation.ts` consent service | KOOK DM identity, transcript/event joins, consent versions, PostgreSQL leases and admission rows |
| Light/REM candidate normalization and source-evidence matching | `@agent/memory` `normalizeMemoryCandidates` | Gate schema parsing, key canonicalization, sensitive-text rejection and idempotency salt |
| Light/REM/Deep stage order and bounded drain | `@agent/memory` Dreaming runner | Gate worker adapter loads consent-scoped sources, invokes the planner and persists candidates |
| Deep promotion policy | `@agent/memory` deterministic evidence policy plus the Gate worker adapter | Gate adapter loads consent-scoped evidence, usage signals, tombstones, and revision CAS state |
| Nightly schedule calculation and durable run claim | `@agent/memory` schedule functions; `application/gate-memory-dreaming.ts`, `PostgresGateMemoryDreamingRunStore`, migration `0031` | Gate Bot identity, timezone config, PostgreSQL idempotency row and Gateway lifecycle |
| Host-facing memory plugin | `application/gate-memory-plugin.ts` implements `AgentMemoryPlugin<KookIngressJob>` | Binds each call to the current trusted ingress lease and composes Gate adapters |
| Embedding config and provider | `infrastructure/ai/gate-memory-embedding-{config,provider}.ts` | Gate environment names and Gate public-egress policy; provider construction belongs in the adapter |
| Embedding indexing and generations | `application/gate-memory-index-{worker,generation}.ts` | PostgreSQL migrations, Gate binding-version SQL, Gate batch admin command |
| Runtime defaults and wiring | `@agent/memory` `AgentMemoryRuntime`; `application/gate-memory-feature-flags.ts`, `gateway.ts` | Gate environment flags, model, pool and lifecycle |
| User commands and privacy text | `application/kook-management-handler.ts`, `gate-memory-admin.ts` | KOOK command syntax, owner/admin process and runtime config |
| Schema and migrations | `infrastructure/postgres/migrations/0021` through `0031` (`0025` remains optional) | Gate PostgreSQL migration runner and deployment lifecycle |

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
- `gate-memory-dreaming.test.ts` covers local 03:00 calculation, no startup
  catch-up, Light/REM/Deep ordering, and next-date retry after failure;
  `gate-memory-dreaming.integration.test.ts` verifies the PostgreSQL claim is
  unique across concurrent runs.
- `gate-memory-plugin.test.ts` covers Gate's unified plugin routes and refuses
  group or mismatched-source observations.
- `gate-memory-deep.integration.test.ts` covers evidence consolidation,
  across-day promotion, recall/use support, correction revisions, forget
  barriers, and sensitive, third-party, and prompt-injection rejection.

## Extraction constraints and known gaps

The generic package owns memory contracts, candidate normalization and
source-evidence matching, retrieval policies, scoring/fusion, content-free
usage signals, Deep scoring, explicit write lifecycle and conflict detection,
feature defaults, plugin operation routing, and timezone-aware nightly
schedule calculation. Gate exposes these through
one host adapter implementing `AgentMemoryPlugin<KookIngressJob>` and supplies
Gate-specific authorization, transcript provenance, persistence, content
safety checks, and the Light/REM/Deep data worker. The package owns stage order,
bounded orchestration, reusable recall and write lifecycle, promotion policy,
and local-time schedule calculation.

Gate must retain identity, authorization, transcript/event provenance, consent
commands, PostgreSQL adapters/migrations, provider configuration and runtime
wiring. The current `KookIngressJob`, Pool types, Gate SQL and environment keys
must not cross into `@agent/memory`.

At the original baseline `gateway.ts` ran Light every 30 seconds and REM every
six hours. P2 removed direct Light/REM promotion. P3 adds deterministic Deep
evidence scoring and a Gate adapter that revalidates consent and source
provenance before a revision-CAS write. P4 replaces both timers with a single
Gateway scheduler for the next configured local 03:00 and persists one
content-free claim per Bot, timezone, and local date. The package runs bounded
Light, REM, then Deep stages over Gate's scoped worker. The Gate Gateway now
constructs one `GateMemoryPlugin` over the package's `AgentMemoryRuntime`;
query recall, trusted DM observation, explicit writes, use signals,
management commands, and scheduled Dreaming go through that instance. The
Gate write coordinator retains intent classification, user responses,
idempotency receipts, and Gate authorization while delegating revision-aware
create/correct/forget decisions to the package.

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
values; confidence from the planner is not sufficient. Candidate normalization
rejects weak or non-self drafts, unsupported validity, missing source evidence
and canonical-key duplicates. The Gate adapter supplies the sensitive-text and
prompt-injection filter, KOOK key canonicalizer and consent-scoped idempotency
salt, then revalidates source text before writing.
Forget tombstones cannot be restored by Deep; explicit remember/correct stays
immediate. P4 schedules one Light -> REM -> Deep pass at local 03:00, records
failure using a fixed code, and retries at the next scheduled date.
