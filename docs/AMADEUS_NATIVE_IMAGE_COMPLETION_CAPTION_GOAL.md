# Amadeus Native Image Completion Caption — Goal

Date: 2026-10-02
Type: corrective runtime architecture / ordinary image generation completion UX
Baseline: Amadeus 1.8.2, OpenClaw 2026.9.4
Scope: ordinary `image_generate` success completion only

## Goal

Complete the 1.8.2 native image-completion repair so a successful ordinary `image_generate` produces exactly one user-facing image message whose native image caption is the Completion Agent's natural Kurisu-style reply, while preserving authoritative generated-asset ownership and native task completion semantics.

The final WhatsApp UX should be one bubble:

```text
[generated image]
Kurisu natural completion caption
```

Do not send a second text bubble for the successful image completion.

## Current confirmed state

Amadeus 1.8.2 fixed the earlier premature completion short-circuit:

```text
completeImageGeneration(...)
-> clear params.attachments / params.mediaUrls
-> fall through to native task_completion
-> Completion Agent continuation
```

This repairs native task/session completion state and prevents a second native media send.

However, the current implementation is still incomplete:

1. `params.attachments` and `params.mediaUrls` are cleared before OpenClaw builds the native `task_completion` event, so the Completion Agent no longer receives the generated image as model-visible completion media.
2. OpenClaw completion provenance is `inter_session` with `sourceTool=image_generate`.
3. Current Amadeus `originFor()` classifies every `inter_session` turn as `internal_handoff`.
4. `delivery-decoder.ts` intentionally makes `internal_handoff` silent.
5. Therefore native completion can update session/task semantics but its natural user-facing completion reply is not an authoritative visible image caption.
6. Current generated-image delivery is already settled before native completion, so a later Completion Agent reply cannot be merged into the same image bubble.

The release must not claim completion UX is restored until a real ordinary image-generation path proves one native image bubble with the Completion Agent caption.

## Architecture decision

Use a two-phase successful image-completion settlement:

```text
OpenClaw image_generate background job succeeds
        |
        v
authoritative generated attachment
        |
        v
Amadeus claims/imports generated image
        |
        v
Asset Registry
        |
        +---- image bytes and identity are now safe
        |
        v
native task_completion continues
        |
        v
Completion Agent
  - knows task succeeded
  - receives bounded read-only image context
  - cannot choose image path / assetId / delivery target
        |
        v
natural completion text
        |
        v
Amadeus binds that text as AttachmentPart.caption
        |
        v
DeliveryEnvelope
        |
        v
WhatsApp sendImage(asset, caption)
        |
        v
exactly one image message
```

The Completion Agent owns presentation text only. Runtime-owned code continues to own image identity, routing, asset registration, delivery ID and channel send.

## Required invariants

### 1. Image transport stays runtime-owned

The generated image must continue to originate from the trusted OpenClaw generated attachment contract and be imported into the existing Asset Registry before model-authored output can affect delivery.

The model must never provide or select:

- filesystem path
- `assetId`
- delivery target
- WhatsApp recipient
- attachment disposition
- generated-media URL authority
- provider/model route

### 2. One successful image => one image send

For a successful ordinary generation:

```text
sendImage count = 1
sendText count = 0 for the successful completion itself
```

The Completion Agent caption must become the existing inline attachment's `caption`, not a separate text part.

### 3. Native completion semantics must remain live

Do not reintroduce:

```ts
return { status: "delivered" }
```

immediately after Amadeus claims the generated image.

The native `task_completion` / requester continuation must still execute so the original session knows the task reached terminal success.

### 4. Completion may not lose the image

The image must already be safely imported before the Completion Agent is awaited.

If completion generation:

- times out,
- throws,
- returns malformed protocol,
- produces no usable caption,
- fails language validation,
- is unavailable,

the image must still be delivered exactly once with a bounded fallback caption or no caption.

A Completion Agent failure must never turn successful image generation into no delivery.

### 5. Do not restore native duplicate media delivery

The native continuation may receive read-only image context for reasoning, but native channel media primitives must not become a second sender.

Do not simply restore the original `attachments` / `mediaUrls` into a path that can resend media.

The implementation must separate:

```text
model-visible completion image context
!=
channel-owned media delivery authority
```

## Completion-turn classification

Add a narrow classification for trusted image-generation completion only.

Equivalent rule:

```text
inputProvenance.kind === "inter_session"
AND inputProvenance.sourceTool === "image_generate"
AND sourceSessionKey matches the native image_generate task identity
AND completion correlates to an Amadeus-owned pending generated asset
=> origin = media_completion
```

Do not make all `inter_session` turns visible.

All unrelated:

- subagent handoffs
- sessions_send
- cron
- heartbeat
- internal system messages

must retain current silence policy.

## Completion Agent output contract

For this specific trusted `media_completion` turn, the model should generate only the natural user-facing caption text semantics.

It must not author attachment metadata.

The implementation may use the existing DeliveryEnvelope decoder or a narrower completion-only decoder, but the final authoritative result must be equivalent to:

```ts
AttachmentPart {
  kind: "attachment",
  assetId: runtimeOwnedAssetId,
  mimeType: runtimeOwnedMime,
  fileName: runtimeOwnedFileName,
  disposition: "inline",
  caption: completionAgentText
}
```

Do not send the Completion Agent text as an independent WhatsApp text message for successful image completion.

## Read-only generated image context

The Completion Agent should be able to reason about the actual generated image, not only the original prompt.

Prefer an existing OpenClaw-supported structured model-input path for image context.

Requirements:

- model can inspect the generated image;
- no arbitrary path/URL authority is accepted from model text;
- image context is derived only from the already verified generated asset;
- the context is used for model understanding only;
- it cannot trigger native duplicate media delivery;
- no base64/image bytes are logged;
- no generated image is copied into Git.

Do not resurrect the retired `llm_input/historyMessages` extractor as media-delivery authority.

## Caption timing and fallback

The image asset must be imported first.

Then wait for the Completion Agent only within a bounded deadline.

Target behavior:

```text
asset import success
    |
    +-- Completion Agent succeeds
    |       -> one sendImage(asset, naturalCaption)
    |
    +-- Completion Agent fails/times out
            -> one sendImage(asset, fallbackCaption or no caption)
```

The bounded Completion Agent timeout should be chosen from current runtime behavior and tests rather than guessed into unrelated global timeouts.

Do not change the main Agent timeout, TTS timeout, ASR timeout or image-generation timeout for this Goal.

## Existing caption enricher

Do not delete or broadly redesign `image-caption.ts` in this Goal.

It may remain as a bounded fallback if that is the smallest safe implementation.

Preferred priority:

```text
1. native Completion Agent natural caption
2. existing caption enricher fallback, if safe and already available
3. attachment-only image
```

Do not keep the current caption enricher as the normal successful primary path once native completion succeeds.

## Failure path

The current failed-image lifecycle path is outside the main behavior change.

Do not broaden this Goal into failure-message redesign.

Only make failure-side changes if strictly required by shared state safety or to keep tests correct.

## Explicit non-goals

Do not modify:

- ordinary text -> text reply architecture
- DeliveryEnvelope v2 global protocol
- voice reply semantics
- TTS
- ASR
- inbound voice lease handling
- `amadeus_image_upscale`
- upscale 2x/4x behavior
- upscale `document` disposition
- reference-image routing
- `openai/amadeus-image` route authority
- 9Router Combo selection
- image generation provider fallback policy
- generic WhatsApp sender behavior
- generic Telegram sender behavior
- PUBG or other tool presentation
- SOUL/persona architecture
- global `inter_session` visibility policy

Do not perform a broad delivery-system refactor.

## Required implementation work

Codex must inspect the current 1.8.2 tree and choose exact names based on existing ownership, but the responsibilities must be equivalent to:

### A. Split claim/import from final send

Current `completeImageGeneration()` settles the image immediately.

Refactor only the successful ordinary image path so:

1. authoritative attachment is imported and registered;
2. pending completion state stores only runtime-owned typed asset facts keyed by trusted task identity;
3. native completion continues;
4. final image settlement waits for the bounded completion caption result;
5. one stable delivery ID is retained for idempotency.

Do not let an unbounded in-memory map grow indefinitely; keep existing bounded/TTL conventions.

### B. Restore trusted media-completion classification

Update the current completion-origin decision narrowly so native `image_generate` completion is distinguishable from generic `internal_handoff`.

The correlation must be based on trusted runtime identity, not text matching.

### C. Give the Completion Agent safe image visibility

Use the verified generated asset to provide model-visible image input without restoring native media-send ownership.

Do not parse model-produced paths or `MEDIA:` text.

### D. Convert completion text into inline caption

When the trusted media-completion Agent reply is valid:

- extract only the natural text;
- normalize through existing caption safety rules;
- bind it to the pending inline image attachment;
- settle one DeliveryEnvelope containing the attachment;
- do not emit a separate text primitive.

### E. Bounded fallback

If completion captioning fails after asset import:

- settle the same pending image once;
- optionally use existing caption enricher as fallback;
- otherwise send image without caption;
- record a safe bounded fallback reason.

## Tests

Add focused tests that prove the production semantics.

### Test 1 — successful native completion is visible as caption

Simulate:

```text
image_generate async start
-> generated attachment
-> asset import
-> native task_completion
-> Completion Agent natural text
```

Assert:

- one asset import;
- one native completion continuation;
- one `sendImage`;
- zero completion `sendText`;
- `sendImage` caption equals Completion Agent text;
- task completion remains terminal.

### Test 2 — Completion Agent receives real image context

Assert that the completion model-input contains a trusted image input derived from the registered/generated asset.

Also assert that the output model cannot replace the runtime asset/path.

### Test 3 — completion timeout still sends image

Force Completion Agent timeout.

Assert:

- one image delivery still occurs;
- no duplicate image;
- no stuck task;
- fallback reason is recorded safely.

### Test 4 — malformed completion still sends image

Return malformed DeliveryEnvelope / malformed model protocol.

Assert successful generated image is still delivered once.

### Test 5 — next user turn knows generation finished

After successful completion, run a follow-up user turn equivalent to:

```text
“刚才那张怎么样？”
```

Assert the prior task is terminal/completed in the requester session and no pending/running image task is presented as current.

Do not make this test depend on exact prose.

### Test 6 — no duplicate media primitives

Assert the native completion path cannot issue a second image/document/media send after Amadeus owns the asset.

### Test 7 — ordinary text regression

A normal typed user turn remains:

```text
external_user -> text DeliveryEnvelope -> sendText
```

with no behavior change.

### Test 8 — voice regression

Verified inbound voice retains current voice + visible text ordering and TTS fallback behavior.

### Test 9 — upscale regression

`amadeus_image_upscale`:

- does not enter this media-completion path;
- still resolves latest/replied image correctly;
- still sends `disposition=document`;
- preserves 2x/4x behavior.

### Test 10 — reference-image regression

Ordinary image generation with one valid reference still uses the current `openai/amadeus-image` route and does not regress the reference payload path.

## Runtime diagnostics

Add safe structured diagnostics sufficient to prove:

```text
image_completion_asset_claimed
image_completion_native_continuation_started
image_completion_caption_ready
image_completion_caption_fallback
image_completion_delivery_settled
image_completion_duplicate_ignored
```

Safe fields may include:

- task id
- run id
- delivery id
- channel
- caption source: `native_completion | fallback_enricher | none`
- elapsed time
- fallback reason

Never log:

- prompt body
- model-authored full reply
- image bytes/base64
- filesystem path unless already existing bounded safe path policy explicitly permits it
- API keys
- signed URLs

## Validation

Before production apply:

1. `pnpm test:amadeus`
2. `pnpm typecheck:amadeus`
3. `pnpm build:amadeus`
4. `pnpm test:openclaw-image-route-authority`
5. `node scripts/test-delivery-boundary.mjs`
6. focused completion-caption tests
7. `git diff --check`
8. `pnpm check:secrets`
9. pinned OpenClaw 2026.9.4 integration preflight

Do not alter unrelated service images or restart TTS, 9Router, Product Radar or other HomeLab services unless independently required.

## Real acceptance

Automated tests are not sufficient for final UX acceptance.

Run one real ordinary WhatsApp image generation and verify:

1. generation acceptance/progress behavior remains normal;
2. exactly one final image message is received;
3. the natural Kurisu completion reply appears inside that image's caption in the same bubble;
4. no duplicate text completion message appears;
5. a follow-up user message recognizes the previous generation as completed;
6. voice remains healthy;
7. upscale remains healthy.

Do not claim the UX is complete without this real owner-channel acceptance.

## Done definition

This Goal is complete only when:

- ordinary successful `image_generate` preserves native `task_completion`;
- Completion Agent can reason about the actual generated image;
- Completion Agent natural text is the caption of the single final inline image;
- successful completion sends no separate text bubble;
- Completion Agent failure cannot lose the image;
- next user turn sees the image task as completed;
- ordinary text, voice/TTS/ASR, upscale and reference-image paths remain unchanged;
- no model-authored path/asset identity becomes delivery authority;
- all focused tests and real WhatsApp acceptance pass.

## Codex execution command

```text
/goal Execute docs/AMADEUS_NATIVE_IMAGE_COMPLETION_CAPTION_GOAL.md end-to-end. Treat it as the authoritative Goal. Complete only the ordinary image_generate success completion UX: preserve authoritative asset import and native task_completion, let the Completion Agent safely inspect the actual generated image, merge its natural reply into the same final WhatsApp image bubble as AttachmentPart.caption, keep exactly one image send, and guarantee bounded fallback delivery if completion captioning fails. Do not modify ordinary text, voice/TTS/ASR, amadeus_image_upscale, reference-image routing, 9Router image route authority, or unrelated DeliveryEnvelope behavior.
```
