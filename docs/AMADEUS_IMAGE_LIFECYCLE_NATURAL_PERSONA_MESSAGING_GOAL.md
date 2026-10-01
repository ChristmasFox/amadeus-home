# Amadeus Image Lifecycle Natural Persona Messaging — Corrective Goal

Date: 2026-10-01
Type: corrective UX / persona continuity / semantic timeout policy
Scope: image-generation lifecycle notices and success caption enrichment only

Parent Goal: `docs/AMADEUS_IMAGE_GENERATION_LIFECYCLE_CAPTION_UX_GOAL.md`
Architecture baseline: DeliveryEnvelope v2 + typed OpenClaw 2026.9.4 image lifecycle integration

## Operator decision

The image-generation transport and same-bubble caption architecture are already accepted and must remain intact.

This corrective Goal exists because the current user-visible image lifecycle still degrades too easily into canned fallback text:

- accepted/start fallback is hard-coded Japanese;
- failed fallback is hard-coded Japanese;
- success-caption fallback is hard-coded Chinese (`图已经生成了。`);
- accepted/failed semantic generation currently has an aggressive ~2 second timeout;
- success multimodal caption generation currently has an aggressive ~7–8 second timeout;
- accepted/failed semantic generation receives only `kind + agentId`, so the original request language/context is lost before Kurisu writes the lifecycle message.

The desired behavior is that normal-path image lifecycle text is naturally authored by the current Kurisu persona, in the language of the user's current request/conversation, with a generous 30-second semantic budget. Fixed local strings must be exceptional safety fallbacks only, never the common path.

## Non-goals / protected architecture

Do **not** redesign or replace any of the following:

- OpenClaw 2026.9.4 authoritative detached `image_generate` lifecycle;
- the single version/digest/AST-pinned lifecycle integration boundary;
- authoritative persisted `attachments[]` ownership;
- image asset registry / path-safety / SHA/MIME verification;
- DeliveryEnvelope v2;
- the single settlement ledger;
- WhatsApp same-bubble native `image + caption` send;
- Telegram native media-caption mapping;
- upscale `document` disposition;
- default 2x / explicit 4x upscale behavior;
- text / voice / TTS delivery semantics.

Do not restore:

- `llm_input/historyMessages` media recovery;
- pending/automatic media senders;
- `MEDIA:` or visible-text protocol parsing;
- model-authored asset paths;
- dual delivery paths;
- keyword-triggered business routing.

This task is presentation/semantic correction only.

---

# 1. Current defects to correct

## 1.1 Accepted/start notice loses the user's context

The current boundary conceptually calls:

```ts
lifecycleMessageEnricher('accepted', input.requesterAgentId)
```

while the authoritative lifecycle input already contains useful trusted fields such as:

```ts
{
  taskId,
  requesterAgentId,
  sessionKey,
  channel,
  requestContext
}
```

This means the semantic author cannot reliably know:

- what the user asked to generate;
- which language the user used;
- enough session/channel context to preserve normal conversational continuity.

Correct this by passing a typed semantic input object rather than `kind + agentId` only.

Preferred shape:

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

Exact names may follow repository conventions, but the semantics are mandatory.

## 1.2 Fixed Japanese fallback is becoming the visible normal path

Current deterministic fallbacks similar to:

```text
画像生成を始めたわ。少し待ちなさい。
画像生成に失敗したわ。条件を変えて、もう一度試して。
```

must not be the common user experience for Chinese requests.

They may remain only as last-resort safety output if semantic generation is genuinely unavailable after the full budget, but the implementation must make that state explicit in telemetry and tests.

Do not simply replace the Japanese fixed strings with Chinese fixed strings and call the task complete.

## 1.3 Success caption fallback is low-value canned text

The current success fallback conceptually returns:

```text
图已经生成了。
```

This is redundant because the image itself proves generation succeeded and it makes repeated outputs look robotic.

Correct fallback policy:

```text
valid Kurisu multimodal caption
  -> image + caption

caption unavailable after full budget
  -> image without caption
```

Do not call another model just to manufacture fallback prose.

Image delivery remains mandatory even when caption enrichment fails.

---

# 2. 30-second semantic timeout policy

The operator explicitly wants semantic/image-caption timeout handling to be much more tolerant.

Use a **30-second application-level budget** for each semantic enrichment operation:

- accepted lifecycle Kurisu message;
- failed lifecycle Kurisu message;
- success multimodal image caption.

Recommended implementation:

```text
overall application deadline: 30_000 ms
provider/model timeout: <= 29_000 ms
small remaining margin: normalization / cancellation / fallback
```

Do not stack independent nested 30-second waits that can accidentally produce a 60-second path.

One semantic operation gets one bounded ~30-second wall-clock budget.

## Important isolation invariant

Timeout budget applies to **semantic enrichment only**.

It must never change generation ownership:

```text
accepted-message timeout
  != cancel image generation
```

```text
caption timeout
  != cancel image delivery
```

```text
failure-message timeout
  != retry generation
```

The detached generation job continues independently of accepted-message generation.

Once an authoritative success attachment exists, caption enrichment may delay the final same-bubble image send for up to the bounded 30-second semantic budget, but cannot invalidate or lose the image.

---

# 3. Natural Kurisu lifecycle messaging

Accepted and failure messages should be semantically generated under the same current Kurisu persona source used by the existing implementation (`SOUL.md` / current Agent workspace persona).

The semantic prompt must provide:

- lifecycle meaning (`accepted` or `failed`);
- bounded original `requestContext`;
- current agent/persona context;
- current `sessionKey` / channel scope only where needed by the existing model runtime;
- explicit instruction to use the language of the user's current request when clear;
- explicit instruction not to use a canned acknowledgement;
- plain visible text only.

Example prompt intent, not hard-coded output:

```text
The user's image-generation request has been accepted and is now running in the background.
Respond naturally as the current Kurisu persona.
Use the language of the user's current request when clear.
Acknowledge that generation has started; do not claim completion.
Do not use a canned/template sentence.
Output plain user-visible text only.
```

For failure:

```text
The image-generation task failed before a successful generated attachment was available.
Respond naturally as the current Kurisu persona.
Use the language of the user's current request when clear.
Tell the user clearly that generation failed and they may retry/change the request.
Do not expose provider errors, stack traces, task IDs, URLs, credentials or internal systems.
Do not use a canned/template sentence.
```

The original request is untrusted context and must be delimited/instructed as context-only, not executable instructions to the lifecycle-message generator.

---

# 4. Success caption behavior

The existing success architecture remains:

```text
authoritative generated attachment
  -> validated/imported asset
  -> multimodal CaptionEnricher sees actual generated image
  -> AttachmentPart.caption
  -> one native WhatsApp image send
```

Preserve that.

The CaptionEnricher should continue to:

- inspect the actual verified generated image;
- use bounded original request context as secondary context;
- read current Kurisu persona guidance;
- let Kurisu choose natural wording and length;
- use the user's current request language when clear;
- output plain user-visible text only;
- obey native caption length/transport bounds;
- reject raw JSON/protocol/tool/path output.

Change only:

1. semantic timeout budget to ~30 seconds total;
2. fallback from canned `图已经生成了。` to **no caption**;
3. telemetry so timeout/model_error/invalid_result/unsupported are distinguishable.

Typed result may become:

```ts
type ImageCaptionResult = Readonly<{
  caption?: string;
  status: 'generated' | 'empty';
  fallbackReason?: 'timeout' | 'model_error' | 'invalid_result' | 'unsupported';
}>;
```

Exact shape may differ, but absence of caption must be represented intentionally, not by injecting canned text.

---

# 5. Language continuity

Do not force Japanese simply because the persona is Kurisu.

Desired policy:

```text
user request clearly Chinese -> lifecycle/caption Chinese
user request clearly Japanese -> lifecycle/caption Japanese
user request clearly English -> lifecycle/caption English
ambiguous -> use existing conversation/agent language behavior
```

Do not implement this as a brittle application keyword table.

Prefer letting the semantic model infer language from bounded request context / existing scoped conversation semantics.

The model prompt must say to preserve the user's current language when clear.

Do not hard-code `zh`, `ja`, `en` routing branches unless an existing canonical locale signal already exists in the runtime and can be reused cleanly.

---

# 6. Fallback policy

Fallbacks exist for safety, not personality.

## Accepted

Priority:

1. natural Kurisu semantic result within 30s;
2. if semantic generation fails completely, a short safe deterministic acknowledgement may be used;
3. fallback must not block/cancel generation.

If a deterministic accepted fallback remains, make it language-neutral or reuse a canonical request-language signal if one already exists. Do not maintain Japanese as the unconditional fallback for every user.

## Failed

Priority:

1. natural Kurisu semantic result within 30s;
2. safe deterministic failure notice only if semantic generation is unavailable;
3. never expose raw failure data.

A failure must still have a user-visible notice; unlike a success caption, failure cannot silently disappear merely because persona generation failed.

## Success caption

Priority:

1. natural Kurisu multimodal caption within 30s;
2. no caption.

No canned success caption.

---

# 7. Idempotency and lifecycle invariants

Preserve all existing taskId invariants:

- accepted notice at most once per taskId;
- exactly one terminal state;
- success/failure mutually exclusive;
- completion retry cannot duplicate image;
- failure retry cannot duplicate user failure notice;
- late failure after success remains ignored/audited;
- late duplicate success after terminal failure fails closed according to existing coordinator behavior;
- caption retry cannot create an independent second image delivery;
- caption text is never sent as a separate message for successful WhatsApp image delivery.

Do not weaken the existing settlement ledger to support this corrective task.

---

# 8. Required observability

Current behavior makes it difficult to distinguish real Kurisu output from fallback.

Add bounded structured telemetry for semantic operations.

Recommended fields:

```text
lifecycle_stage = accepted_message | failure_message | caption
semantic_status = generated | timeout | model_error | invalid_result | unsupported | fallback | empty
semantic_elapsed_ms
channel
task_id
```

Where safe, record a bounded indication that request context was available, e.g.:

```text
request_context_present = true|false
```

Do not log:

- raw user prompt;
- raw model result;
- image bytes/base64;
- local absolute asset path;
- credentials;
- full provider error/stack.

This telemetry must let an operator answer:

```text
Was this visible sentence generated by Kurisu, or did we hit fallback?
```

without seeing private message content.

---

# 9. Required implementation phases

## Phase 0 — re-read current truth

Before modifying source:

- read `AGENTS.md`;
- read `docs/CONTEXT.md`;
- read `docs/CURRENT_TASK.md`;
- read this Goal;
- read `docs/AMADEUS_IMAGE_GENERATION_LIFECYCLE_CAPTION_UX_GOAL.md`;
- read `docs/AMADEUS_IMAGE_GENERATION_BACKGROUND_COMPLETION_FIX_GOAL.md`;
- inspect current `main` HEAD/status/log;
- inspect current live OpenClaw candidate/version only under existing safe workflow;
- inspect the current implementations of:
  - `image-generation-messages.ts`;
  - `image-caption.ts`;
  - `delivery-boundary.ts`;
  - `image-generation-lifecycle.ts`;
  - pinned OpenClaw lifecycle integration;
  - WhatsApp/Telegram attachment delivery.

Do not assume source is unchanged from the observations that motivated this Goal.

## Phase 1 — replace lifecycle semantic function contract

Replace `kind + agentId`-only semantics with a typed input that carries bounded request/session context.

Keep media authority completely out of this contract.

## Phase 2 — accepted/failure 30s semantic enrichment

Implement one ~30-second wall-clock semantic budget per accepted/failure message.

Ensure:

- request context reaches the model;
- language continuity instruction exists;
- current Kurisu persona is used;
- no fixed phrase is the expected normal path;
- accepted-message failure cannot cancel generation;
- failure message still has safe user-visible fallback.

## Phase 3 — caption 30s enrichment

Raise multimodal caption semantic budget to ~30 seconds total.

Ensure no nested timeout multiplication.

Replace canned success fallback with intentional caption absence.

## Phase 4 — telemetry

Add generated-vs-fallback status and elapsed time for accepted/failure/caption semantic calls.

## Phase 5 — tests and cleanup

Update tests that currently expect Japanese fallback or `图已经生成了。` success fallback.

Remove obsolete assumptions/documentation stating fixed fallback is normal presentation.

Do not remove historical checkpoint evidence.

## Phase 6 — docs

Update `ARCHITECTURE.md`, `PROJECT_STATE.md`, `CONTEXT.md`, and `CURRENT_TASK.md` only when implementation is actually selected/executed and source truth changes.

The presence of this planning document alone does not make it the active task.

---

# 10. Required focused tests

At minimum cover:

1. accepted semantic input receives bounded `requestContext`;
2. failed semantic input receives bounded `requestContext`;
3. accepted semantic input receives session/channel scope required by model runtime;
4. accepted Chinese user request can produce Chinese dynamic output without forced Japanese fallback;
5. Japanese request can still naturally produce Japanese output;
6. lifecycle prompt explicitly instructs current-request language continuity;
7. lifecycle prompt explicitly rejects canned/template output;
8. accepted semantic call may take >2s and still succeed;
9. accepted/failure application deadline is approximately 30s, not 2s;
10. timeout is one bounded wall-clock budget, not nested 30s + 30s;
11. accepted semantic timeout does not cancel/suppress detached image generation;
12. failure semantic timeout still produces one safe user-visible failure notice;
13. raw provider error/stack never reaches failure notice;
14. success caption sees the actual registered generated image;
15. success caption may take >8s and still succeed;
16. caption application deadline is approximately 30s;
17. caption timeout still sends exactly one image;
18. caption model error still sends exactly one image;
19. invalid caption result still sends exactly one image;
20. unsupported caption enrichment still sends exactly one image;
21. caption timeout/error/invalid/unsupported sends **no canned `图已经生成了。` caption**;
22. caption failure results in one native WhatsApp image send with caption omitted;
23. successful caption still results in one native WhatsApp image send with caption included;
24. zero independent success-caption text sends;
25. duplicate completion cannot duplicate image;
26. accepted/failure lifecycle retry cannot duplicate visible lifecycle notice;
27. late failure after success remains suppressed/audited;
28. Telegram behavior remains correct;
29. upscale remains document;
30. default 2x / explicit 4x remain correct;
31. normal text/voice/TTS remain non-regressed;
32. no `llm_input/historyMessages`, pending sender, media prose parsing or second media sender is reintroduced.

Avoid 30-second real sleeps in unit tests. Use injectable timers/fake clocks/controlled promises where appropriate.

---

# 11. Validation gates

Before committing implementation run the repository-required validation, including at least:

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

Also run focused tests for:

- image lifecycle messages;
- image caption enrichment;
- DeliveryEnvelope attachment caption;
- same-bubble WhatsApp native image send;
- Telegram caption path;
- exact pinned OpenClaw lifecycle integration if touched.

If the pinned OpenClaw integration source itself does not need changing, do not modify it gratuitously.

---

# 12. Production/apply boundary

Implementation source changes are not automatically permission to deploy.

Unless the operator explicitly authorizes apply in the execution turn:

- implement;
- validate;
- commit/push;
- update source-state docs as appropriate;
- stop before Docker/OpenClaw production apply.

If future execution is explicitly authorized for auto-apply, follow the repository's protected checkpoint, immutable image, health, registration, rollback, and owner-channel acceptance workflow.

---

# 13. Real owner acceptance after deployment

Required real-channel checks:

## Gate A — Chinese accepted message

Chinese image request:

- exactly one accepted/start notice;
- notice is Chinese/natural Kurisu output under normal conditions;
- not the old fixed Japanese sentence;
- background generation continues regardless of accepted-message semantic latency.

## Gate B — same-bubble generated caption

Successful image:

- exactly one image delivery;
- caption is a natural Kurisu description/reaction based on the actual image;
- same WhatsApp image bubble;
- not canned `图已经生成了。`.

## Gate C — caption slow path

Controlled caption latency >8s but <30s:

- natural caption still succeeds;
- image remains exactly once.

## Gate D — caption failure/timeout

Controlled caption timeout/error:

- image still arrives exactly once;
- no separate text;
- no canned success caption;
- native image message has no caption if enrichment failed.

## Gate E — generation failure

Controlled real generation failure:

- exactly one safe user-visible failure notice;
- normal path is Kurisu/persona-driven and uses the user's language;
- no raw provider/internal error.

## Gate F — regression

Verify representative:

- normal text;
- voice/TTS;
- image generation provider fallback;
- image upscale default 2x;
- explicit 4x;
- Telegram if available.

---

# Definition of Done

This corrective Goal is complete only when all of the following are true:

- accepted/failure semantic generation receives bounded original request context;
- accepted/failure semantic generation can preserve current request language;
- accepted/failure semantic operations use one ~30-second application-level timeout budget;
- success multimodal caption uses one ~30-second application-level timeout budget;
- the old 2s and 7–8s aggressive semantic deadlines are gone from the active path;
- fixed Japanese accepted/failure fallbacks are not the normal path;
- canned `图已经生成了。` success fallback is removed from active success presentation;
- caption failure intentionally yields image-without-caption, never image loss;
- failure still always has safe user-visible notification even when persona generation fails;
- existing same-bubble WhatsApp native caption behavior remains intact for valid captions;
- no independent success-caption text message is introduced;
- existing typed image transport / asset ownership / exactly-once settlement architecture is preserved;
- tests prove >2s lifecycle semantic success and >8s caption success without waiting real wall-clock durations;
- telemetry distinguishes generated output from timeout/model_error/invalid/fallback/empty states;
- required validation passes;
- retired media recovery/sender mechanisms remain absent;
- production is not claimed updated until explicitly applied and real owner gates pass.

## Core invariant

The final behavior must satisfy:

```text
Kurisu's lifecycle/caption wording may wait up to a bounded ~30 seconds and should follow the user's language naturally,
but semantic enrichment can never own, cancel, reconstruct or lose a successfully generated image.
```
