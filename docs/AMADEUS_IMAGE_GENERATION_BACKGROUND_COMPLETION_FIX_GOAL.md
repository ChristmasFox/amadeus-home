# Amadeus Image Generation Background Completion Fix — Goal

Date: 2026-09-30
Type: corrective runtime architecture / async image completion / DeliveryEnvelope v2 integration
Parent architecture: `docs/AMADEUS_DELIVERY_ENVELOPE_MEDIA_CUTOVER_GOAL.md`
Pinned runtime baseline: OpenClaw `2026.9.4`

## Operator decision

Repair ordinary image generation without rolling back DeliveryEnvelope v2 and without restoring any retired automatic/pending media sender.

This is a targeted architecture correction. The current failure is not provider generation failure and not a WhatsApp image-sender failure. Real owner evidence shows that `image_generate` starts successfully, the configured provider fallback can generate the image successfully, but Amadeus does not claim the authoritative generated attachment at the correct OpenClaw runtime boundary. The later completion turn can therefore become text-only, and the current Amadeus suppression path cancels the final payload without any typed image settlement.

Do not fix this by adding another text parser, another `MEDIA:` parser, another `llm_input` shape guess, another base64 convention, or by re-enabling the old pending tool-media sender.

## Confirmed root cause

Pinned OpenClaw `2026.9.4` runs `image_generate` as detached/background media generation.

The immediate tool result is only a started receipt and normally contains no final generated file:

```text
image_generate
  -> Background task started ...
  -> details.async = true
  -> no final paths/attachments yet
```

The actual successful generated media exists later in OpenClaw's background completion path. In the pinned source, the completion path has authoritative structured values before the completion Agent/LLM round:

```text
executed.attachments
executed.mediaUrls
executed.wakeResult
        |
        v
lifecycle.wakeTaskCompletion(...)
```

OpenClaw then constructs a `task_completion` internal event carrying `attachments` and `mediaUrls` and invokes its continuation/delivery machinery.

The current Amadeus candidate instead tries to recover successful media in `llm_input` by looking for a synthetic shape equivalent to:

```json
{
  "role": "user",
  "content": [
    { "type": "image", "mimeType": "image/png", "data": "<base64>" }
  ]
}
```

Real owner traffic did not preserve that shape. The completion turn was text-only with a generated-media reference. Therefore the current code reaches `if (!images.length) return`, creates no registry asset and no DeliveryEnvelope attachment. Later `reply_payload_sending` still suppresses the `media_completion` final reply, so no sender owns the image and nothing reaches the owner.

The bug is therefore: **typed ownership begins too late**.

## Goal

Move Amadeus image-generation ownership to the earliest stable, host-owned structured background-completion boundary where OpenClaw still has the authoritative generated attachments.

After this Goal:

1. successful detached `image_generate` delivery does not depend on a second/completion LLM producing image content;
2. successful generated attachments are imported into the existing host image asset registry exactly once;
3. each imported generated image becomes a DeliveryEnvelope v2 attachment with `disposition: inline`;
4. WhatsApp ordinary image generation uses the existing typed `sendImage` path exactly once;
5. Telegram uses the same DeliveryEnvelope attachment contract through its adapter;
6. the later completion Agent may provide caption semantics only if architecture permits, but it is not the authority for image transport;
7. completion LLM timeout, malformed model output or text-only completion cannot discard a successfully generated image;
8. no legacy OpenClaw pending-media sender is restored;
9. no model-authored path, visible text, generated-media display line, or `MEDIA:` directive is parsed to recover the image;
10. subsequent `amadeus_image_upscale` can deterministically resolve the newly delivered original asset.

## Non-goals

This Goal does not:

- redesign DeliveryEnvelope v2;
- restore ReplyEnvelope;
- restore `forceDocument`;
- restore JSON cleanup regex;
- change the existing upscale document semantics;
- change 4x-default upscale policy;
- change the host image asset root;
- replace native OpenClaw `image_generate`;
- create a second image-generation tool;
- add a second Agent/runtime;
- parse arbitrary local paths from model output;
- expose arbitrary filesystem paths to the model;
- perform a production deploy unless the operator explicitly authorizes an apply after the source candidate is committed and verified.

## Architecture invariants

### 1. DeliveryEnvelope v2 remains authoritative

The repaired path must end in the same typed contract already used by normal replies and upscale:

```text
Generated attachment
  -> image asset registry
  -> AttachmentPart
       assetId
       mimeType
       fileName
       byteSize
       sha256
       disposition = inline
  -> DeliveryEnvelope v2
  -> single settlement ledger
  -> channel adapter
```

Do not add an image-specific sender outside the v2 ledger.

### 2. Provider result, not completion prose, owns generated media

The image identity must originate from the trusted OpenClaw media-generation runtime result.

Allowed authorities are structured OpenClaw runtime fields such as its generated attachment contract (`AgentGeneratedAttachment`) and the exact background task completion facts that carry those attachments.

Forbidden authorities:

- completion LLM prose;
- `historyMessages` text;
- prompt-formatted `Attachments:` lines;
- `MEDIA:` text;
- filenames copied by the model;
- regex extraction from generated-media references;
- user-visible caption text.

### 3. One narrow pinned OpenClaw integration boundary is allowed

OpenClaw `2026.9.4` does not currently expose a plugin hook dedicated to completed detached generated media before the completion LLM. If repository/runtime inspection confirms no suitable supported typed hook exists, implement exactly one narrow, version-pinned source integration/overlay that emits the authoritative completion fact to Amadeus.

The bridge must:

- bind to the pinned OpenClaw `2026.9.4` implementation with explicit anchors/version checks;
- carry typed facts only;
- expose no model-authored text as file authority;
- contain no JSON cleanup regex;
- contain no `forceDocument` propagation;
- contain no generic compiled-bundle search/replace across multiple unrelated bundles;
- fail the image build/preflight if the pinned integration anchor changes;
- have focused tests against the exact pinned completion shape.

Prefer an official plugin/source hook if current inspection finds one that exposes the required `attachments` before LLM serialization. Do not patch merely because this document allows a bridge.

### 4. Preserve OpenClaw generated attachment contract

Do not invent another media shape if the pinned OpenClaw source already provides the necessary fields.

Use/normalize the existing structured semantics equivalent to:

```ts
type AgentGeneratedAttachment = {
  type?: 'image' | 'audio' | 'video' | 'file';
  path?: string;
  url?: string;
  mediaUrl?: string;
  filePath?: string;
  mimeType?: string;
  name?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
};
```

For Amadeus ordinary generated-image import, only image attachments that pass bounded trusted-runtime validation are eligible.

### 5. Local-path safety remains strict

When the trusted generated attachment provides a local path/filePath:

- it must be absolute only because it came from trusted runtime metadata, never because model text supplied it;
- canonicalize it;
- require a regular file;
- reject symlinks;
- enforce current generated-media/root allowlisting or an equally narrow trusted runtime boundary;
- enforce size limits;
- determine/verify MIME consistently;
- copy/import bytes into the authoritative host image asset service before channel settlement;
- after import, business logic uses `assetId`, not that original path.

When the trusted generated attachment is represented by another supported runtime-owned media reference, resolve it through the narrow OpenClaw-owned completion boundary. Do not teach the Agent to dereference arbitrary URLs.

## Target flow

```text
Owner WhatsApp message
      |
      v
OpenClaw Agent
      |
      v
native image_generate
      |
      +-- immediate started receipt (no final image expected)
      |
      v
OpenClaw detached media job
      |
      v
9Router / provider fallback
      |
      v
SUCCESS
      |
      | authoritative structured result
      | executed.attachments / executed.mediaUrls
      v
Pinned typed generated-media completion bridge
      |
      v
Amadeus generated media claimer
      |
      v
Host image asset service import
      |
      v
img_<opaque id>
      |
      v
AttachmentPart(disposition='inline')
      |
      v
DeliveryEnvelope v2
      |
      v
single ledger settlement
      |
      v
WhatsApp sendImage exactly once
```

The completion Agent/LLM is downstream of the generated-media authority and must not be required for the image bytes to reach the owner.

## Required source changes

Codex must inspect the current tree and choose exact names based on existing ownership, but the final responsibilities must be equivalent to the following.

### A. Remove the current wrong production extractor

Remove the `llm_input` production logic whose purpose is to detect image completion by scanning `historyMessages` for `{ type: 'image', mimeType, data }` and calling `enqueueGeneratedImageBytes` from that shape.

Also remove state that exists solely for that incorrect extractor, including completion promises/maps if no longer required by the corrected architecture.

Do not retain it as a fallback.

### B. Replace `enqueueGeneratedImageBytes` with a runtime-attachment claimer

Create one deterministic import function that accepts only trusted runtime-generated attachment facts.

The logical input should be equivalent to:

```ts
type GeneratedImageCompletion = {
  toolName: 'image_generate';
  taskId: string;
  runId?: string;
  requesterSessionKey: string;
  attachments: readonly AgentGeneratedAttachment[];
  mediaUrls?: readonly string[];
};
```

It must:

1. verify this completion really belongs to native `image_generate`;
2. correlate it to the requester session/delivery ledger using runtime IDs, not text;
3. choose image attachments only;
4. validate/import bytes into the current host image asset registry;
5. create `AttachmentPart` values with `disposition: 'inline'`;
6. settle through DeliveryEnvelope v2;
7. deduplicate retries using a stable delivery id derived from trusted task identity;
8. bind provider message id back to registry assets after successful channel send.

### C. Claim before completion LLM serialization

Add the Amadeus claim at the OpenClaw background completion boundary where the pinned runtime has the actual `executed.attachments`/`executed.mediaUrls` values.

The claimer must run before those facts can degrade into prompt text or a model continuation.

Do not depend on `llm_input`, `before_agent_finalize` or `reply_payload_sending` to recover the generated file.

### D. Make suppression conditional on proven ownership

The current logic must not cancel a media completion merely because its run origin is `media_completion`.

A final/native completion may be suppressed only when the typed generated-media completion has been positively claimed by Amadeus and the same stable delivery id is owned by the v2 ledger.

Required invariant:

```text
suppress competing delivery
IFF
verified generated-media completion claimed
AND v2 settlement owns the stable delivery id
```

If the handoff is absent or failed before ownership, fail loudly with a bounded diagnostic such as `media_completion_handoff_missing`; do not silently return `delivery_completion_owned`.

Do not fall back to sending model-authored media paths.

### E. Caption policy

Image bytes must not wait for caption generation.

Choose the simplest architecture consistent with the current v2 settlement:

- attachment-only settlement is acceptable; or
- a deterministic/known caption may accompany it if already available without a second model dependency.

Do not delay successful image delivery waiting for a completion LLM caption.

If a later completion model message still runs for unrelated lifecycle reasons, it must not duplicate the attachment and must not be able to cancel/rewrite the already-owned image settlement.

## Tests

Delete/rewrite the current synthetic test whose success depends on constructing `llm_input.historyMessages` with a base64 typed image part. That fixture is not accepted as proof of the production image-generation path.

Add focused tests that model the pinned OpenClaw `2026.9.4` lifecycle.

### Test 1 — async start contains no image

Simulate native `image_generate` returning only the background started receipt.

Assert:

- no generated asset is registered yet;
- no send occurs yet;
- this is not treated as an error.

### Test 2 — background completion owns image

Then complete the detached task with a real structured generated attachment:

```ts
{
  type: 'image',
  path: '<trusted temp generated path>',
  mimeType: 'image/png'
}
```

Assert:

- exactly one asset import;
- imported bytes equal source bytes;
- exactly one DeliveryEnvelope attachment;
- `disposition === 'inline'`;
- exactly one `sendImage`;
- asset delivery binding records the returned provider message id.

### Test 3 — completion LLM never runs

After successful background completion, do not invoke the completion LLM path at all.

The image must still be sent.

### Test 4 — completion LLM fails

Make the later completion model timeout/throw/malformed.

The generated image must still have been sent exactly once.

### Test 5 — text-only completion continuation

Model the exact real failure shape observed by the owner: downstream continuation contains only text/generated-media reference and no base64 typed image part.

The image must still be delivered because ownership occurred earlier.

### Test 6 — provider fallback

Model primary provider failure/429 followed by successful fallback generation.

The fallback result's generated attachment must settle exactly once.

### Test 7 — retry/idempotency

Replay the same background completion/task id.

Assert:

- no duplicate image asset delivery;
- no duplicate WhatsApp image send;
- one stable delivery id/ledger outcome.

### Test 8 — invalid attachment fails closed

Cover symlink, nonexistent file, non-image MIME, oversized file, path outside the trusted runtime-generated boundary and model-authored fake path.

No send is allowed.

### Test 9 — normal generated image -> later upscale

After ordinary inline image delivery, issue the logical equivalent of “把刚才那张图超分”.

Assert:

- latest/reply resolution finds the delivered original registry asset;
- upscale remains a derived asset;
- upscale attachment remains `disposition: 'document'`;
- no regression to ordinary inline generation.

### Test 10 — JSON/voice regression

Run existing DeliveryEnvelope text/voice/JSON-leak regression suites. This corrective change must not reintroduce raw structured reply serialization or alter TTS behavior.

## Runtime diagnostics

Add bounded structured logs around the new bridge so a real gate can distinguish:

```text
generated_media_completion_observed
generated_media_completion_claimed
generated_media_asset_imported
generated_media_delivery_settled
generated_media_duplicate_ignored
generated_media_handoff_failed
```

Include safe correlation IDs/task ids/delivery ids and counts, but never prompt text, image bytes, credentials or signed URLs.

Failures must record the actual bounded failure reason. Do not collapse every failure into a generic `typed image completion failed closed` warning.

## Repository cleanup gate

After implementation, search active code for the retired/wrong mechanisms.

The following concepts must have zero production ownership of generated-image delivery:

```text
llm_input image/base64 completion extraction
historyMessages image completion recovery
enqueueGeneratedImageBytes (if retained only for the old path)
completionSettlements tied solely to llm_input typed-image recovery
MEDIA: path parsing for generated image ownership
pending tool media sender
forceDocument for ordinary generated image delivery
```

Historical docs/checkpoints may retain these names as evidence.

## Validation level

This is a RUNTIME source change. Before any production apply:

1. `pnpm workflow:plan`;
2. focused generated-media completion tests;
3. `pnpm test:delivery` or the minimum expanded suite required by touched code;
4. `pnpm test:amadeus`;
5. `pnpm typecheck:amadeus`;
6. `pnpm build:amadeus`;
7. any focused OpenClaw pinned-integration test added for the bridge;
8. `git diff --check`;
9. `pnpm check:secrets`.

If the OpenClaw immutable image definition/source overlay changes, mark a release build as required but do not perform production apply without explicit owner authorization.

## Source completion gate

Before reporting source implementation complete, Codex must provide:

- exact pinned OpenClaw source location where authoritative generated attachments are claimed;
- proof that the immediate async-start tool result is not assumed to contain the final image;
- proof that the old `llm_input/historyMessages` image extractor is gone from production code;
- stable idempotency key/delivery id derivation;
- path/media validation rules;
- tests modeling the real detached lifecycle rather than a synthetic base64 completion message;
- repository-wide search results for retired ownership paths;
- commit SHA.

## Production apply — separate explicit authorization

Do not deploy merely because source tests pass.

After source completion, report the immutable image/build/deploy steps required. Wait for explicit operator authorization before `--apply`, Compose switch or equivalent production mutation.

When authorized later, production rollout must follow AGENTS.md protected checkpoint rules.

## Real owner acceptance after authorized apply

The Goal cannot close until real WhatsApp acceptance proves all of the following.

### Gate A — ordinary image generation

Owner asks Kurisu to generate a normal image.

Pass only if:

- provider completes successfully, including fallback if primary is unavailable;
- exactly one image appears in WhatsApp;
- it is a normal inline image, not a document;
- registry contains the original generated asset;
- logs show the background completion was claimed before any completion LLM dependency.

### Gate B — no second-LLM dependency

During a controlled test, the downstream completion LLM may fail/timeout while the generation itself succeeds.

The image must still arrive exactly once.

### Gate C — retry safety

A retry/replayed completion must not duplicate the image.

### Gate D — later upscale

Owner asks to upscale the generated image.

The original asset must resolve and the derived 4x/default or explicit requested scale must be produced through the existing host service.

### Gate E — WhatsApp document preservation

The upscale result must still use WhatsApp document/file delivery. Recipient-downloaded bytes should be compared with the host derived asset SHA-256 when feasible; byte/hash equality is the strongest acceptance evidence.

### Gate F — reply/voice regression

Normal text and voice replies still work and no internal JSON appears.

## Definition of Done

This corrective Goal is complete only when:

- ordinary native `image_generate` successful completion is claimed from the pinned OpenClaw background media runtime before completion LLM serialization;
- no production image-delivery logic depends on `llm_input.historyMessages` containing base64 image parts;
- generated images are registered as host assets and settled as DeliveryEnvelope v2 inline attachments exactly once;
- downstream completion LLM failure cannot discard a successfully generated image;
- no old pending-media sender or text/media parser is restored;
- suppression occurs only after proven typed ownership;
- focused detached-lifecycle tests pass;
- DeliveryEnvelope JSON/voice/upscale regression tests pass;
- source is committed cleanly;
- after a separately authorized deployment, real WhatsApp Gates A–F pass or remaining failed gates are recorded accurately without claiming completion.

## Codex execution instruction

Treat this document as the authoritative corrective Goal for the broken ordinary image-generation path. Re-read Git and the pinned OpenClaw `2026.9.4` source before editing. Do not preserve the current `llm_input/historyMessages` image extractor as a fallback. Do not restore retired pending-media delivery. Move generated-image ownership to one typed background-completion boundary, keep DeliveryEnvelope v2 as the only user-facing settlement contract, verify with the real detached lifecycle, commit the source candidate, and stop before production apply unless the operator explicitly authorizes deployment.