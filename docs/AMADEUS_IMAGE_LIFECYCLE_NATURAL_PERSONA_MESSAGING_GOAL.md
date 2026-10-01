# Amadeus Image Lifecycle Natural Persona Messaging — Corrective Goal

Date: 2026-10-01
Target release: **Amadeus 1.7.5**
Parent Goal: `docs/AMADEUS_IMAGE_GENERATION_LIFECYCLE_CAPTION_UX_GOAL.md`
Baseline: DeliveryEnvelope v2 + typed OpenClaw 2026.9.4 image lifecycle integration

## Operator authorization

The operator explicitly authorizes this Goal to run unattended through implementation, validation, version bump, immutable image build, production apply, automated post-deploy verification, documentation, commit and push.

Manual owner WhatsApp acceptance is **waived for this run**. Do not stop to request a second deployment confirmation. If a required technical gate fails, rollback is mandatory and the Goal must remain incomplete.

Target product version is **1.7.5**. The implementation run must bump the repository's canonical Amadeus version to 1.7.5 before building the production candidate.

## Problem

Current image lifecycle text degrades too easily into canned output:

- accepted/start fallback is fixed Japanese;
- failed fallback is fixed Japanese;
- success caption fallback is fixed Chinese (`图已经生成了。`);
- accepted/failed semantic timeout is about 2 seconds;
- success caption timeout is about 7–8 seconds;
- accepted/failed semantic generation receives only `kind + agentId`, losing original request language/context.

Normal-path text should instead be naturally authored by the current Kurisu persona in the user's current language, with a generous ~30 second semantic budget.

## Protected architecture

Do not redesign or regress:

- authoritative detached `image_generate` lifecycle;
- the single pinned OpenClaw 2026.9.4 lifecycle integration;
- authoritative persisted `attachments[]`;
- image asset registry and file-safety checks;
- DeliveryEnvelope v2 and the single settlement ledger;
- WhatsApp native same-bubble `image + caption` delivery;
- Telegram native media caption;
- upscale `document` delivery;
- default 2x / explicit 4x upscale;
- normal text / voice / TTS delivery.

Do not restore retired `llm_input/historyMessages` recovery, pending media senders, visible-text media protocols, model-authored file paths, dual delivery ownership, keyword routing or cleanup hacks.

## 1. Context-rich lifecycle semantic contract

Replace the current `kind + agentId`-only call with a typed input carrying at least:

```ts
type ImageLifecycleMessageInput = Readonly<{
  kind: 'accepted' | 'failed';
  taskId: string;
  agentId: string;
  sessionKey: string;
  channel: 'whatsapp' | 'telegram';
  requestContext?: string;
}>;
```

Exact names may follow repository conventions. `requestContext` must be bounded and treated as untrusted context-only data. Routing, task identity and media ownership remain runtime-owned.

## 2. Natural Kurisu messaging and language continuity

Accepted and failed messages should be authored by the current Kurisu persona and instructed to:

- use the language of the user's current request/conversation when clear;
- respond naturally rather than with a canned sentence;
- for accepted: say generation has started, never claim completion;
- for failed: clearly say generation failed and the user may retry/change the request;
- output only safe visible text;
- never expose internal runtime details.

Desired behavior:

```text
Chinese request -> Chinese
Japanese request -> Japanese
English request -> English
ambiguous -> existing scoped conversation/Agent language behavior
```

Do not replace the current fixed Japanese string with a fixed Chinese string and call the issue solved.

## 3. Unified ~30 second semantic budget

Use one approximately **30 second wall-clock application budget** for each semantic operation:

- accepted lifecycle message;
- failed lifecycle message;
- success multimodal caption.

Provider/model timeout should be slightly below the overall deadline so normalization/fallback has a small margin. Do not stack nested 30 second waits into a 60 second path.

Hard invariants:

```text
accepted-message timeout != cancel generation
failure-message timeout  != retry generation
caption timeout          != lose successful image
```

Tests must prove calls lasting longer than the old 2s / 7–8s limits can still succeed.

## 4. Fallback policy

### Accepted
1. natural Kurisu result within budget;
2. safe deterministic acknowledgement only if semantic generation genuinely fails;
3. acknowledgement failure never cancels the already accepted background job.

Do not use unconditional Japanese fallback for every user.

### Failed
1. natural Kurisu result within budget;
2. one safe deterministic failure notice if semantic generation is unavailable;
3. failure may not disappear silently.

### Success caption
1. valid Kurisu multimodal caption from the actual generated image;
2. **no caption**.

Remove `图已经生成了。` as production success fallback. Do not call another model just to fabricate fallback prose.

## 5. Success caption remains actual-image enrichment

Preserve:

```text
authoritative attachment
 -> validated asset
 -> CaptionEnricher sees actual generated image
 -> optional AttachmentPart.caption
 -> DeliveryEnvelope v2
 -> one native WhatsApp image send
```

Caption must still use the actual image, bounded request context and current Kurisu persona, preserve the user's language when clear, obey native caption limits, and reject protocol-like output.

Caption absence must be represented intentionally rather than by inserting canned text.

## 6. Idempotency and telemetry

Preserve existing taskId semantics: accepted at most once, one terminal state, success/failure mutually exclusive, retries do not duplicate image or failure notice, late failure after success remains suppressed/audited, and success caption is never sent as a separate WhatsApp text message.

Add bounded telemetry sufficient to distinguish generated text from fallback, including lifecycle stage, semantic status, elapsed milliseconds, channel, taskId and whether request context was present. Do not log raw user/model/media content.

## 7. Version 1.7.5

During implementation:

1. inspect the canonical Amadeus version source(s);
2. bump the canonical product version to `1.7.5`;
3. update only required mirrored/generated metadata according to repository conventions;
4. validate version consistency in tests/build;
5. verify the deployed runtime reports 1.7.5.

The planning commit itself is not the 1.7.5 release; the implementation/deployment run owns the version bump.

## 8. Required implementation flow

### Phase 0 — inspect current truth

Read `AGENTS.md`, `docs/CONTEXT.md`, `docs/CURRENT_TASK.md`, this Goal, the parent image lifecycle Goal, background-completion Goal, DeliveryEnvelope Goal, `ARCHITECTURE.md`, `PROJECT_STATE.md`, Git HEAD/status/log and current live runtime/version.

Inspect current lifecycle-message, caption, delivery-boundary, lifecycle coordinator, version metadata and related tests. Do not assume source is unchanged from the observations that created this Goal.

### Phase 1 — source correction

Implement the context-rich lifecycle semantic contract, language continuity, ~30s budgets, success no-caption fallback and telemetry without changing media ownership.

### Phase 2 — tests

At minimum prove:

- requestContext/session/channel reach accepted/failed semantic generation;
- Chinese/Japanese/English request language can be preserved naturally;
- lifecycle calls >2s can succeed;
- caption calls >8s can succeed;
- all semantic operations use ~30s bounded deadlines without nested timeout multiplication;
- accepted timeout does not cancel generation;
- failed timeout still produces one safe notice;
- caption timeout/model error/invalid/unsupported still sends exactly one image;
- canned `图已经生成了。` is absent from success fallback;
- caption failure sends image with caption omitted;
- successful caption remains one native same-bubble image send;
- duplicate/retry/late-terminal behavior remains correct;
- Telegram, upscale document, 2x/4x, text/voice/TTS are non-regressed;
- retired media recovery/sender mechanisms remain absent.

Avoid real 30-second sleeps in tests; use controlled timers/promises.

### Phase 3 — validate source

Run at least:

```bash
pnpm workflow:plan
pnpm test:delivery
pnpm test:amadeus
pnpm typecheck:amadeus
pnpm build:amadeus
pnpm check:architecture
git diff --check
pnpm check:secrets
```

Run focused image lifecycle/caption/version tests and the exact pinned OpenClaw integration test if that integration is touched.

Hard failures block deployment.

### Phase 4 — version, commit and push

Bump Amadeus to 1.7.5, commit the exact implementation/tests/docs/version state, and push before building the immutable candidate.

### Phase 5 — unattended production apply

The operator authorizes automatic deployment. Follow `AGENTS.md` and the repository deployment workflow:

1. create the required protected rollback checkpoint;
2. record the currently running immutable image/config;
3. build a fresh immutable candidate from the committed 1.7.5 SHA;
4. run pre-switch candidate validation;
5. execute the canonical explicit production apply path;
6. verify OpenClaw health and real Gateway Amadeus registration;
7. verify runtime Amadeus version is 1.7.5;
8. run available automated lifecycle/caption/delivery regression smokes;
9. do not wait for manual WhatsApp owner acceptance.

If a hard deployment/health/registration/version/smoke gate fails, rollback to the protected checkpoint, verify the previous runtime is healthy, record the failure, and do not claim completion.

### Phase 6 — completion evidence

When automated gates pass, leave 1.7.5 deployed and update `CURRENT_TASK.md`, `PROJECT_STATE.md`, `CONTEXT.md`, `ARCHITECTURE.md` as appropriate. Add a content-safe deployment checkpoint recording commit, immutable image, runtime version, rollback reference and automated gate results. Explicitly record that manual owner WhatsApp acceptance was **operator-waived**, not performed.

## 9. Automated production gates

Mandatory post-apply evidence:

- immutable runtime built from the committed implementation SHA;
- running Amadeus reports 1.7.5;
- OpenClaw health passes;
- Amadeus registers in the real Gateway;
- pinned OpenClaw integration remains valid;
- direct/focused semantic smoke confirms context propagation and new timeout policy;
- direct/focused actual-image caption smoke works under the new budget;
- controlled caption failure proves the image remains deliverable and no canned success fallback is injected;
- controlled lifecycle semantic failure proves safe fallback behavior without cancelling image work;
- WhatsApp/Telegram adapter contract tests remain green;
- upscale/document and 2x/4x behavior remain green;
- text/voice/TTS regression checks remain green;
- architecture/secrets checks remain green;
- required restart/health/registration verification remains green.

If a real WhatsApp owner message cannot be generated without owner interaction, mark that manual gate as **waived by operator authorization**. Do not falsely record it as tested, and do not block completion solely on that waived manual step when all mandatory automated gates pass.

## 10. Definition of Done

Complete only when:

- lifecycle semantic input preserves bounded request/session/channel context;
- normal start/failure text is natural Kurisu output using the user's current language when clear;
- old 2s lifecycle timeout and 7–8s caption timeout are replaced by bounded ~30s budgets;
- success caption still inspects the actual generated image;
- canned `图已经生成了。` success fallback is removed;
- caption failure means image-without-caption, never image loss;
- existing lifecycle/idempotency/delivery architecture remains intact;
- all source validation passes;
- canonical Amadeus version is 1.7.5;
- implementation/version/docs are committed and pushed;
- protected rollback checkpoint exists;
- immutable 1.7.5 runtime is built from committed source;
- production apply succeeds;
- real Gateway health/registration and runtime version 1.7.5 are verified;
- mandatory automated post-deploy gates pass;
- final docs/checkpoint explicitly record the manual owner-channel waiver.

Do not stop at source implementation or candidate build. Under this Goal, successful completion means **1.7.5 is deployed and automatically verified**, unless a hard gate fails and rollback is required.

## Execution status — 2026-10-01 hard-gate stop

Implementation and canonical version `1.7.5` were committed and pushed as `a242570`. Required source validations passed, but the immutable candidate failed its pre-switch version-identity read: `/opt/amadeus/VERSION` was mode `0600`, inaccessible to the runtime `node` user. The deployment script stopped before protected runtime checkpoint creation and production apply. Production remains healthy on 1.7.4; 1.7.5 is not deployed, and the Goal remains incomplete. Do not bypass or reuse the failed candidate; any resumed attempt must build a distinct immutable candidate from corrected committed source and pass every hard gate again. See `.agent/checkpoints/2026-10-01-amadeus-image-persona-1.7.5-candidate-preflight-failed.md` and `.agent/tasks/2026-10-01-amadeus-image-persona-1.7.5-rollout-halted.md`.


## Execution status — 2026-10-01 post-apply behavior failure and rollback

A distinct 1.7.5 candidate from `e82f04d` passed preflight and production technical gates, but the operator reported English accepted text after a Chinese request and image-only success delivery. Runtime telemetry showed caption omission as `model_error` with bounded request context present. The candidate was automatically rolled back to the protected 1.7.4 source; health and Gateway Amadeus registration passed after rollback. The active source has now been corrected with explicit request-language instructions/output validation and bounded same-operation retries for language mismatch and early caption-provider errors. These corrections are not yet deployed. The Goal remains incomplete; the failed candidate must not be reused. Evidence: `.agent/checkpoints/2026-10-01-amadeus-image-persona-1.7.5-postapply-symptom-rollback.md`.


The latest local correction passes `pnpm test:delivery` (80 focused tests plus the exact pinned integration), `pnpm test:amadeus` (114 tests), typecheck/build, architecture, secrets, version/candidate fixtures and diff checks. The validated source and current-state docs are pending commit/push; no fresh candidate has been built or applied yet. Production remains on the healthy 1.7.4 rollback image.
