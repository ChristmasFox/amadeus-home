# Gate Memory Plugin Extraction Goal

Status: **APPROVED_FOR_IMPLEMENTATION_AND_AUTOMATED_GATE_LOCAL_DEPLOYMENT**

## 1. Goal

Extract Gate's memory implementation from `apps/pubg-saas` into a reusable package and simplify its runtime model around one nightly Dreaming cycle.

This Goal is intentionally narrow:

1. create `@rine-kit/agent-memory` as a reusable in-repo package;
2. move generic memory logic out of Gate;
3. keep Gate-specific identity, authorization, KOOK transcript access and PostgreSQL wiring in thin adapters;
4. replace the current 30-second Light / 6-hour REM loops with one daily 03:00 Dreaming run;
5. model Dreaming as Light -> REM -> Deep;
6. keep explicit remember / correct / forget immediate;
7. keep ordinary conversation learning asynchronous;
8. preserve current recall behavior and isolation;
9. after CI passes, automatically deploy Gate-Local through the existing simplified candidate path.

Do **not** introduce OpenClaw into Gate. OpenClaw is design evidence only.

## 2. Non-goals

Do not:

- build a second Agent runtime;
- add a separate memory microservice;
- add Redis, Kafka, Qdrant, a new database, or a new scheduler service;
- introduce a new plugin framework just for memory;
- create approval manifests, SHA exception lists, per-SQL authorization files, migration tokens, image-ID equality gates, or phase-by-phase deploy prompts;
- copy OpenClaw source wholesale;
- change Gate's KOOK auth model;
- change PUBG behavior;
- couple Gate runtime to Lab memory, Lab SQLite, Lab sessions, Lab credentials, or Lab schedules;
- redesign all existing memory tables unless a concrete migration requires it;
- require users to opt in before memory works.

Prefer moving and simplifying existing code over rewriting working pieces.

## 3. Product behavior

### 3.1 During normal conversation

For a trusted DM:

1. Gate persists its normal conversation transcript.
2. Gate passes a bounded, trusted observation to `@rine-kit/agent-memory.observe()`.
3. The observation becomes eligible short-term/episodic material.
4. Do not run Light, REM or Deep in the reply path.
5. Existing long-term memory recall remains available before the Agent response.
6. Memory subsystem failure must not block the reply.

Group chat must not become personal DM memory.

### 3.2 Explicit memory commands

These remain immediate:

- "记住..."
- correction of an existing memory;
- forget/delete;
- list memories.

Explicit trusted user memory writes do not wait for 03:00 Dreaming.

### 3.3 Automatic learning

Ordinary conversation does **not** directly become durable long-term memory.

It enters short-term/episodic state with provenance. The nightly Dreaming job decides what should be consolidated or promoted.

Automatic learning is default-on. A user may explicitly opt out with existing Light/REM off controls if retained. Do not require opt-in.

### 3.4 Nightly Dreaming

Run once per day at **03:00 in Gate-Local's configured local timezone**.

One run performs, in order:

```text
Light
  -> REM
  -> Deep
```

There is no 30-second Light poller and no six-hour REM timer.

At startup, do not immediately execute a missed Dreaming sweep unless a simple bounded catch-up rule is explicitly implemented and tested. Avoid a restart storm.

The scheduler should calculate the next 03:00 and sleep until then. No external cron service is required unless the existing runtime already provides one more simply.

## 4. Memory package boundary

Create:

```text
packages/agent-memory/
  package.json
  tsconfig.json
  src/
    index.ts
    plugin.ts
    contracts.ts
    recall/
    dreaming/
    ports/
```

Keep the package small. Exact file count is not a requirement.

### 4.1 `@rine-kit/agent-memory` owns

Generic concepts:

- memory entry and candidate types;
- episodic/short-term observations;
- recall request/result contracts;
- lexical/semantic fusion logic where already generic;
- recall/use signal recording;
- Light processing;
- REM consolidation;
- Deep promotion;
- promotion scoring/policy;
- conflict/supersede decisions;
- generic memory lifecycle;
- scheduler calculation for nightly Dreaming;
- feature defaults: memory works unless explicitly disabled.

### 4.2 Gate owns

Gate-specific concerns stay in `apps/pubg-saas`:

- KOOK ingress and reply handling;
- bot/user/channel identity;
- tenant/team/binding authorization;
- current trusted-ingress fence;
- conversation transcript tables;
- PostgreSQL pool creation;
- Gate migration execution;
- Gate model/provider configuration;
- Gate embedding provider configuration;
- privacy/management commands;
- runtime logging and deployment.

Gate supplies adapters implementing package ports.

### 4.3 Package must not know

`@rine-kit/agent-memory` must not import or depend on:

- KOOK types;
- PUBG types;
- Gate request handlers;
- Gate tenant/team bindings;
- OpenClaw;
- Lab;
- concrete secrets;
- concrete host names.

## 5. Minimal plugin contract

Use a small contract; do not invent a large plugin platform.

Target shape:

```ts
interface AgentMemoryPlugin {
  observe(turn: MemoryObservation): Promise<void>;
  recall(request: MemoryRecallRequest): Promise<MemoryRecallResult>;
  remember(write: ExplicitMemoryWrite): Promise<MemoryWriteResult>;
  forget(request: MemoryForgetRequest): Promise<MemoryWriteResult>;
  runDreaming(): Promise<DreamingReport>;
  health(): Promise<MemoryHealth>;
}
```

The exact TypeScript names may change if the repository has a cleaner convention. Keep the surface roughly this small.

Adapters provide storage/model/embedding/clock/logging/scope capabilities.

## 6. Light / REM / Deep

Do not overcomplicate these phases.

### Light

Purpose:

- process recent eligible observations;
- normalize obvious stable preferences/facts/episodic checkpoints;
- deduplicate near-identical material;
- keep provenance;
- produce or update short-term candidates.

Light does **not** blindly promote everything durable.

### REM

Purpose:

- consolidate repeated or related candidates;
- detect contradictions and replacements;
- connect observations that support the same concept;
- reduce duplicate candidate noise;
- maintain useful episodic summaries.

REM does not need a graph database.

### Deep

Deep is the only automatic path that promotes ordinary-conversation material into long-term memory.

Promotion should use simple evidence, not only LLM confidence. At minimum consider:

- source reliability;
- number of supporting observations;
- recall count;
- number of distinct queries that recalled it;
- recency;
- repetition across more than one day when applicable;
- conflict state;
- whether the item is sensitive or prohibited.

Do not copy OpenClaw thresholds blindly. Start with understandable defaults and tests.

A high-confidence model output alone is insufficient for permanent promotion.

Explicit user "remember this" remains an exception and can write immediately.

## 7. Recall

Keep current Gate recall behavior working while extracting it.

The package should support:

- exact/key lookup;
- lexical recall;
- semantic recall when embeddings are configured;
- explainable fusion;
- bounded top-K;
- token budget;
- revoked/superseded/expired filtering;
- source provenance;
- fallback to lexical when embeddings are unavailable.

Embedding remains capability-detected:

- complete config -> use it;
- missing config -> lexical fallback;
- explicit disable -> off.

Do not block Gate startup because semantic recall is unavailable.

Each recalled memory should record lightweight usage signals required for later Deep promotion.

## 8. Storage

Reuse the existing PostgreSQL memory schema where practical.

Do not migrate tables merely to achieve aesthetic purity.

Add only the smallest schema changes required for:

- episodic/short-term observations if the existing consolidation tables cannot represent them cleanly;
- recall/use counters or events needed by Deep;
- last successful Dreaming run / scheduler state if needed.

Prefer additive, backward-compatible migrations.

No pgvector image/extension change is required by this Goal. Existing lexical fallback remains valid.

## 9. Existing code to extract or replace

Review and refactor the current Gate memory implementation, including:

- `gate-memory-store.ts`
- `gate-memory-retriever.ts`
- `gate-memory-writer.ts`
- `gate-memory-consolidation.ts`
- embedding/index helpers
- memory feature flags
- memory admin helpers
- the memory scheduler currently in `gateway.ts`

After extraction, `gateway.ts` should only construct the plugin/adapters and attach recall/observe behavior. It must not contain Light/REM scheduling algorithms.

Delete dead compatibility code after migration. Do not keep two memory implementations.

## 10. Migration sequence

### P0 — Freeze behavior and map ownership

- Capture current tests for explicit remember/correct/forget, recall, lexical fallback, embedding fallback, DM isolation and binding isolation.
- Add a regression test proving normal replies do not wait for Dreaming.
- Add a regression test proving explicit remember still writes immediately.
- Document the current package boundary before moving code.

No deployment pause after this phase.

### P1 — Create `@rine-kit/agent-memory`

- Add the workspace package.
- Move generic types, recall policies and reusable logic.
- Define minimal storage/model/embedding/clock/log ports.
- Keep adapters in Gate.
- Keep all existing behavior passing.

Do not add new infrastructure.

### P2 — Replace direct auto-promotion with episodic learning

- Natural DM messages become short-term/episodic observations.
- Stop promoting ordinary chat directly from Light/REM into long-term memory.
- Keep explicit writes immediate.
- Record provenance and recall/use signals.

### P3 — Implement Light -> REM -> Deep

- Light: normalize/dedupe candidates.
- REM: consolidate/reconcile.
- Deep: decide long-term promotion from evidence + usage signals.
- Add tests for:
  - one casual mention not promoted;
  - repeated preference across days can be promoted;
  - recalled/useful candidate gains promotion evidence;
  - corrected preference supersedes old value;
  - explicit forget is never resurrected;
  - sensitive/third-party/prompt-injection material never promotes.

### P4 — Nightly 03:00 scheduler

- Remove 30-second Light loop.
- Remove six-hour REM loop.
- One scheduler calculates the next local 03:00.
- One Dreaming run executes Light -> REM -> Deep.
- Persist enough run state to avoid duplicate concurrent sweeps.
- A failed Dreaming run logs the failure and retries on the next scheduled run; it must not break chat.
- Do not invent a distributed scheduler.

### P5 — Gate integration cleanup

- Gate constructs one `AgentMemoryPlugin`.
- Query path calls `recall()`.
- Trusted DM path calls `observe()`.
- Explicit memory intents call `remember()/forget()`.
- Remove obsolete Gate-specific memory implementation files or reduce them to adapters.
- Update docs/privacy text to match real behavior.

### P6 — CI and automatic Gate-Local deployment

Run the existing affected CI:

- package build/typecheck;
- memory unit tests;
- PostgreSQL integration tests;
- Gate isolation tests;
- pgvector fixture test where already part of CI;
- compose/multiarch image build;
- Lab regression for shared package impact.

When CI is green:

1. use the existing Gate-Local candidate deployment path;
2. build the candidate;
3. run only the migrations that actually exist for this change;
4. update Gate containers;
5. wait for health;
6. run a small synthetic smoke;
7. report deployment result.

**Do not stop for normal compatible migrations, old/new image-ID differences, per-file authorization, per-SQL approval, or another human confirmation.**

If application startup or health fails, roll back the application candidate and report the actual error.

Only a genuinely destructive/unrecoverable database change may stop automatic deployment. This Goal should not need one.

## 11. Acceptance criteria

Source is complete when:

1. `@rine-kit/agent-memory` exists and contains the generic memory runtime.
2. Gate uses the plugin through adapters.
3. Gate no longer contains a 30-second Light timer.
4. Gate no longer contains a six-hour REM timer.
5. automatic Dreaming runs once daily at 03:00 local time.
6. Dreaming order is Light -> REM -> Deep.
7. ordinary chat does not directly auto-promote to long-term memory.
8. explicit remember/correct/forget stays immediate.
9. Deep uses evidence/usage signals, not only model confidence.
10. DM/group/multi-user/multi-bot isolation still passes.
11. forgotten memory cannot be silently resurrected.
12. semantic recall degrades cleanly to lexical.
13. chat works even when Dreaming/model/embedding fails.
14. CI passes.
15. Gate-Local candidate is automatically deployed and health-checked.

Final report must separate:

- `SOURCE_COMPLETE`
- `CI_GREEN`
- `GATE_LOCAL_DEPLOYED`
- `GATE_LOCAL_HEALTHY`

If deployment fails, report `ROLLED_BACK` plus the real runtime error. Do not invent a policy blocker.

## 12. Implementation discipline

- Prefer deletion over compatibility layers.
- Prefer existing tables/adapters over new infrastructure.
- Prefer one scheduler over multiple timers.
- Prefer one small plugin interface over a plugin framework.
- Prefer moving working code over rewriting it.
- Keep changes reviewable and commit by coherent milestones.
- Do not modify Lab runtime.
- Do not touch Gate-Prod.
- Do not create a formal release/tag.
- Do not reopen deployment-gate design unless an actual runtime failure proves one is needed.

## Codex

Run:

```text
/goal docs/GATE_MEMORY_PLUGIN_EXTRACTION_GOAL.md
```

The Goal should continue through implementation, CI and Gate-Local candidate deployment without waiting for per-phase human approval.
