# Amadeus Default Image Generation via 9Router — Goal

Date: 2026-09-27
Type: capability integration / runtime configuration
Canonical baseline: Git `main`, Amadeus 1.6.2, OpenClaw image pinned by `infra/docker/casaos/openclaw/Dockerfile`

## Goal

Give the existing OpenClaw Agent a default image-generation capability through the already-running 9Router Text-to-Image endpoint, with `ag/gemini-3.1-flash-image` as the first production image model.

The Agent must be able to understand ordinary natural-language requests such as “画一张……”, call OpenClaw’s native `image_generate` capability on its own, and return the generated image through the existing channel reply path. Do not add keyword routing or a second planner.

This Goal establishes only the default generation path. Multi-model policy, automatic model selection, local image generation, and image-edit routing are follow-up work.

## Current facts

- OpenClaw is the sole Agent runtime.
- Production OpenClaw is pinned from `ghcr.io/openclaw/openclaw:2026.9.4` in the repository Dockerfile.
- `integrations/openclaw/openclaw.json.example` already defines an `openai` provider pointed at `http://9router:20128/v1`, uses the existing `OPENCLAW_9ROUTER_API_KEY`, and opts that provider into private-network requests.
- 9Router Text-to-Image is already configured and a manual generation request has succeeded.
- The confirmed first model id is `ag/gemini-3.1-flash-image`.
- The confirmed generation endpoint is OpenAI-compatible `POST /v1/images/generations` and returns generated image data through the 9Router response contract.
- No new Google/Gemini credential is required inside OpenClaw; OpenClaw should authenticate only to 9Router with the existing key.

## Architecture decision

Use OpenClaw’s bundled native `image_generate` path and bundled OpenAI-compatible image provider first. Do not create an `amadeus_image_generate` tool and do not add a custom image provider unless the pinned OpenClaw build is proven incompatible with 9Router.

Target path:

```text
User
  -> OpenClaw Agent
  -> native image_generate
  -> bundled OpenAI-compatible image generation provider
  -> http://9router:20128/v1/images/generations
  -> ag/gemini-3.1-flash-image
  -> 9Router / Antigravity
  -> generated image attachment
  -> existing WhatsApp / Telegram reply path
```

OpenClaw must not call Google directly and must not contain Antigravity-specific business logic.

## Capability ownership

- Capability name: default image generation.
- User intents: create an image from a natural-language request.
- Non-goals: automatic provider ranking, image editing, poster-specialized routing, local ComfyUI/MLX generation, multi-provider fallback.
- Trusted boundary: existing OpenClaw channel/session authorization and existing 9Router API-key boundary.
- Explicit confirmation: not required for ordinary image generation; preserve all existing channel/tool safety policies.
- Agent/runtime owner: OpenClaw native `image_generate`.
- External service boundary: 9Router Text-to-Image OpenAI-compatible endpoint.
- Provider/model owner for this Goal: 9Router model `ag/gemini-3.1-flash-image`.
- Delivery owner: existing channel reply path; do not add a new sender.
- Secrets: existing `OPENCLAW_9ROUTER_API_KEY` only; no secret may enter Git.

## Model-switching design

Keep model switching configuration-driven and centralized.

For the first implementation:

- declare `ag/gemini-3.1-flash-image` under the existing OpenClaw `openai` provider;
- set the default image model to `openai/ag/gemini-3.1-flash-image`;
- do not duplicate the model id in Skills, SOUL, prompts, channel adapters, or plugin business code.

Future models should be added as additional rows under the same 9Router-backed OpenAI-compatible provider when their `/v1/images/generations` contract is compatible. Production switching should then require changing only the canonical default image-model field in Git and redeploying the OpenClaw config.

Examples of future candidates, not part of this Goal:

```text
openai/ag/gemini-3.1-flash-image
openai/<future-qwen-image-id>
openai/<future-flux-id>
openai/<future-z-image-id>
```

Do not implement automatic “fast/smart/poster/local” routing yet. Do not use prompt keywords to select a model.

## Required implementation

### Phase A — inspect the pinned runtime before changing config

1. Start from clean `main` and read `docs/CURRENT_TASK.md`, this Goal, the current OpenClaw config template, and the pinned OpenClaw Dockerfile.
2. Verify the actual pinned OpenClaw 2026.9.4 runtime contains native `image_generate` and a bundled OpenAI-compatible image-generation provider.
3. Verify the pinned runtime’s exact config field for the default image model. Prefer the repository/runtime schema over current upstream-main documentation if they differ.
4. Verify the existing `openai` provider can use `http://9router:20128/v1` for image generation without introducing a second provider id.
5. Inspect effective tool policy, including sender/group policy, so `image_generate` is not accidentally blocked. Do not broadly weaken unrelated tool restrictions.

If the pinned runtime lacks the expected native image provider or cannot use a custom OpenAI-compatible image base URL, stop and document the compatibility gap. Do not silently expand this Goal into a custom provider implementation.

### Phase B — make the smallest source-of-truth config change

Update the canonical OpenClaw config template so that:

- the existing `openai` provider remains pointed at 9Router;
- `ag/gemini-3.1-flash-image` is declared as an available model for that provider;
- the Agent default image model points at `openai/ag/gemini-3.1-flash-image` using the exact pinned-runtime schema;
- image-generation timeout is explicitly long enough for cloud generation, target 180 seconds unless the pinned schema requires a different field/unit;
- existing chat model `nine_router/arthur-combo`, ASR, TTS, channel behavior, persona, and plugin contracts remain unchanged;
- the existing 9Router key SecretRef/env source is reused;
- no new secret, Google API key, or Antigravity token is added to Git or OpenClaw.

Do not add image workflow instructions to `SOUL.md` or global workspace `AGENTS.md`.

### Phase C — config and route validation

Before deployment:

1. Validate JSON/config syntax and pinned OpenClaw config/schema acceptance.
2. From the OpenClaw container/network context, prove 9Router is reachable at the configured internal URL.
3. Perform a direct authenticated generation smoke against 9Router using `ag/gemini-3.1-flash-image` and confirm a valid image payload is returned.
4. Verify the secret value is absent from logs, diffs, reports, shell history captured into Git, and committed files.
5. Run the minimum affected checks, `git diff --check`, and `pnpm check:secrets`.

The direct 9Router smoke is transport evidence only. It does not replace the OpenClaw Agent acceptance below.

### Phase D — controlled runtime apply

Deployment is a RELEASE-level action and must follow repository rules.

- Do not rebuild OpenClaw unless the source diff actually requires a new image. A config-only change should prefer the existing deployment/config path.
- Preserve a recoverable copy/checkpoint of the current live OpenClaw config before applying.
- Apply only after the normal explicit `--apply` boundary.
- Restart/reload only the minimum OpenClaw component needed for config activation.
- Do not restart 9Router, TTS, OrbStack, or unrelated HomeLab services unless independently required and justified.

### Phase E — native capability acceptance

After apply, verify all of the following:

1. OpenClaw starts healthy with the new configuration.
2. `image_generate` is present in the Agent tool surface/readiness output.
3. The provider/model resolves to `openai/ag/gemini-3.1-flash-image` through 9Router.
4. A typed natural-language request that does not name a tool causes the Agent to choose image generation itself.
5. The generated image returns as a real structured image attachment through at least the primary owner channel, preferably WhatsApp first.
6. The visible response remains concise and does not expose base64, provider credentials, internal URLs, or raw tool payloads.
7. A normal non-image typed request remains ordinary text-only behavior.
8. Existing inbound voice/TTS behavior still works and is not coupled to image generation.

Use a harmless synthetic prompt for acceptance. Do not commit generated binary images unless there is a separate explicit reason; record only content-safe acceptance metadata/checkpoint evidence.

## Tool-policy rule

Do not solve a missing `image_generate` tool by broadly allowing all tools.

If tool policy blocks it:

- identify the exact global, agent, channel, group, sender, or sandbox policy responsible;
- make the narrowest change that permits native image generation for the intended owner/session scope;
- preserve existing deny rules for `tts`, generic `message`, exec/security boundaries, and unrelated sensitive capabilities;
- add a focused regression check proving the intended image tool is available without widening unrelated tools.

## Security and privacy

- Reuse the existing 9Router API key secret source; never write its value into Git.
- Do not add Google credentials to OpenClaw for the Antigravity-backed path.
- Keep the 9Router base URL internal; do not expose it to user-facing output.
- Generated-image base64 is transient transport data and must not be logged in full.
- Do not persist arbitrary user prompts or generated images into Git.
- Keep normal channel authorization and sender-policy behavior intact.

## Failure and rollback

If any of these occur, stop the rollout and restore the previous OpenClaw config:

- OpenClaw config/schema rejection;
- `image_generate` unavailable after a narrow, understood configuration attempt;
- 9Router route/auth failure from the OpenClaw runtime;
- OpenClaw native provider cannot parse the 9Router generation response;
- image completion cannot be delivered through the existing channel attachment path;
- an unrelated tool policy or channel permission is unintentionally widened;
- chat/voice/TTS regression;
- secret or base64 payload appears in committed/logged evidence.

A compatibility failure between pinned OpenClaw and 9Router is a valid outcome. Record it and stop; a custom provider/adapter requires a separate owner-approved Goal.

## Validation minimum

Run the lowest sufficient repository workflow plus focused checks for the actual diff. At minimum:

```text
pnpm workflow:plan
git diff --check
pnpm check:secrets
```

Also run the relevant OpenClaw config/schema validation and any focused integration test added for image-provider configuration/tool availability.

Do not bump `VERSION` merely for planning. If the implementation changes production runtime behavior and the repository release policy requires a release, use the repository’s normal version/release flow rather than editing `VERSION` directly.

## Done definition

This Goal is complete only when:

- the canonical Git configuration declares the 9Router-backed image model;
- the default image model is `openai/ag/gemini-3.1-flash-image` through the existing `openai` -> 9Router provider;
- no direct Google credential/path was introduced;
- native `image_generate` is available without a custom duplicate tool;
- natural-language Agent selection works without keyword routing;
- a real generated image is returned through the existing owner channel;
- ordinary text and existing voice/TTS behavior remain healthy;
- secrets scan and focused validation pass;
- rollback evidence exists for the runtime apply;
- model switching remains centralized in the canonical image-model configuration rather than scattered through prompts or code.

Stop after this default path is proven. Do not implement multi-model automatic routing, local generation, image-edit policy, or fallback in this Goal.

## Execution Goal

Use this exact short command for Codex:

```text
/goal Execute docs/AMADEUS_DEFAULT_IMAGE_GENERATION_GOAL.md end-to-end. Treat it as the authoritative active Goal, implement only the minimal native OpenClaw image_generate path through the existing 9Router-backed openai provider with ag/gemini-3.1-flash-image as the default, perform the required validation and real owner-channel acceptance, preserve rollback/secrets/tool-policy boundaries, and stop without adding multi-model routing or a custom provider unless the Goal explicitly permits it.
```
