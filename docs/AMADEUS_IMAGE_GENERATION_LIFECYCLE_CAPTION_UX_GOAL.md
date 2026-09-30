# Amadeus Image Generation Lifecycle + Kurisu Caption UX — Goal

Date: 2026-10-01
Type: runtime UX / typed image-generation lifecycle / DeliveryEnvelope v2 extension
Parent architecture: `docs/AMADEUS_DELIVERY_ENVELOPE_MEDIA_CUTOVER_GOAL.md`
Prerequisite corrective Goal: `docs/AMADEUS_IMAGE_GENERATION_BACKGROUND_COMPLETION_FIX_GOAL.md`
Pinned runtime baseline: OpenClaw `2026.9.4`

## Operator decision

Restore the richer image-generation experience without regressing the newly-fixed typed background-completion transport.

The desired WhatsApp behavior is:

1. after an `image_generate` background task is accepted, Kurisu immediately sends a short task-start acknowledgement;
2. on success, the generated image and Kurisu's description/commentary appear in the **same WhatsApp image bubble** using the native image caption field;
3. on generation failure, Kurisu sends a clear user-facing failure message;
4. the successful generated image must never be lost because caption generation fails, times out, returns malformed data, or is unavailable.

Do not restore the old completion-media transport, `llm_input/historyMessages` image recovery, automatic/pending media sender, `MEDIA:` directives, visible-text parsing, or any dual delivery path.

## Current baseline that must be preserved

The current corrective implementation already moved image transport ownership to the pinned OpenClaw `2026.9.4` background completion boundary:

```text
image_generate
  -> detached background generation
  -> provider result
  -> persisted generated image
  -> authoritative attachments[]
  -> wakeMediaGenerationTaskCompletion(...)
  -> Amadeus typed completion bridge
  -> host image asset registry
  -> DeliveryEnvelope v2 attachment(disposition=inline)
  -> channel settlement
```

That architecture remains authoritative.

The current source integration is intentionally narrow and version/digest pinned. It must remain one canonical integration boundary, not grow into a collection of bundle patches.

The current ordinary image-generation path produces native generated attachments with a persisted absolute `path`, image MIME type and other metadata before the optional completion Agent. This structured attachment remains the only media authority.

## Target user experience

### Accepted

After the background task has actually been admitted/created, send one short Kurisu-style acknowledgement to the originating chat.

Example semantic intent only; wording should remain persona-driven rather than hard-coded phrase matching:

```text
画像生成を始めたわ。少し待ってなさい。
```

Requirements:

- send only after a real detached task has been accepted;
- exactly once per taskId;
- do not send for duplicate-guard rejection or pre-admission failure;
- associate it with the same requester route/session/taskId;
- it is a lifecycle notification, not a fake final Agent reply;
- failure to send the acknowledgement must not cancel the generation job.

### Success

For WhatsApp, the final successful delivery must be one native image message:

```text
+-----------------------------+
|       generated image       |
|                             |
| Kurisu description/caption  |
+-----------------------------+
```

The description must be the image's WhatsApp caption, not a separate text message.

The preferred description is generated from the **actual persisted generated image**, not merely by rewriting the original prompt. Kurisu may use the original user request as context, but should describe/react to what was actually produced.

The image transport is authoritative before caption generation. Caption generation is optional enrichment.

### Failure

If image generation itself fails before a generated attachment exists, send one clear Kurisu-style user-facing failure message to the originating chat.

Requirements:

- exactly once per taskId;
- bounded/safe text only;
- no raw exception, provider credential, URL, stack, model protocol, task/session internals or serialized tool output;
- provider/model failure may be summarized semantically, but no secret/internal details;
- no fake image attachment and no success caption path.

## Architectural invariant: media success cannot depend on caption success

This is mandatory.

The final success path may wait for a bounded caption attempt so image + caption can share one WhatsApp bubble, but delivery eligibility must already be determined by the authoritative generated attachment.

```text
authoritative generated attachment
      |
      +--> register asset
      |
      +--> bounded caption enrichment attempt
                |
                +--> valid caption -> image + caption
                |
                +--> timeout/error/invalid -> image + safe fallback caption
```

Forbidden:

```text
caption LLM fails
  -> cancel image
```

Forbidden:

```text
caption LLM returns malformed output
  -> send raw model response
```

Forbidden:

```text
caption Agent owns/reconstructs the image path
```

Caption generation must receive a trusted resolved asset or a host-prepared multimodal image input. The model must never author the delivery asset identity/path.

## DeliveryEnvelope v2 extension

Extend the typed attachment presentation contract rather than introducing a separate caption protocol.

Preferred semantic shape:

```ts
export type AttachmentPart = Readonly<{
  kind: 'attachment';
  assetId: string;
  mimeType: string;
  fileName: string;
  disposition: 'inline' | 'document';
  byteSize?: number;
  sha256?: string;
  caption?: string;
}>;
```

Codex may adapt exact type names to repository conventions, but these semantics are mandatory.

### Caption invariants

- optional string;
- user-visible presentation data only;
- bounded length appropriate to channel/provider limits;
- normalized as plain visible text;
- never interpreted as control data;
- never parsed for media paths, modality, disposition, reply directives or tool commands;
- no raw structured model JSON;
- image caption applies only when the channel/provider supports native inline media captions;
- `disposition=document` must remain document/file delivery; caption support must not cause document -> image downgrade.

## WhatsApp native mapping

Extend the existing typed WhatsApp image primitive from conceptually:

```ts
sendImage(asset)
```

to:

```ts
sendImage(asset, caption?)
```

or an equivalent typed object.

The final native WhatsApp call must map inline image caption directly:

```ts
transport.sendMedia({
  image: asset.bytes,
  mimetype: asset.mimeType,
  caption,
}, quoteOptions)
```

The success experience must be **one provider image send**, not:

```text
sendText(caption)
sendImage(image)
```

and not:

```text
sendImage(image)
sendText(caption)
```

For multi-image generation, define deterministic behavior before implementation. Preferred rule:

- each generated image is one image bubble with its own caption when each image is independently described;
- if only one shared description is available, attach it to the first image and send remaining images without duplicated prose;
- never duplicate the same caption mechanically across every image unless explicitly intended by the semantic caption result.

## Caption generation ownership

Use OpenClaw/Kurisu as the semantic author, but do not turn the caption run into a second delivery owner.

Preferred responsibilities:

```text
ImageLifecycleCoordinator
  -> authoritative attachment / assetId
  -> CaptionEnricher
       -> actual image input
       -> original request/context (bounded)
       -> Kurisu persona/system context
       -> typed CaptionResult
  -> DeliveryEnvelope attachment.caption
  -> single settlement
```

Caption result should be a tiny structured contract owned by the capability, for example:

```ts
type ImageCaptionResult = Readonly<{
  caption: string;
}>;
```

It is not a DeliveryEnvelope, does not select channel primitives and cannot emit attachments.

The implementation must first inspect the pinned OpenClaw/plugin APIs for a canonical way to perform a bounded multimodal semantic call under the current Kurisu Agent/persona. Prefer a repo-owned/plugin SDK call over a new source patch.

If no stable plugin API exists, do **not** add a second broad compiled-bundle patch merely for caption generation. Use an existing repo-owned model/provider boundary or another narrow documented mechanism consistent with the single-Agent architecture. Keep 9Router/model fallback behavior under existing model configuration rather than hard-coding provider-specific routing.

## Caption fallback

A generated image must still be delivered if caption enrichment fails.

Fallback must be deterministic and user-friendly, not raw provider text.

Acceptable fallback hierarchy:

1. valid Kurisu multimodal caption;
2. short safe persona-neutral/Kurisu-style fallback text generated locally/deterministically from lifecycle state, e.g. a concise "画像ができたわ。" equivalent;
3. if even fallback text cannot be constructed, send the image without caption only as the final last resort.

Do not call a second model merely to generate the fallback.

Record a bounded `caption_fallback_reason` such as:

```text
timeout
model_error
invalid_result
unsupported
```

No raw model output in logs.

## Start acknowledgement lifecycle

OpenClaw already distinguishes async admission from completion. Use that lifecycle instead of parsing the immediate started text.

The preferred signal is the existing detached-media async-start callback / accepted task boundary (`onAsyncTaskStarted` or the closest authoritative typed lifecycle event in pinned `2026.9.4`).

Implementation priority:

1. existing stable plugin/runtime lifecycle callback if it can carry taskId + requester origin;
2. extend the existing single version-pinned image lifecycle integration boundary if the callback is not available to Amadeus;
3. do not parse `Background task started ...` visible/tool text.

If extending the pinned integration is required, keep it one lifecycle integration module and AST/version/digest anchored. Prefer renaming/refactoring `core-completion.mjs` into a semantically accurate single image lifecycle integration if it now owns accepted + success + failure events; do not leave parallel overlapping integration files.

Start acknowledgement sending must use a typed lifecycle notifier, not the final DeliveryEnvelope settlement ledger for the generated image. Give it its own stable idempotency key derived from taskId, for example:

```text
image-start:<taskId>
```

It must not create or bind an image asset.

## Failure lifecycle

The same authoritative background lifecycle already receives failure before a successful attachment exists. Add a typed failure handoff.

Conceptual contract:

```ts
type ImageGenerationFailure = Readonly<{
  taskId: string;
  sessionKey: string;
  channel: 'whatsapp' | 'telegram';
  accountId?: string;
  conversationId?: string;
  failureClass?: string;
}>;
```

The source integration may derive a bounded normalized failure class from runtime state, but must not forward raw exception/stack/provider payload into user-facing content.

The plugin/lifecycle coordinator decides the user-safe Kurisu failure message and sends it through a typed channel notification path exactly once.

Failure delivery must not run a caption model.

If the failure notification itself cannot be sent, log the bounded failure stage; do not loop indefinitely.

## Single image lifecycle coordinator

Prefer one explicit repo-owned coordinator for accepted/succeeded/failed state.

Conceptual API:

```ts
interface ImageGenerationLifecycleBoundary {
  accepted(input: ImageGenerationAccepted): Promise<void>;
  succeeded(input: ImageGenerationSucceeded): Promise<void>;
  failed(input: ImageGenerationFailed): Promise<void>;
}
```

State machine:

```text
accepted
  -> succeeded
  -> failed
```

with terminal states mutually exclusive.

Required task state invariants:

- accepted notification at most once;
- exactly one terminal state per taskId;
- success settlement at most once;
- failure notification at most once;
- retry of the same success completion reuses the same image deliveryId and cannot duplicate media;
- retry of failure cannot duplicate the user failure message;
- a late duplicate failure after successful settlement is ignored/audited, never shown;
- a late duplicate success after terminal failure must fail closed/audit according to actual OpenClaw retry semantics, never double-notify.

Do not use an unbounded in-memory map as the sole correctness mechanism if OpenClaw may retry across relevant process/session boundaries. Reuse the existing delivery settlement/idempotency state where appropriate, and document what restart durability exists. If full durable lifecycle idempotency is unavailable in the pinned host, preserve existing exactly-once media ledger semantics and bound best-effort start/failure notifications explicitly in docs/tests.

## Route ownership

Every lifecycle notification must route to the original requester using trusted runtime origin fields captured at task creation.

Never infer the chat from caption content, tool text, recent global activity or model output.

WhatsApp and Telegram remain channel adapters; no WhatsApp-only fields belong in generic lifecycle contracts beyond channel routing metadata.

## Telegram

Maintain platform neutrality.

For Telegram:

- accepted and failure notifications should map to normal typed text sends;
- success should use Telegram native image caption when the existing adapter supports it;
- if the current Telegram adapter cannot support caption in the same media send, add the equivalent typed caption support rather than creating an Amadeus-only text/media bypass;
- focused non-regression is sufficient; do not expand scope into unrelated Telegram UX.

## Persona and language

The caption/failure/start semantics should preserve the existing Kurisu persona rather than hard-code one exact sentence in source.

Do not implement keyword templates such as:

```text
if generation_started -> fixed sentence A
if generation_failed -> fixed sentence B
```

A short deterministic fallback is allowed only for failure of the semantic/persona generation boundary and must remain isolated as fallback presentation, not routing/business logic.

For the success caption, favor concise natural commentary appropriate for an image caption. Do not produce long essays that obscure the image.

## Telemetry

Add bounded lifecycle observability without raw prompts/media/model output.

Recommended fields:

```text
task_id
session_key_hash or bounded safe session identifier
channel
lifecycle_stage = accepted|captioning|succeeded|failed
asset_id
attachment_count
caption_status = generated|fallback|empty
caption_fallback_reason
provider_primitive = text|image|document
final_status
failure_stage
```

Do not log:

- raw generated image bytes/base64;
- raw caption model response;
- full user prompt unless already governed by existing safe logging policy;
- secrets/tokens;
- arbitrary absolute paths in general user-facing logs;
- full provider failure payloads.

## Required implementation phases

### Phase 0 — re-read current truth

Before changes:

- read `AGENTS.md`;
- read `docs/CONTEXT.md`;
- read `docs/CURRENT_TASK.md`;
- read this Goal;
- read parent DeliveryEnvelope Goal;
- inspect `docs/ARCHITECTURE.md` and `docs/PROJECT_STATE.md`;
- inspect current Git HEAD/status/log;
- inspect the live candidate/runtime only as allowed by AGENTS workflow;
- verify the current `core-completion`/image lifecycle integration, DeliveryEnvelope types, settlement ledger, WhatsApp plan, Telegram adapter and image asset registry.

Do not assume the exact source layout from this document if current main has evolved.

### Phase 1 — formalize lifecycle contracts

Add/adjust repo-owned typed contracts for:

- accepted;
- succeeded;
- failed;
- caption enrichment result;
- attachment caption presentation.

No raw text parsing or model-authored asset identity.

### Phase 2 — accepted notification

Wire the authoritative async-task-accepted event to the lifecycle coordinator.

Verify exactly-once/bounded behavior and original route ownership.

### Phase 3 — typed failure notification

Wire authoritative generation failure to the lifecycle coordinator before any completion Agent prose path.

Return a user-safe Kurisu failure message.

### Phase 4 — caption enrichment

After success attachment is trusted/imported, perform a bounded semantic caption attempt against the actual image asset.

Requirements:

- actual generated image available to caption model;
- same Kurisu persona/context semantics as normal Agent behavior where feasible;
- concise result;
- strict timeout/bounds;
- invalid/malformed/raw protocol fails to fallback;
- no delivery authority.

### Phase 5 — same-bubble channel delivery

Extend `AttachmentPart.caption` through:

```text
DeliveryEnvelope
 -> delivery settlement
 -> WhatsApp attachment sender
 -> WhatsApp delivery port
 -> transport.sendMedia({ image, mimetype, caption })
```

Telegram should use equivalent native media caption semantics where supported.

Do not send successful caption as an independent text part when it belongs to an image attachment.

### Phase 6 — retry/idempotency/failure isolation

Verify accepted/success/failure retries cannot produce duplicate user-visible lifecycle messages or duplicate image settlement under expected runtime retry behavior.

Caption timeout/error must prove image still sends.

### Phase 7 — cleanup and docs

Remove any superseded success-caption/completion-Agent assumptions introduced by earlier candidates.

Do not remove historical checkpoint evidence.

Update active architecture/project/current-task docs so the current behavior is described accurately.

## Required focused tests

At minimum:

1. detached task accepted -> exactly one start acknowledgement;
2. duplicate/replayed accepted lifecycle -> no duplicate acknowledgement;
3. pre-admission rejection -> no false start acknowledgement;
4. successful generated PNG -> image + caption in one WhatsApp provider send;
5. successful generated JPEG -> image + caption in one WhatsApp provider send;
6. provider fallback success -> same success behavior;
7. caption sees actual generated image input, not only original prompt;
8. caption success -> one native image send, zero independent caption text sends;
9. caption timeout -> image still sends once with deterministic fallback caption;
10. caption model error -> image still sends once;
11. malformed caption result -> raw output never reaches user, image still sends;
12. generated attachment import failure -> fail closed; do not claim image success;
13. generation failure before attachment -> exactly one user-safe failure message;
14. failure retry -> no duplicate failure message;
15. raw provider exception/stack is not exposed;
16. success completion retry -> exactly one image settlement/import/bind according to existing idempotency contract;
17. success terminal state cannot later emit failure notification;
18. existing normal image generation remains `disposition=inline`;
19. existing upscale remains `disposition=document` and is not downgraded by caption support;
20. 2x/4x upscale behavior non-regression;
21. intentional ordinary JSON/text reply non-regression;
22. voice reply/TTS non-regression;
23. Telegram caption/start/failure focused non-regression;
24. pinned OpenClaw source integration rejects version/digest/anchor mismatch.

Tests must exercise the real pinned lifecycle integration shape where applicable, not invent a synthetic `llm_input` image fixture.

## Repository-wide regression searches

Search active code for retired mechanisms and ensure this Goal does not reintroduce them:

```text
enqueueGeneratedImageBytes
completionSettlements
llm_input
historyMessages
pendingToolForceDocument
toolForceDocument
forceDocument
MEDIA:
stripPendingToolMediaStructuredTail
visibleTextWithoutStructuredTail
```

Some legitimate `llm_input/historyMessages` may exist elsewhere in OpenClaw-facing functionality; any remaining Amadeus image-generation hit must be explained and must not be used for image transport/caption asset recovery.

Also search for independent successful-image caption text sends to ensure WhatsApp success uses native media caption rather than two messages.

## Validation workflow

Follow `AGENTS.md`.

At minimum before source completion:

```text
pnpm workflow:plan
pnpm test:delivery
pnpm test:amadeus
pnpm typecheck:amadeus
pnpm build:amadeus
git diff --check
pnpm check:secrets
```

Run additional focused tests required by affected packages/integration source.

If the pinned OpenClaw integration module changes, execute the exact version/digest/AST contract test against the pinned host source.

Do not call the Goal complete based only on unit tests.

## Deployment rule

Source implementation, tests and commit come first.

Do not perform a new production/CasaOS/OpenClaw apply merely because this Goal is implemented unless the operator has explicitly authorized apply in the current execution context.

When deployment is explicitly authorized, follow the repository protected checkpoint / immutable image / health / registration workflow. Preserve rollback to the current known-good candidate.

## Real owner acceptance gates after authorized deploy

### Gate A — accepted acknowledgement

From real WhatsApp owner DM:

- request ordinary image generation;
- receive exactly one short Kurisu task-start acknowledgement after actual task acceptance;
- no duplicate acknowledgement.

### Gate B — same-bubble success

On successful generation:

- receive exactly one generated image per expected output;
- Kurisu description appears as the native WhatsApp image caption in the same bubble;
- no duplicate separate success-description text message;
- description matches/reacts to actual image content reasonably;
- asset registry and delivery correlation remain intact.

### Gate C — caption failure isolation

Induce or simulate the approved bounded caption failure mode without breaking image generation:

- generated image still arrives exactly once;
- fallback caption is safe/short, or image arrives without caption only as last resort;
- raw model/protocol output never appears.

### Gate D — generation failure UX

Use a controlled safe failure path:

- exactly one Kurisu failure message arrives;
- no image bubble;
- no raw provider/internal details;
- no silent failure.

### Gate E — fallback provider success

Exercise the real configured image provider fallback path where practical:

- accepted message arrives;
- fallback-generated image arrives;
- caption is in same image bubble;
- no completion LLM dependency or duplicate media.

### Gate F — regression

Verify representative:

- normal text reply;
- voice reply/TTS;
- ordinary inline image generation;
- on-demand upscale document delivery;
- explicit 4x and default 2x behavior;
- restart/recreate does not break image lifecycle bridge registration.

## Definition of Done

This Goal is complete only when all source-level items below are true, and real gates are recorded after an authorized deploy:

- current typed background-completion image transport remains authoritative;
- accepted/start lifecycle exists and is exactly-once/bounded;
- failure lifecycle exists and is user-visible instead of silent;
- success caption is generated from the actual image when semantic captioning succeeds;
- `AttachmentPart` (or equivalent) carries typed optional caption presentation;
- WhatsApp maps inline image + caption to one native media send / one bubble;
- successful caption is not sent as a separate text message;
- caption timeout/error/malformed output cannot cancel a successfully generated image;
- deterministic safe caption fallback exists;
- raw caption/provider protocol cannot reach user-visible output;
- image transport does not depend on completion LLM output;
- no `llm_input/historyMessages` image recovery returns;
- no retired pending/automatic media sender returns;
- success retry does not duplicate image delivery;
- failure retry does not duplicate failure notification;
- upscale `document` semantics remain unchanged;
- Telegram remains compatible through the same typed presentation contract;
- focused tests/typecheck/build/diff/secrets validation pass;
- docs describe the new lifecycle accurately;
- source implementation is committed;
- after explicit deploy authorization, real owner Gates A–F are recorded with evidence.
