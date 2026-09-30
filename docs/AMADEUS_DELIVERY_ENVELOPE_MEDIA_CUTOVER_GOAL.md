# Amadeus DeliveryEnvelope v2 + Media Delivery Cutover — Goal

Date: 2026-09-30
Type: runtime architecture cutover / structured reply hardening / media delivery correctness
Canonical baseline: Git `main`; OpenClaw remains the sole Agent runtime.

## Operator decision

This is a **one-time clean cutover**. Do not keep a compatibility layer, dual path, legacy fallback, output cleanup shim, or migration adapter for the retired reply/media protocol.

The two production defects to eliminate are:

1. internal structured reply JSON can leak into Kurisu's user-visible messages;
2. an upscaled image intended to be delivered as a file/document can still travel through WhatsApp's image path and be recompressed.

Repeated fixes that strip serialized JSON from visible text or propagate a late `forceDocument` boolean across OpenClaw internal bundles have not solved the architectural cause. This Goal replaces those mechanisms rather than extending them.

## Root cause statement

The current system has two partially independent delivery worlds:

```text
Agent structured reply
  -> ReplyEnvelope
  -> text / voice settlement

Tool media result
  -> OpenClaw media extraction / merge / pending media state
  -> channel media delivery
```

`ReplyEnvelope` owns text/voice but does not own attachments. Media therefore travels through a separate OpenClaw path, where internal structured reply serialization can be merged into visible text and attachment delivery intent can be reduced to generic media plus a fragile `forceDocument` hint.

The root defect is **not** an incomplete JSON regex and **not** a missing `forceDocument` propagation site. The defect is the absence of one typed end-to-end delivery contract covering visible text, voice, and attachments through final channel settlement.

## Goal

Replace the current split reply/media delivery architecture with one authoritative `DeliveryEnvelope v2` contract and one settlement boundary such that:

1. protocol serialization is never user-visible content;
2. raw Agent structured reply JSON is consumed exactly once by a decoder and cannot continue downstream as presentation text;
3. text, voice, attachments, and silence are represented in one typed delivery object;
4. attachment delivery semantics are explicit and first-class;
5. an attachment with `disposition: document` is delivered as a WhatsApp document/file even when its MIME type is `image/png`, `image/jpeg`, or another image type;
6. normal generated images may remain `disposition: inline` and render as native image messages;
7. upscale results default to `disposition: document` so WhatsApp does not recompress the derived asset;
8. the final WhatsApp attachment received by the owner can be proven byte-identical to the derived asset by SHA-256;
9. the legacy ReplyEnvelope/media dual path and the JSON/document-delivery patch hacks are deleted after the cutover;
10. Telegram and future channels remain transport adapters, not owners of media business semantics.

## Non-negotiable cutover rules

- No legacy `ReplyEnvelope -> DeliveryEnvelope` translator.
- No dual write / dual settlement.
- No regex whose purpose is to remove internal reply JSON from user-visible text.
- No generic `forceDocument` compatibility flag propagated across the new internal contract.
- No tool-name, model-name, Chinese phrase, or keyword routing to decide attachment disposition.
- No MIME-derived override such as `image/* => inline` after disposition has been set.
- No raw local absolute filesystem path in the Agent-facing or channel-facing contract.
- No second sender, second Agent runtime, LangBot/n8n route, or WhatsApp-specific business workflow.
- No silent fallback from an invalid structured reply to sending the raw model output.
- No completion claim based only on unit tests. Real WhatsApp owner-channel acceptance is mandatory.

## Target architecture

```text
OpenClaw Agent / native tools
          |
          | structured semantic results
          v
+-------------------------------+
| Structured Reply Decoder      |
| Tool Result -> Delivery Parts |
+-------------------------------+
          |
          | typed data only
          v
+-------------------------------+
| DeliveryEnvelope v2           |
| - text                        |
| - voice                       |
| - attachment                  |
| - silent                      |
+-------------------------------+
          |
          v
+-------------------------------+
| Single Delivery Settlement    |
+-------------------------------+
          |
     +----+----------------------+------------------+
     |                           |                  |
 WhatsApp adapter          Telegram adapter     future adapter
     |
     +-- text
     +-- voice
     +-- inline attachment  -> image/media primitive
     +-- document attachment -> document/file primitive
```

There must be no independent automatic tool-media sender that can race with or bypass the authoritative settlement for a user-facing run.

## DeliveryEnvelope v2 contract

Codex may adjust names to match repository conventions, but the semantics below are mandatory.

Suggested shape:

```ts
export type DeliveryEnvelope = Readonly<{
  version: 2;
  runId: string;
  deliveryId: string;
  sessionKey: string;
  channel: string;
  origin: DeliveryOrigin;
  silent: boolean;
  parts: readonly DeliveryPart[];
  source: DeliverySource;
}>;

export type DeliveryPart =
  | Readonly<{
      kind: 'text';
      text: string;
    }>
  | Readonly<{
      kind: 'voice';
      speechText: string;
      emotion: ReplyEmotion;
    }>
  | Readonly<{
      kind: 'attachment';
      assetId: string;
      mimeType: string;
      fileName: string;
      disposition: 'inline' | 'document';
      byteSize?: number;
      sha256?: string;
    }>;
```

If caption semantics are required, model them explicitly either as a text part with deterministic ordering or a bounded attachment caption field. Do not serialize protocol JSON into a caption.

### Required invariants

- `version` must be exactly `2`; old ReplyEnvelope payloads are rejected, not upgraded.
- `silent: true` requires `parts.length === 0`.
- each user-visible text string comes only from a `kind: 'text'` part;
- internal control tokens and protocol objects cannot be rendered by stringifying an envelope;
- `assetId` is the primary media identity; absolute paths are not contract fields;
- `fileName` is sanitized and non-empty;
- `mimeType` describes file content, not delivery semantics;
- `disposition` decides inline-vs-document delivery;
- `document` disposition wins regardless of an `image/*` MIME type;
- optional `byteSize` and `sha256` are integrity metadata and must be verified against the authoritative asset when available;
- duplicate `deliveryId` remains idempotent across the complete envelope, including attachments.

## Structured reply boundary: consume once, then destroy raw protocol serialization

The Agent/model may still produce a bounded structured reply shape, but only one decoder is allowed to interpret it.

Required flow:

```text
raw model output
  -> parse/validate structured reply
      -> success: create typed DeliveryEnvelope parts
                  raw protocol string is no longer eligible for delivery
      -> failure: controlled deterministic fallback or explicit error policy
                  NEVER send raw structured protocol text
```

### Required behavior

- Remove downstream code that tries to recognize and strip `{ "visibleText": ... }`, `{ "modality": ... }`, fenced structured JSON, or similar protocol fragments.
- Do not add a broader cleanup regex.
- Do not inspect the final visible text to guess whether it is protocol JSON.
- A user explicitly asking Kurisu to output JSON must continue to work because that requested JSON is ordinary text content in a text part, not the internal protocol object.
- Decoder tests must cover field reordering, whitespace, fenced/embedded malformed output, extra keys, missing keys, and invalid modality/emotion.
- Invalid protocol output must fail closed without leaking the raw internal representation.

## Tool/media result boundary

The image generation/upscale capability returns semantic asset metadata. A deterministic mapper converts eligible tool results into `DeliveryPart` objects before settlement.

Do not rely on generic OpenClaw media extraction to infer final delivery behavior after this mapping has occurred.

### Normal image generation

Expected final semantic result:

```ts
{
  kind: 'attachment',
  assetId: generated.imageId,
  mimeType: generated.mimeType,
  fileName: generated.fileName,
  disposition: 'inline'
}
```

Normal generated images therefore keep the normal image-message UX unless another explicit capability contract says otherwise.

### Upscale result

Expected final semantic result:

```ts
{
  kind: 'attachment',
  assetId: derived.imageId,
  mimeType: derived.mimeType,
  fileName: derived.fileName,
  disposition: 'document',
  byteSize: derived.byteSize,
  sha256: derived.sha256
}
```

The upscale capability owns the semantic fact that its returned derived asset should be delivered losslessly as a document by default. It must not communicate this through `forceDocument` or text tokens.

This policy is capability/result metadata, not phrase routing. The same backend/operator invocation by `imageId` must produce the same attachment disposition.

## Asset resolution and file access

Reuse the current image asset registry/storage work. The delivery layer receives an `assetId` and resolves it through one authoritative asset service/repository.

Requirements:

- resolve only registered assets;
- reject missing, failed, or non-ready assets;
- canonicalize file access beneath the configured asset root;
- reject traversal and symlink escapes;
- validate the actual file MIME/content metadata where current code supports it;
- prefer streaming or bounded reads appropriate to the channel transport;
- never let the model provide an arbitrary absolute path for outbound delivery;
- preserve the stored original/derived file unchanged during delivery.

## Single settlement ownership

Replace the current text/voice-only delivery adapter with a complete settlement adapter.

Suggested conceptual interface:

```ts
export type DeliveryAdapters = Readonly<{
  sendText(part: TextPart, context: DeliveryContext): Promise<DeliveryReceipt>;
  sendVoice(part: VoicePart, context: DeliveryContext): Promise<DeliveryReceipt>;
  sendAttachment(part: AttachmentPart, context: DeliveryContext): Promise<DeliveryReceipt>;
  synthesize(...): Promise<...>;
}>;
```

Exact signatures are Codex's decision after inspecting current plugin/channel APIs, but there must be one authoritative settlement state for the whole `deliveryId`.

### Ordering

Preserve deterministic ordering of `parts`.

For the current Kurisu voice UX, if the accepted behavior remains voice plus visible text, represent and settle that intentionally rather than having TTS send text as an implicit side effect.

For image/upscale replies, do not let an automatic tool-media queue send the asset before/after the new settlement. The same asset must not be delivered twice.

### Failure behavior

- text send failure: record failed delivery; do not stringify the envelope as fallback;
- TTS failure: apply the existing accepted text fallback policy using the typed text part only;
- attachment resolution/send failure: return/record a bounded delivery failure; do not fall back from `document` to compressed `image` merely to make delivery succeed;
- unsupported channel disposition: fail explicitly or use an adapter-defined semantically equivalent file primitive, never silently reinterpret the attachment as inline image.

## WhatsApp transport rule

WhatsApp is responsible only for translating typed delivery parts into provider primitives.

Required decision order:

```text
attachment.disposition == 'document'
  -> WhatsApp document/file send primitive

attachment.disposition == 'inline'
  -> WhatsApp normal media/image send primitive according to bounded MIME support
```

Forbidden decision order:

```text
mimeType startsWith 'image/'
  -> image primitive
  -> maybe inspect forceDocument later
```

A PNG/JPEG with `disposition: document` must never hit the image path.

The final provider payload/logging should make the chosen primitive observable without logging media bytes or secrets.

## Telegram and future channels

Keep the contract channel-neutral. Telegram may map `inline` to photo/media and `document` to document/file as appropriate, but no WhatsApp-specific field may enter `DeliveryEnvelope`.

Do not block the cutover on unnecessary feature expansion. The acceptance requirement is no regression for current supported Telegram flows and correct semantic mapping where the adapter already supports attachments.

## Legacy code removal — mandatory

After the new path is wired and focused tests pass, remove the old architecture instead of leaving dormant code.

At minimum, inspect and remove or replace all active references to:

- `plugins/amadeus/src/reply-envelope.ts` as the old public contract;
- `plugins/amadeus/src/reply-delivery.ts` as the old text/voice-only settlement;
- old `ReplyEnvelope`, `ReplyModality`, legacy reply parser/validator imports that are no longer part of the new architecture;
- `scripts/patch-openclaw-media-json-cleanup.mjs`;
- `scripts/patch-openclaw-tool-document-delivery.mjs`;
- package/deploy/build hooks that apply either retired patch;
- tests whose purpose is to prove JSON-tail stripping rather than protocol isolation;
- tests whose purpose is to propagate `forceDocument` through intermediate OpenClaw state rather than prove final typed disposition;
- `pendingToolForceDocument`, `toolForceDocument`, and equivalent compatibility state introduced only for the retired patch path;
- `stripPendingToolMediaStructuredTail`, regex-based structured-tail cleanup, and equivalent helpers;
- automatic/pending tool-media delivery branches that can bypass the new settlement for Amadeus user-facing delivery;
- stale docs/comments that describe the patch hacks as the intended architecture.

Do not delete unrelated OpenClaw media support required by other capabilities. The implementation must identify the exact Amadeus ownership boundary and retire only the obsolete dual path/hacks.

Run repository-wide searches before completion for at least:

```text
ReplyEnvelope
forceDocument
toolForceDocument
pendingToolForceDocument
media-json-cleanup
tool-document-delivery
stripPendingToolMediaStructuredTail
visibleTextWithoutStructuredTail
```

Every remaining hit must be intentional and explained in the Goal evidence. Prefer zero hits for retired names.

## OpenClaw integration strategy

First determine whether the pinned OpenClaw version exposes a stable typed hook that can carry the complete Amadeus delivery payload to the channel adapter.

Preferred order:

1. repository-owned plugin/source API integration;
2. one narrow, version-pinned source-level integration/overlay at a documented boundary if upstream lacks the required hook;
3. never return to multiple regex edits across compiled bundles as the architectural solution.

If one pinned integration patch remains technically necessary because OpenClaw does not expose the required hook, it must:

- operate at one explicit boundary;
- transport typed fields without parsing user-visible strings;
- fail build/startup on anchor/version mismatch;
- have a focused contract test;
- contain no JSON cleanup regex;
- contain no `forceDocument` compatibility propagation chain;
- be documented as the canonical integration layer, not a transitional fallback.

The implementation must prefer deleting all bundle patching when the current plugin API makes that possible.

## Telemetry and diagnostics

Extend delivery telemetry to make root-cause diagnosis possible without inspecting private message bodies.

Record bounded structured fields such as:

```text
run_id
delivery_id
channel
part_kinds
attachment_count
attachment_dispositions
asset_id (or safe shortened/hash form if existing privacy convention requires)
asset_byte_size
asset_sha256_present
provider_primitive = text | voice | image | document
final_status
failure_stage
fallback_reason
```

Do not log model raw output, full visible messages, media bytes, credentials, auth headers, signed URLs, or arbitrary filesystem paths.

## Implementation phases

### Phase 0 — Reproduce and map the live path

Before edits:

- read `docs/CONTEXT.md`, `docs/CURRENT_TASK.md`, this Goal, `docs/ARCHITECTURE.md`, `docs/PROJECT_STATE.md`, `.agent/state.md` as applicable;
- run `git status --short --branch` and `git log -5 --oneline --decorate`;
- locate every current producer/consumer of ReplyEnvelope and every media delivery path used by image generation/upscale;
- locate both retired patch scripts and all build/deploy/test references;
- identify the exact WhatsApp provider primitive used for image and document sends;
- capture focused failing/reproduction tests for the two reported defects before redesign where practical.

Deliverable: a concise code-path map in the implementation notes/commit description, not a new parallel architecture document.

### Phase 1 — Introduce DeliveryEnvelope v2

- create the new typed contract in the appropriate `plugins/amadeus`/shared presentation boundary;
- add strict validation and constructors/builders;
- model text, voice, attachment, silence as typed parts;
- add asset/disposition invariants;
- add parser/decoder tests;
- do not add a compatibility constructor from old ReplyEnvelope.

### Phase 2 — Cut Agent structured reply over to the new decoder

- make one decoder the sole consumer of Agent structured output;
- convert successful output directly into typed parts;
- ensure the raw protocol string is not passed to presentation/media settlement;
- implement fail-closed invalid-output behavior;
- add regression tests proving no internal JSON can reach `sendText`/caption fields;
- preserve legitimate user-requested JSON as ordinary text.

### Phase 3 — Cut text/voice settlement over

- replace `reply-delivery.ts` ownership with complete delivery settlement;
- preserve accepted voice/text fallback semantics using typed parts;
- preserve idempotency and per-delivery settlement state;
- update telemetry;
- migrate all callers atomically and delete the old ReplyEnvelope path once no caller remains.

### Phase 4 — Integrate tool assets into the same envelope

- convert image generation/upscale tool results into attachment parts before final settlement;
- normal generation -> `inline`;
- upscale derived result -> `document`;
- carry `assetId`, filename, MIME, byte size, SHA-256 where available;
- disable/remove Amadeus automatic tool-media delivery that would bypass or duplicate settlement;
- prove reply-to-image/recent-image resolution remains intact.

### Phase 5 — Make WhatsApp disposition authoritative

- implement one attachment sender entrypoint;
- choose document/file primitive before MIME-specific inline media handling when disposition is `document`;
- ensure image MIME does not override `document`;
- make provider primitive observable in telemetry/tests;
- never downgrade document to image on failure.

### Phase 6 — Delete legacy hacks and dead state

- delete both current JSON/document workaround scripts;
- remove their package/deploy/build hooks;
- delete `forceDocument` propagation-only state and tests;
- delete structured-tail cleanup helpers/tests;
- delete obsolete ReplyEnvelope/reply-delivery files after imports are migrated;
- run repository-wide zero/justified-hit searches listed above;
- update architecture/current-state docs to describe only the new path.

This phase is part of implementation, not optional cleanup for later.

### Phase 7 — Focused tests and repository validation

Run the minimum sufficient RUNTIME validation required by `AGENTS.md`, including:

- DeliveryEnvelope validation tests;
- decoder isolation tests;
- legitimate user JSON text test;
- malformed structured output fail-closed test;
- text-only settlement;
- voice + visible text settlement;
- TTS failure typed text fallback;
- inline generated image delivery;
- PNG upscale document delivery;
- JPEG upscale document delivery;
- no disposition loss through tool -> envelope -> adapter;
- duplicate/idempotent delivery test;
- no duplicate automatic tool-media send;
- WhatsApp provider payload/primitive contract tests;
- Telegram focused non-regression tests;
- image asset resolution/path safety tests affected by the cutover;
- affected package/plugin typecheck/build;
- `git diff --check`;
- `pnpm check:secrets`.

Use `pnpm workflow:plan` first and do not perform a Docker build/deploy merely because plugin/runtime code changed.

## Real acceptance gates

Repository tests are necessary but not sufficient. Production completion requires explicit owner-channel acceptance after a separately authorized deployment/apply.

### Gate A — text protocol isolation

In real WhatsApp conversation:

- normal Kurisu text reply contains no structured protocol JSON;
- alternate field ordering/voice replies do not expose protocol JSON;
- no `reply`, `voice`, `normal`, `no-reply`, envelope object, control token, or internal directive is displayed;
- asking Kurisu to intentionally output an example JSON object still displays that requested JSON correctly.

### Gate B — voice regression

- normal Japanese Kurisu voice reply still sends valid voice;
- intended visible text behavior remains correct;
- controlled TTS failure uses only the typed text fallback;
- no raw structured output is used as fallback.

### Gate C — normal generated image

- generate a new image normally;
- it arrives with normal inline/image UX;
- exactly one copy is delivered;
- asset registry correlation is retained.

### Gate D — upscale document delivery

For both 2x and at least one representative 4x or additional-mode case:

- request upscale through normal Kurisu flow;
- WhatsApp shows the derived image as a document/file attachment, not a compressed image bubble;
- filename is preserved/sane;
- download the received file;
- compute SHA-256 of the received file;
- compare with the authoritative host derived asset SHA-256;
- hashes must match exactly;
- byte size must match exactly.

A screenshot that merely looks sharp is not evidence for this gate.

### Gate E — MIME independence

Prove at least:

```text
image/png  + disposition=document -> WhatsApp document
image/jpeg + disposition=document -> WhatsApp document
image/png  + disposition=inline   -> WhatsApp image/media
```

### Gate F — restart/recreate durability

After the authorized runtime deployment, verify a normal OpenClaw restart/recreate does not lose image asset identity or disposition semantics for a newly invoked upscale flow.

## Runtime apply and rollback

This Goal is RUNTIME code and will require a separate explicit deployment/apply to affect the live CasaOS OpenClaw instance.

Codex must not deploy merely because implementation is complete unless the operator's `/goal` instruction explicitly authorizes applying the completed cutover.

If deployment is authorized:

1. run required tests and secrets checks;
2. create a protected external rollback checkpoint of affected runtime definitions/configuration according to repository rules;
3. build/tag immutable image only if `workflow:plan`/changed files require it;
4. update CasaOS compose through the repository deployment path;
5. start with `--no-build` against the immutable tag where applicable;
6. run health/smoke tests;
7. execute real Gates A–F;
8. on failure, restore the previous immutable runtime/checkpoint rather than reintroducing compatibility code into `main`.

Rollback is a deployment operation, not an excuse to retain the old architecture in source.

## Definition of done

This Goal is complete only when all of the following are true:

- `DeliveryEnvelope v2` is the single authoritative user-facing delivery contract;
- text, voice, and attachments settle through one path;
- raw structured reply serialization cannot reach user-visible delivery fields;
- invalid structured replies fail closed;
- legitimate user-requested JSON remains supported as text;
- upscale returns a typed `document` attachment;
- WhatsApp maps `document` disposition to its document/file primitive before MIME handling;
- downloaded WhatsApp upscale file is byte-identical to the host derived asset;
- normal generated images still use inline image delivery;
- no duplicate tool-media sender bypasses settlement;
- old ReplyEnvelope text/voice-only contract is removed;
- JSON cleanup regex workaround is removed;
- `forceDocument` propagation workaround is removed;
- both retired patch scripts and all active hooks to them are removed;
- repository-wide retired-name search has zero hits or each exceptional hit is documented as historical-only evidence;
- focused RUNTIME tests/typechecks/diff/secrets checks pass;
- architecture/current-state docs describe the new path only;
- after authorized deployment, real WhatsApp Gates A–F pass with retained evidence.

## Codex execution constraints

- Treat this document as the canonical active Goal while `docs/CURRENT_TASK.md` points to it.
- Do not ask the operator to choose between legacy compatibility and clean cutover; clean cutover is already decided.
- Do not solve either defect with a new regex or another field-propagation patch.
- Prefer source-owned typed contracts and deterministic adapters.
- Do not weaken current TTS/image asset/security invariants unrelated to this cutover.
- Do not deploy until the `/goal` instruction explicitly permits apply; code completion and runtime apply remain distinct phases.
- If the pinned OpenClaw API blocks a clean implementation, document the exact missing hook and implement the narrowest single typed integration boundary possible. Do not scatter edits across compiled bundles.
