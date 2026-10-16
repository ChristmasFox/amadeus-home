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

## Extraction constraints and known gaps

The generic package should take the pure memory contracts, candidate/retrieval
policies, scoring/fusion, lifecycle, Light/REM/Deep orchestration, and nightly
schedule calculation. It must communicate through small ports for storage,
model planning, embeddings, clock and logging.

Gate must retain identity, authorization, transcript/event provenance, consent
commands, PostgreSQL adapters/migrations, provider configuration and runtime
wiring. The current `KookIngressJob`, Pool types, Gate SQL and environment keys
must not cross into `@agent/memory`.

Today `gateway.ts` runs Light every 30 seconds and REM every six hours. The
current consolidation workflow has no Deep phase and can promote an eligible
candidate directly from Light/REM; this does not meet the approved Goal's
episodic-first and evidence-based Deep requirements. Existing migrations and
tests are the baseline to preserve while changing that behavior.
