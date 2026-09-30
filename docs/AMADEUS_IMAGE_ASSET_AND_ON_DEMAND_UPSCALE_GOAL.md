> Historical-only audit evidence. Superseded by `docs/CURRENT_TASK.md`; retired contract names below are not live instructions or runtime dependencies.

# Amadeus Image Asset + On-Demand Upscale — Goal

Date: 2026-09-29
Type: capability integration / host-native media processing / storage
Canonical baseline: Git `main`; OpenClaw remains the sole Agent runtime; existing native `image_generate` remains the generation path.

## Background

Amadeus can already generate images through OpenClaw native `image_generate` and the existing 9Router-backed image provider. The next requirement is not to upscale every generated image automatically. The owner wants super-resolution to be an explicit, reusable capability that Kurisu can invoke only when asked, for example:

- “把刚才那张图超分一下发我”
- reply to an older image and say “把这张 2 倍超分”
- “这张用动漫模型超一下”
- “上一张写实图 4 倍高清化”
- invoke the same capability manually/backend-side against a known image asset

The current image generation path must therefore gain durable image-asset identity/storage, while super-resolution itself runs natively on the macOS host so it can use Apple Silicon acceleration without coupling model runtime into the OpenClaw Linux container.

The owner explicitly prefers generated/source images to live on the macOS host. Do not hardcode a macOS username, `/Users/<name>`, a previous device account, LAN IP, domain, or port. Codex must discover the actual current host environment and use the repository's existing host-profile/config mechanisms where appropriate.

## Goal

Build a production-ready, optional image asset + on-demand upscale capability with these properties:

1. every newly generated image that needs to remain addressable is persisted durably on the macOS host and receives a stable opaque `imageId`;
2. normal image generation does **not** automatically invoke super-resolution;
3. Kurisu/OpenClaw can resolve the image referenced by the current conversation, especially a replied image or the most recent eligible image in that conversation, and invoke one generic upscale capability;
4. the same capability can be invoked explicitly by `imageId` from backend/operator workflows without depending on chat language;
5. super-resolution runs in a host-native service on macOS, preferring Apple Silicon/CoreML/Metal-compatible implementations;
6. realistic and anime/illustration images are both supported through bounded modes, with `2x` as the default scale and `4x` available explicitly;
7. originals are immutable; every upscale is a derived asset linked to its parent;
8. host paths, service endpoints, model locations, ports and usernames remain runtime configuration, not scattered literals;
9. WhatsApp/Telegram/channel adapters remain transport-only. They must not own “latest image”, model selection, upscale logic, storage policy, or keyword routing.

## Non-goals

This Goal does **not**:

- upscale every generated image automatically;
- replace OpenClaw native `image_generate` or create a parallel image-generation planner;
- add a second Agent, workflow orchestrator, Mastra/LangBot-style router, or keyword/regex top-level intent router;
- require a public Internet media origin;
- expose arbitrary macOS filesystem access to the model or to chat users;
- implement arbitrary image editing, face restoration, inpainting, ControlNet, ComfyUI, or local text-to-image generation;
- migrate every historical image from old chat history in MVP;
- promise semantic “quality improvement” beyond super-resolution; model hallucinated detail is possible and must not be represented as recovered ground truth;
- force a specific package if it proves incompatible with the actual current Apple Silicon/runtime. Candidate engines may include Real-ESRGAN/CoreML or another maintained Apple-Silicon-native implementation, but Codex must verify the actual host before locking it in.

## Architecture invariants

### 1. OpenClaw stays the only Agent

Natural-language understanding remains model-owned by OpenClaw. The user can phrase the request naturally; the capability surface is exposed through a Skill/tool contract. Do not add deterministic phrase matching such as `if text contains 超分` as a new intent router.

### 2. Native image generation remains authoritative

Keep the existing path established by `docs/AMADEUS_DEFAULT_IMAGE_GENERATION_GOAL.md`:

```text
User
  -> OpenClaw Agent
  -> native image_generate
  -> existing 9Router-backed image model
  -> generated image
```

This Goal extends the result handling/storage boundary; it does not replace the generator.

### 3. Host-native persistence is authoritative for durable image assets

Durable source/derived images must be stored on the macOS host, outside ephemeral container filesystems. The exact root is intentionally unspecified in Git.

Codex must:

- inspect the current host-profile conventions and current macOS environment;
- choose or reuse a durable host media root suitable for the present machine;
- make that root configurable through the established runtime/host-profile mechanism;
- keep the real machine-specific value outside Git;
- mount or expose only the minimum required view to OpenClaw/services;
- prove an OpenClaw/container recreate does not delete the host assets.

A repository example may use symbolic names such as `AMADEUS_IMAGE_ASSET_ROOT`, but do not assume that exact name if an existing configuration convention is better.

### 4. Do not make absolute paths part of the Agent contract

The primary identity exposed to OpenClaw is `imageId`, not `/Users/...`.

Persist metadata using a relative storage key/path wherever practical. If operator-only manual path support is retained, it must be canonicalized and restricted to the configured image asset root. `../`, symlink escape, arbitrary absolute paths, remote URLs and shell-expanded paths must fail closed unless a separately trusted import path already exists.

### 5. Upscale runs as a macOS host service

Target boundary:

```text
OpenClaw / amadeus capability
        |
        | structured request: imageId, scale, mode
        v
Host image/upscale service on macOS
        |
        +-- asset registry/storage
        +-- Apple-Silicon-native upscale engine
        +-- derived asset writer
        v
stable derived imageId + metadata
        |
        v
existing channel attachment delivery
```

The host service is an execution service/tool, not an Agent. It must not contain an LLM, conversational planner, WhatsApp knowledge, persona logic, or destination selection.

The container-to-host URL/port must be configurable. Prefer the repository's existing host-profile service-discovery pattern over a new hardcoded `host.docker.internal:<fixed-port>` literal scattered across code.

## Image asset contract

Codex should first inspect existing persistence/storage abstractions and reuse them if suitable. Do not introduce SQLite merely because this document names metadata; if an existing store is a better fit, use it.

At minimum a durable asset record must be able to represent:

```text
imageId                 stable opaque id
kind                    original | derived
sourceKind              generated | inbound | imported/manual
createdAt               timestamp
mimeType
width
height
storageKey              relative/canonical storage key, not user-facing absolute path
byteSize                 when cheaply available
sha256/content hash      recommended for integrity/dedup evidence
parentImageId            null for original; source id for derived
transform                null or structured upscale transform metadata
origin.channel           whatsapp | telegram | ... when applicable
origin.conversationId    platform-neutral/session-safe conversation reference when available
origin.messageId         provider message reference when available
origin.replyToMessageId  when available
origin.runId/sessionId   when needed for correlation
origin.generator         existing image provider/model metadata when safely available
promptRef/metadata       only if current privacy policy permits; do not require raw prompt persistence
styleHint                realistic | anime | unknown, optional hint only
status                   ready | processing | failed, or equivalent
```

Do not store channel credentials, API keys, base64 image payloads, arbitrary tool dumps, or sensitive secrets in asset metadata.

### Directory layout

The implementation should use a deterministic host-side layout below the chosen root, for example originals vs derived and optional date/hash sharding. The exact layout is Codex's decision after inspecting current storage conventions.

Requirements:

- original and derived assets are separate and unambiguous;
- derived files never overwrite originals;
- filenames/paths are collision-safe;
- path construction is centralized;
- no macOS username is encoded in Git-visible logic;
- temporary/in-progress output is atomic or safely cleaned after failure.

## Stable access/address contract

The owner wants images to be easy to locate and address later. Implement a stable asset-address boundary, but do not require public exposure.

Preferred contract:

```text
imageId -> asset metadata -> controlled media read endpoint / stable configured base URL
```

The exact host/domain/port is environment configuration discovered at deployment. The service may expose a route such as `/media/<imageId>` or an equivalent existing repository convention.

Requirements:

- stable URLs are derived from `imageId`, not leaked filesystem paths;
- no directory listing;
- no arbitrary `?path=/...` file reader;
- unknown/unauthorized ids fail closed;
- internal/container and optional LAN access can be separate configured bases if necessary;
- a public Cloudflare/domain route is **not** required for MVP and must not be created merely to satisfy WhatsApp;
- channel delivery should use the existing attachment/upload path whenever possible rather than assuming WhatsApp can fetch an unauthenticated public URL.

Record the final chosen runtime root and base address in the appropriate protected host profile/runbook after implementation, not as a hardcoded personal path in source.

## Upscale capability contract

Expose one generic semantic capability rather than one tool per phrase.

Canonical input shape should be equivalent to:

```json
{
  "target": {
    "imageId": "optional-explicit-id"
  },
  "scale": 2,
  "mode": "auto"
}
```

Allowed scale:

- `2` — default;
- `4` — only when explicitly requested or chosen by the Agent because the user's request clearly requires it.

Allowed mode:

- `auto` — default;
- `realistic` — photo/photorealistic/general-content oriented model/profile;
- `anime` — anime/illustration oriented model/profile.

Do not let model names leak into the conversational contract. Engine/model selection belongs in host service configuration/policy.

### Mode policy

For MVP:

- explicit user choice wins;
- if the asset already has a trustworthy `styleHint`, `auto` may use it;
- otherwise `auto` should use a safe general/realistic-capable default rather than inventing a fragile text-keyword classifier;
- do not add a second LLM classifier solely to distinguish realistic vs anime;
- Codex may benchmark a small set of maintained Apple-Silicon candidates and choose the best bounded implementation for the actual host;
- model/profile mapping must be centralized in host-service config, not copied into Skills/adapters/prompts.

The owner commonly generates both photorealistic and anime images, so acceptance must cover both modes with real sample images.

## Conversation target resolution

Image reference resolution belongs in the capability boundary, using trustworthy structured conversation/message context.

Precedence:

1. **Explicit `imageId`** supplied by a trusted backend/tool invocation.
2. **Replied image** when the inbound message is structurally a reply to a message/attachment that maps to an asset. Reply context must beat “latest image”.
3. **Recent image in the current conversation/session** when the user's request semantically refers to “刚才/上一张/那张” and no explicit/reply target exists.
4. If no unambiguous eligible asset can be resolved, fail with a concise user-facing request to identify/reply to an image. Do not silently pick an image from another chat or another person.

“Latest” must be deterministic and conversation-scoped. Prefer an asset actually delivered/created in the current conversation and record enough message correlation during generation/delivery to resolve it later.

Do not solve this by scraping visible chat text or storing a global singleton `lastImage`.

## Reply/transport boundary

WhatsApp, Telegram and future channel adapters may provide normalized facts such as:

- inbound message id;
- reply/reference message id;
- structured attachments/media ids;
- conversation/session identity.

They must **not**:

- interpret “超分”;
- select Real-ESRGAN/anime models;
- search asset history;
- invoke a channel-specific upscale workflow;
- mutate filesystem paths;
- own fallback logic.

If the current normalized message/reply envelope lacks the metadata needed to map a replied image back to an asset, extend the shared normalized contract narrowly and preserve the architecture established by the repository's ReplyEnvelope work. Do not add a WhatsApp-only business shortcut.

## OpenClaw Skill ownership

Create or extend an OpenClaw Skill so the sole Agent understands:

- this capability is **optional** and should be called only when the user asks to upscale/enhance an existing image;
- ordinary image generation stops after generation/delivery unless the same user request explicitly asks for upscale;
- reply context is preferred when the user replies to an image;
- default scale is `2x`;
- explicit `4x`, `realistic`, or `anime` requests are preserved;
- successful tool output returns a derived asset suitable for the existing structured attachment path;
- internal paths, model implementation details and service URLs are not shown unless the owner explicitly asks for diagnostics.

Keep workflow knowledge in the Skill/capability, not SOUL/global persona files. Do not enumerate brittle trigger phrases as a routing table.

## Manual/backend use

Provide a deterministic operator-facing invocation path using `imageId`. It may be a focused CLI/script/tool test surface if that matches existing repository conventions.

Requirements:

- no chat session is required;
- accepts `imageId`, `scale`, and `mode`;
- produces the same derived-asset contract as Agent invocation;
- does not accept arbitrary shell commands;
- if a path-import helper is implemented, it is owner/operator-only and constrained under an approved root or explicit import boundary;
- backend/manual and chat flows must share the same core implementation rather than duplicate model execution logic.

## Generation-result persistence

The existing native `image_generate` result must be integrated with asset registration using the narrowest supported runtime boundary.

Codex must inspect the pinned OpenClaw runtime before implementation and determine the supported place to capture/register successful generated image output without forking native generation unnecessarily.

Preferred order:

1. supported native callback/plugin/tool result boundary;
2. existing structured attachment/delivery lifecycle boundary;
3. a narrow repository-owned adapter around result persistence that does not recreate image generation.

If the pinned runtime does not expose a safe interception/result boundary, document the limitation and choose the smallest architecture-compatible integration. Do not replace native generation merely because persistence is inconvenient.

Only successfully materialized images become `ready` assets. Base64 transport data must remain transient and must not be dumped into logs.

## Host runtime implementation freedom

Codex is explicitly authorized to inspect the actual current Mac host and make implementation choices consistent with this Goal.

Codex should determine:

- the current macOS account and host-profile identity;
- a durable writable host media root;
- whether an existing host service can own image processing or whether a focused new host service is cleaner;
- service language/framework consistent with the repo;
- the most appropriate maintained Apple Silicon upscale implementation;
- exact CoreML/Metal/MLX/native execution path after real compatibility testing;
- model cache/storage path outside Git;
- service port and launch/keepalive mechanism using existing host service conventions;
- persistence technology for asset metadata based on existing repo patterns;
- concurrency limits based on the actual machine and benchmark results.

These choices must be documented after discovery and exposed through configuration. “Codex can decide” does not permit architectural drift: all invariants in this Goal remain mandatory.

## Resource and execution policy

Super-resolution is GPU/memory-intensive relative to ordinary message handling, so the host service must be bounded.

At minimum:

- explicit request timeout;
- bounded concurrency, starting conservatively (for example one active upscale) until measured;
- input pixel/dimension/byte limits;
- output pixel/byte limits suitable for downstream channel delivery;
- tile-based processing if the chosen engine requires it for large inputs;
- temporary-file cleanup;
- health/readiness endpoint or equivalent probe;
- no eager duplicate model processes if one resident/loaded execution path is sufficient;
- no automatic 4x for every request.

Measure real 2x realistic and anime samples on the current Mac and record approximate latency/memory evidence during acceptance. Do not make a hard SLA from one benchmark.

## Observability

Structured logs/metrics should make these fields inspectable without storing image bytes or full prompts:

- request/correlation id;
- source `imageId`;
- derived `imageId`;
- scale;
- mode;
- selected internal engine/profile identifier (diagnostic logs only);
- source/output dimensions and byte size;
- duration;
- cache/reuse status if implemented;
- success/failure category.

Never log base64 payloads, credentials, arbitrary EXIF private metadata, or raw user media contents.

## Storage retention

Read and respect `docs/STORAGE_RETENTION_POLICY.md` and current backup policy before adding a new durable media root.

For MVP:

- originals/derived assets needed for conversational reuse are durable across container recreation;
- do not silently delete assets during the first implementation;
- if storage limits/cleanup are necessary, implement a documented configurable retention policy with protected/original semantics rather than ad-hoc `rm` cron;
- decide whether the new media root belongs in service-aware backup inventory and update the relevant docs/config if required.

## Security and privacy

- No arbitrary filesystem read endpoint.
- No public directory listing.
- No secrets in image metadata, filenames, URLs or Git.
- Strip or intentionally handle unsafe/unneeded metadata when writing derived images.
- Validate decoded image type; do not trust extension alone.
- Bound decompression/input dimensions to avoid image bombs.
- Do not execute embedded image content.
- Host service must accept only the minimum caller/network scope needed by OpenClaw/operator paths.
- If a LAN media endpoint is enabled, document its exposure and authorization assumptions.
- Do not create a Cloudflare/public tunnel unless separately justified and owner-approved.

## Required implementation phases

### Phase 0 — baseline discovery

1. Start from clean `main` and read `AGENTS.md`, `docs/CURRENT_TASK.md`, this Goal, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/STORAGE_RETENTION_POLICY.md`, `docs/AMADEUS_DEFAULT_IMAGE_GENERATION_GOAL.md`, and the current image/reply capability implementation.
2. Inspect the pinned OpenClaw runtime and prove where native `image_generate` results/attachments can be captured for persistence.
3. Inspect normalized reply/message context and prove how WhatsApp reply-to and generated outgoing message ids are represented today.
4. Inspect host-profile/service conventions and the actual current macOS host. Do not assume an old username/device path.
5. Select the minimal asset registry/storage design and host-service boundary. Record discovery facts before coding.

### Phase 1 — host media root + asset registry

1. Add configuration/schema for a durable host image asset root and any required service address/base URL.
2. Implement centralized path/storage-key construction and traversal defenses.
3. Implement asset metadata persistence with stable opaque `imageId`.
4. Add controlled asset read/materialization API needed by OpenClaw/operator workflows.
5. Add focused unit/integration tests for ids, paths, immutability and invalid access.

### Phase 2 — register generated images

1. Hook the narrowest safe native generation-result boundary.
2. Materialize the generated image into the host asset store.
3. Record generation/conversation/message correlation.
4. Preserve existing attachment delivery behavior.
5. Prove normal generation still sends one normal image and does not invoke upscale.

### Phase 3 — host-native upscale service

1. Select/install/pin a maintained Apple-Silicon-compatible engine after runtime testing.
2. Provide centralized profiles for `auto`, `realistic`, and `anime`.
3. Implement 2x and 4x with bounded validation/concurrency.
4. Save output as a new derived asset with `parentImageId` and transform metadata.
5. Add health/readiness and structured diagnostics.
6. Ensure model files/caches live outside Git and machine-specific paths stay in protected runtime config.

### Phase 4 — OpenClaw capability + Skill

1. Expose one structured upscale tool/capability to OpenClaw.
2. Add/update the appropriate Skill so natural-language requests map to that capability without keyword routing.
3. Implement deterministic target resolution: explicit id -> replied asset -> current-conversation recent asset.
4. Return a structured image attachment/asset result through the existing reply envelope/delivery path.
5. Keep channel adapters thin.

### Phase 5 — operator/manual path

1. Add a focused manual invocation by `imageId`.
2. Reuse the same host/core upscale implementation.
3. Add dry-run/status/diagnostic behavior if consistent with existing scripts.

### Phase 6 — deployment + real acceptance

Follow repository RELEASE/apply boundaries. Preserve rollback checkpoints before host/runtime changes. Deploy only affected components.

Run real acceptance on the owner's current environment and primary channel, with at least one realistic and one anime/illustration source.

## Acceptance matrix

All of the following must pass:

1. **Persistence:** a newly generated image is stored under the configured macOS host asset root and receives a stable `imageId`.
2. **Container durability:** recreating/restarting the OpenClaw container does not delete or invalidate that asset.
3. **No automatic upscale:** ordinary “生成一张……” returns the generated image with no upscale request/service execution.
4. **Latest-image UX:** after generating an image, “把刚才那张图超分一下发我” resolves the current conversation's recent image and returns a derived image.
5. **Reply precedence:** replying to an older image with “超分” processes that replied asset even when a newer image exists.
6. **2x default:** an unspecified upscale request uses 2x.
7. **4x explicit:** an explicit 4x request uses 4x and remains within resource/output limits.
8. **Realistic mode:** a real photorealistic sample processes successfully with the realistic/general profile.
9. **Anime mode:** a real anime/illustration sample processes successfully with the anime profile.
10. **Manual invocation:** operator/backend can upscale a known `imageId` without a chat session.
11. **Lineage:** the derived asset records its parent, transform, dimensions, and does not overwrite the source.
12. **Stable addressing:** the resulting `imageId` resolves through the configured controlled media/asset address without exposing a host absolute path.
13. **Conversation isolation:** “刚才那张” can never silently select an image from another conversation/user.
14. **Failure behavior:** missing asset, unsupported image, host service unavailable, timeout and limit exceeded all return bounded structured errors; no invented success.
15. **Username independence:** repository code/config examples contain no dependency on a historical personal macOS username; deployment discovers the current environment.
16. **Adapter purity:** WhatsApp/Telegram adapters contain no upscale model policy or phrase routing.
17. **Single Agent:** no new planner/Agent/runtime orchestration layer was introduced.
18. **Regression:** ordinary text, existing image generation, voice/TTS/ASR and current channel reply behavior remain healthy.
19. **Security:** traversal/invalid path tests, image type validation, secrets scan and `git diff --check` pass.
20. **Operational evidence:** host service health, resource limits, approximate 2x latency/memory for one realistic and one anime sample, deployment checkpoint and rollback instructions are recorded.

## Validation minimum

Use the lowest sufficient workflow plus focused tests for the actual implementation. At minimum:

```text
pnpm workflow:plan
git diff --check
pnpm check:secrets
```

Also run:

- focused asset registry/path-security tests;
- focused reply/latest-image resolution tests;
- host upscale service unit/smoke tests;
- real host 2x realistic + anime smokes;
- explicit 4x bounded smoke;
- native generation regression;
- primary owner-channel end-to-end acceptance;
- container restart/recreate durability check where safe under the release procedure.

Do not commit generated binary acceptance images unless the repository has an explicit fixture need; prefer checksums, dimensions, ids and bounded metadata evidence.

## Failure / rollback

The optional capability must fail independently from normal generation.

If the host upscale service is down or incompatible:

- ordinary image generation must continue to work;
- no source image may be deleted or overwritten;
- return a bounded upscale failure rather than falling back to an unrelated cloud editor without approval.

Before production apply, preserve recoverable copies of modified runtime/host service config. Rollback must be able to:

1. disable/remove the upscale Skill/tool exposure;
2. stop/disable the host upscale service;
3. restore previous OpenClaw/plugin/config state;
4. leave existing original image assets intact unless the owner explicitly chooses to remove them.

Asset persistence introduced by this Goal should be backward-safe: disabling upscale must not make normal generated-image delivery depend on the upscale engine.

## Done definition

This Goal is complete only when:

- generated images are durably addressable as host-side assets;
- normal generation does not auto-upscale;
- OpenClaw can upscale a replied or recent current-conversation image on explicit request;
- manual `imageId` invocation works;
- 2x default and explicit 4x work;
- realistic and anime profiles are both proven on the actual Mac;
- originals remain immutable and derived lineage is persisted;
- stable media addressing does not expose arbitrary host filesystem access;
- all machine-specific root/user/port/model paths are configuration discovered from the current environment, not hardcoded personal values;
- host execution uses an Apple-Silicon-appropriate accelerated path proven on the machine;
- channel adapters remain thin and OpenClaw remains the sole Agent;
- security, regression, deployment, rollback and real owner-channel acceptance evidence pass.

Stop after this on-demand asset/upscale path is proven. Do not expand into automatic enhancement, general image editing, local text-to-image, public media hosting, or a new orchestration layer without a separate owner-approved Goal.

## Execution Goal

Use this command for Codex:

```text
/goal Execute docs/AMADEUS_IMAGE_ASSET_AND_ON_DEMAND_UPSCALE_GOAL.md end-to-end as the authoritative active Goal. Start by discovering the actual current macOS host/profile and the pinned OpenClaw image/reply result boundaries; do not assume or hardcode any historical username, host path, IP, domain or port. Persist durable image assets on the macOS host with stable imageId identity, keep native image_generate unchanged, add a host-native Apple-Silicon upscale service plus one OpenClaw Skill/capability for explicit on-demand 2x/4x auto|realistic|anime upscaling, resolve replied image before current-conversation recent image, preserve thin adapters and the single-Agent architecture, perform the required security/regression/real owner-channel acceptance and rollback evidence, and stop without adding automatic upscale or unrelated image-editing features.
```
