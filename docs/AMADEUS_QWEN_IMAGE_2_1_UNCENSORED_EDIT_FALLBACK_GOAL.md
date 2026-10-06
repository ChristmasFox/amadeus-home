# Amadeus Qwen-Image-2.1 Uncensored Edit-First Local Fallback — Goal

Date: 2026-10-06 (Asia/Shanghai)
Baseline: Amadeus 1.9.5 / OpenClaw 2026.9.4 / 9Router 0.5.91
Target host: Mac mini Apple Silicon / 24GB unified memory
Type: local image fallback replacement / reference-image editing priority
Supersedes: `docs/AMADEUS_KREA2_NSFW_LOCAL_FALLBACK_GOAL.md`

## Goal

Replace the paused Krea2 local fallback with **Qwen-Image-2.1 Uncensored Q4_K_M**, with **single-reference image editing as the P0 capability**.

The primary user workflow is not prompt-only text-to-image. The required production behavior is:

```text
WhatsApp reply/reference image + edit instruction
        |
        v
OpenClaw image_generate
        |
        v
openai/amadeus-image
        |
        +-- primary: cx/gpt-image-2.5
        |
        +-- eligible primary failure
                |
                v
Qwen-Image-2.1 Uncensored local edit fallback
                |
                v
existing generated attachment
        -> Asset Registry
        -> native task_completion
        -> Completion Agent
        -> exactly one WhatsApp image bubble with natural Kurisu caption
```

Prompt-only generation must also work, but it is P1 after reference editing.

Do not deploy a local fallback that can only generate from text.

## Current live facts

Start from the actual post-Krea rollback state, not the old 1.8.4 assumptions:

- current live release is **Amadeus 1.9.5**;
- the Krea2 candidate was paused after a real local fallback exceeded the 600-second image deadline;
- production OpenClaw/9Router were restored to the pre-candidate runtime;
- local Krea bridge is stopped;
- `infra/9router/model-capabilities.json` intentionally contains only `cx/gpt-image-2.5`;
- 9Router remains the primary image transport only;
- **OpenClaw's source-managed OpenAI provider boundary owns the local fallback**;
- current image-specific timeout is 600000 ms;
- current reference contract admits exactly one PNG/JPEG/WebP reference up to 10 MiB;
- current Krea local fallback is explicitly blocked whenever `req.inputImages.length > 0`.

The Krea candidate checkpoint is historical evidence:

```text
.agent/checkpoints/2026-10-06-amadeus-krea2-local-fallback-candidate.md
```

Do not restore the Krea candidate architecture as an active runtime.

## Architecture decision

Keep the architecture learned from the Krea candidate:

```text
9Router
  = one primary image transport only
  = cx/gpt-image-2.5

OpenClaw provider boundary
  = owns bounded local fallback
```

Do **not** put the local Qwen model into the 9Router Combo.

The intended 9Router desired state remains:

```json
{
  "image": {
    "name": "amadeus-image",
    "kind": "image",
    "strategy": "fallback",
    "models": ["cx/gpt-image-2.5"]
  }
}
```

The local fallback is triggered only after an eligible primary transport failure in the existing OpenClaw image-provider overlay.

This avoids reintroducing the earlier unowned 9Router custom-provider path.

## Selected model

Use the user's selected uncensored conversion:

```text
Repository:
abenzerps/Qwen-Image-2.1-Uncensored-GGUF

Diffusion:
qwen-image-2.1-UC-Q4_K_M.gguf
approximately 4.60 GB
```

Q4_K_M is the required first candidate. Do not silently substitute Krea2, base Qwen-Image-2.1, Qwen-Image-Edit 2511, MLX, Q4_0, or another quantization.

Required companion assets for the stable-diffusion.cpp GGUF edit path:

```text
Text encoder:
Qwen3-VL-8B-Instruct-Q4_K_M.gguf

Vision projection:
mmproj-Qwen3VL-8B-Instruct-F16.gguf
(or the exact equivalent filename verified from the pinned Qwen3-VL-8B GGUF revision)

VAE:
qwen_image_2.1_vae_bf16.safetensors
```

The Qwen-Image-2.1 VAE is model-specific. Do not reuse the earlier Qwen Image or Wan VAE.

Pin repository revisions, exact filenames, SHA-256 values and byte sizes before production apply.

Model files, mmproj, VAE, generated media and reference images remain outside Git.

## Phase 0 — re-audit current source and runtime

Before edits:

1. read `docs/CONTEXT.md`, `docs/CURRENT_TASK.md` and this Goal;
2. run `git status --short --branch` and `git log -5 --oneline --decorate`;
3. confirm live `VERSION=1.9.5` unless main advanced after this Goal;
4. confirm current production containers match the paused-Krea rollback checkpoint;
5. verify Krea LaunchAgent/bridge is stopped;
6. verify 9Router desired/live image chain is primary-only `cx/gpt-image-2.5`;
7. verify current OpenClaw image timeout is 600000 ms;
8. inspect the exact current `image-route-authority.mjs` Krea fallback overlay;
9. record Mac memory pressure, swap, Qwen3-TTS health and free disk space.

No production mutation during Phase 0.

## Phase 1 — prove the uncensored checkpoint can actually edit

This is the hard gate for the entire Goal.

Pin a stable-diffusion.cpp commit that explicitly supports:

- Qwen-Image-2.1;
- GGUF diffusion;
- Qwen3-VL-8B GGUF;
- `--llm_vision`;
- OpenAI-compatible `/v1/images/edits`;
- Metal backend.

The existing Krea sd.cpp build may be reused only if its exact commit passes all of those capability checks. Do not rebuild merely for naming, but do not assume compatibility.

Run direct local CLI/API smokes with the **uncensored Q4_K_M checkpoint itself**.

Required direct tests:

### Test A — text-to-image

One ordinary benign 768/896/1024-class prompt.

### Test B — single-reference semantic edit

Use one ordinary reference image and a deterministic edit request such as:

```text
change one clothing color while preserving the person, pose, composition and background
```

The output must visibly depend on the input image.

### Test C — identity/composition preservation

Use one portrait/reference and request a localized edit.

Human/operator acceptance must verify that the result is an edit of the reference, not a prompt-only regeneration.

### Test D — text/local-detail edit

Use a benign image with a simple visible detail and request a local change.

Do not store user/private reference images or generated test media in Git.

If the uncensored Q4_K_M checkpoint cannot reliably perform reference editing with the official Qwen-Image-2.1 runtime contract, **stop the Goal**. Do not silently replace it with the base model.

## Phase 2 — 24GB memory and latency gate

The Krea candidate already proved that a model being loadable is not enough.

Benchmark the actual Qwen edit path on the real 24GB Mac mini under normal HomeLab load.

Start with:

```text
concurrency = 1
one queued request maximum
reference images = exactly 1
steps = 16 initially, then compare 12 / 16 / 20 only if useful
long edge = 768 or 896 for first performance gate
```

Then test 1024-class only if memory and latency are acceptable.

Record bounded evidence only:

- cold model load time;
- warm edit time;
- warm text-to-image time;
- peak process RSS;
- memory pressure;
- swap before/after;
- input/output dimensions;
- success/failure.

Do not log prompts or image bytes.

### Latency policy

Do not assume 600 seconds is sufficient merely because it was the previous value.

Candidate validation may use up to **900 seconds** for one local edit while measuring the true runtime.

Set the final production image deadline from evidence:

```text
production deadline >= measured worst successful cold edit + 120 seconds margin
minimum = 600 seconds
initial maximum without another explicit design review = 1200 seconds
```

Do not change ordinary text, TTS, ASR or caption deadlines.

Verify the detached image task is not killed by an unrelated 300-second Agent deadline before changing any global timeout.

## Phase 3 — replace Krea service with Qwen service

Retire active Krea-specific service code and create a single Qwen local service boundary.

Target source layout:

```text
apps/qwen-image-service/bridge.py
apps/qwen-image-service/test_bridge.py

infra/macos/qwen-image-engine.json
infra/macos/manage-qwen-image.sh
infra/macos/com.amadeus.qwen-image.plist.example
```

The service must remain:

- loopback-only on macOS;
- bearer-authenticated;
- one active generation;
- one bounded waiter maximum;
- lazy-load / bounded idle shutdown if required by memory;
- prompt/media silent in logs;
- model/hash verified before startup;
- dry-run by default;
- mutations require explicit `--apply`.

Do not run Krea and Qwen diffusion services concurrently.

The old Krea source-managed service, plist, engine config and deployment env plumbing should be removed from the **active code path** once Qwen passes candidate acceptance. Historical Git commits/checkpoints remain the record.

External Krea model files are not deleted automatically by this Goal.

## Phase 4 — Qwen server startup contract

The native `sd-server` startup must include the verified assets, equivalent to:

```text
--diffusion-model qwen-image-2.1-UC-Q4_K_M.gguf
--llm Qwen3-VL-8B-Instruct-Q4_K_M.gguf
--llm_vision <verified Qwen3-VL-8B mmproj>
--vae qwen_image_2.1_vae_bf16.safetensors
--backend MTL0
--diffusion-fa
```

Choose steps/CFG from the direct benchmark rather than copying the Krea Turbo values.

Never carry forward Krea's `steps=8` / `cfg=0` merely because those values already exist in service code.

## Phase 5 — bridge API: generation and edits are both first-class

The protected bridge must expose:

```text
GET  /health
GET  /v1/models
POST /v1/images/generations
POST /v1/images/edits
```

### Text generation

`/v1/images/generations` remains bounded JSON and returns `data[].b64_json`.

### Reference edit

`/v1/images/edits` is mandatory, not optional.

The preferred implementation is:

```text
OpenClaw
  -> authenticated multipart /v1/images/edits
  -> local bridge
  -> bounded pass-through multipart
  -> sd-server /v1/images/edits
```

The bridge may validate:

- bearer token;
- content type;
- total body size;
- one-image limit;
- timeout;
- output byte limit.

Do not transform the edit into prompt-only generation.

Do not silently discard the image.

Do not proxy arbitrary endpoints.

## Phase 6 — preserve reference bytes at the OpenClaw boundary

Current `buildAmadeusReferenceImagePayload()` already validates:

- exactly one reference;
- PNG/JPEG/WebP;
- MIME matches magic bytes;
- maximum 10 MiB.

Reuse those trusted bytes for the local fallback.

Replace the Krea rule:

```text
(req.inputImages ?? []).length === 0
```

with a Qwen route that supports both:

```text
0 references -> local /images/generations
1 reference  -> local /images/edits
>1 reference -> existing fail-closed admission boundary
```

For the edit fallback, construct multipart directly from the already-validated `req.inputImages[0].buffer` and MIME type.

The model must never provide the file path or reference identity.

## Phase 7 — edit geometry policy

Do not carry forward the Krea fallback's hard default of `768x1024` for reference edits.

For local Qwen edits:

1. preserve the reference aspect ratio by default;
2. if no explicit local size is required, let sd-server derive dimensions from the first reference where safe;
3. otherwise scale to the validated local pixel budget while preserving aspect ratio;
4. use dimensions divisible by 32;
5. do not crop or stretch a reference merely to match a portrait default.

For prompt-only fallback, use the benchmark-selected default size.

## Phase 8 — fallback classifier and safety behavior

Preserve the current bounded fallback eligibility policy.

Eligible primary failures include operational failures such as:

- 429;
- upstream 5xx;
- timeout;
- network/fetch failure;
- connection reset/refused.

Provider safety/policy refusals and invalid-request 400s remain terminal and **must not trigger the local fallback**.

Do not reinterpret a provider policy refusal as an excuse to reroute to the uncensored model.

The selected local checkpoint may support adult generation, but application safety boundaries remain unchanged.

## Phase 9 — replace Krea provider overlay cleanly

In `integrations/openclaw/delivery-boundary/image-route-authority.mjs`:

- remove Krea model constants/functions;
- add Qwen local fallback equivalents;
- keep one local fallback attempt only;
- keep terminal marking so a failed local fallback cannot start duplicate image tasks;
- report the actual local model in result attribution;
- preserve route-authority guards;
- preserve one native task and one final media primitive.

Prefer direct replacement over a compatibility layer.

No `requestAmadeusKrea2Fallback`, `AMADEUS_KREA2_IMAGE_*` or Krea model ID should remain in active provider code after the switch.

## Phase 10 — deployment secret/env switch

Replace active Krea-specific deployment plumbing with Qwen-specific plumbing:

```text
AMADEUS_QWEN_IMAGE_BASE_URL
AMADEUS_QWEN_IMAGE_TOKEN_FILE
OPENCLAW_QWEN_IMAGE_TOKEN_HOST_FILE
```

Use protected 0600 token handling exactly as the Krea candidate already proved necessary for the Node runtime.

Do not reuse the Krea token under a misleading new name.

Create a new Qwen token outside Git.

After Qwen acceptance, remove Krea env injection and Krea secret mount from the active Compose template/deploy script.

## Phase 11 — 9Router stays primary-only

Do not add Qwen to `infra/9router/model-capabilities.json`.

Keep:

```text
models:
  - cx/gpt-image-2.5
```

Update tests/documentation to state:

```text
9Router owns primary transport.
OpenClaw owns the local Qwen fallback.
```

Gemini image generation must remain absent.

## Phase 12 — focused tests

Add/replace focused tests proving the exact user workflow.

### Test 1 — primary text generation succeeds

Assert local Qwen is not called.

### Test 2 — primary text generation fails operationally

Assert local Qwen `/images/generations` is called exactly once.

### Test 3 — primary reference edit succeeds

Assert local Qwen is not called and the original reference reaches the existing primary edit contract.

### Test 4 — primary reference edit fails operationally

This is P0.

Assert:

- local fallback is entered;
- endpoint is `/images/edits`;
- exactly one reference image is present;
- bytes equal the original validated reference bytes;
- MIME is preserved;
- prompt is preserved;
- result returns as one image.

### Test 5 — local edit result enters Asset Registry

Assert the edited result follows the same generated-attachment claim/import path.

### Test 6 — one image + one caption

Assert:

- one image primitive;
- no duplicate completion text;
- natural Completion Agent caption remains inline;
- native task completion remains terminal.

### Test 7 — follow-up state

After fallback edit success, the next user turn must see the previous image task as completed.

### Test 8 — local edit timeout

Assert one bounded terminal failure and no duplicate background generation.

### Test 9 — safety refusal

A primary policy/safety refusal must not call the local uncensored fallback.

### Test 10 — invalid reference

Wrong MIME, >10 MiB or >1 reference remains rejected before local inference.

### Test 11 — upscale regression

A Qwen-edited result remains the latest registered image and is usable by `amadeus_image_upscale`.

### Test 12 — voice/text regressions

Existing text, TTS, ASR, WhatsApp voice and delivery tests remain green.

## Phase 13 — real candidate rollout

Required order:

```text
1. read-only live audit
2. pin/download/hash Qwen assets
3. direct text-to-image smoke
4. direct single-reference edit smoke
5. edit fidelity human check
6. 24GB memory/latency benchmark
7. install Qwen bridge candidate
8. host bridge health
9. OpenClaw-container -> Qwen bridge smoke
10. focused synthetic fallback tests
11. protected OpenClaw checkpoint
12. deploy candidate OpenClaw overlay/env/secret
13. keep 9Router primary-only
14. real forced text fallback acceptance
15. real forced reference-edit fallback acceptance
16. normal healthy-primary reference edit acceptance
17. release gates and version bump
```

The candidate must not be version-bumped before real reference-edit fallback acceptance.

## Phase 14 — mandatory real WhatsApp acceptance

A real forced **reference edit** is required.

Use an ordinary safe reference image and a simple visible edit request.

Prove bounded runtime evidence equivalent to:

```text
primary_model = cx/gpt-image-2.5
primary_result = eligible operational failure
local_model = qwen-image-2.1-UC-Q4_K_M
local_mode = edit
reference_count = 1
local_result = success
asset_claim = success
completion_caption = success
image_primitives = 1
duplicate_text = 0
```

The WhatsApp result must visibly be an edit of the supplied reference.

A prompt-only local generation does **not** satisfy this acceptance.

Then verify a healthy primary reference edit still stays on GPT Image and does not unnecessarily call Qwen.

## Phase 15 — Krea retirement

Only after the Qwen candidate passes:

- stop/uninstall the Krea LaunchAgent if any definition remains;
- remove Krea active Compose/env/token plumbing;
- remove active Krea service source and tests that are no longer used;
- preserve Krea historical checkpoint documents;
- preserve external Krea model files by default for rollback/diagnosis.

Do not delete external model assets unless explicitly requested later.

## Validation

Use repository workflow rules and the lowest sufficient validation during development.

Before candidate apply:

```sh
pnpm test:amadeus
pnpm typecheck:amadeus
pnpm build:amadeus
pnpm test:openclaw-image-route-authority
node scripts/test-delivery-boundary.mjs
python3 scripts/verify-9router-image-reference.py --machine nyannyan
python3 scripts/verify-9router-image-fallback.py --machine nyannyan
python3 scripts/test-provision-9router-image-combo.py
pnpm check:secrets
git diff --check
```

Add the new Qwen bridge/service tests and exact pinned OpenClaw provider fixtures.

Production writes continue to require explicit `--apply`.

## Rollback

Create a protected checkpoint before every candidate runtime switch.

Rollback target is the current stable primary-only runtime:

```text
9Router -> cx/gpt-image-2.5 only
OpenClaw -> no active local fallback
Qwen bridge -> stopped
```

Rollback must not touch:

- TTS/ASR;
- Product Radar;
- PUBG;
- Asset Registry;
- image upscale;
- chat model routing;
- unrelated provider credentials.

Keep downloaded Qwen model assets after rollback unless an explicit cleanup is requested.

## Done definition

This Goal is complete only when all are true:

- `qwen-image-2.1-UC-Q4_K_M.gguf` is pinned and hash verified;
- Qwen3-VL-8B Q4_K_M + mmproj + Qwen-Image-2.1 VAE are pinned and verified;
- direct uncensored-checkpoint **single-reference editing** passes;
- 24GB memory pressure and swap remain acceptable;
- real local edit completes inside the evidence-derived production deadline;
- local generation concurrency is one;
- 9Router remains primary-only `cx/gpt-image-2.5`;
- OpenClaw owns exactly one local Qwen fallback attempt;
- prompt-only fallback works;
- reference-image fallback works through `/v1/images/edits`;
- reference bytes/MIME are preserved exactly;
- no reference image is silently dropped;
- Gemini image is absent;
- Krea is absent from active runtime/source plumbing;
- one edited image enters Asset Registry;
- one WhatsApp image with natural Kurisu caption is delivered;
- no duplicate completion bubble appears;
- follow-up session state is terminal/completed;
- upscale/text/voice/TTS/ASR regressions pass;
- a real forced-primary-failure WhatsApp **reference edit** has passed.

## Codex execution command

```text
/goal Execute docs/AMADEUS_QWEN_IMAGE_2_1_UNCENSORED_EDIT_FALLBACK_GOAL.md end-to-end. Treat it as authoritative and start from the current Amadeus 1.9.5 post-Krea rollback state. Replace the paused Krea2 local fallback with abenzerps/Qwen-Image-2.1-Uncensored-GGUF using qwen-image-2.1-UC-Q4_K_M.gguf on the 24GB Mac mini through a pinned stable-diffusion.cpp Metal runtime. Reference-image editing is P0: use Qwen3-VL-8B-Instruct-Q4_K_M plus the verified mmproj/--llm_vision asset and qwen_image_2.1_vae_bf16.safetensors, prove the uncensored checkpoint itself can edit a single reference before any production switch, and route an eligible failed primary reference request to the protected local /v1/images/edits endpoint without dropping or regenerating from prompt alone. Keep 9Router primary-only cx/gpt-image-2.5; OpenClaw remains the sole owner of one bounded local fallback attempt. Preserve route authority, Asset Registry, native task_completion, Completion Agent caption, exactly-one-image delivery, follow-up completion state, upscale, text, voice, TTS and ASR. Keep safety/policy refusals terminal and never reroute them to the uncensored fallback. Benchmark real 24GB cold/warm edit latency and memory before choosing the final image-specific deadline; candidate testing may use 900 seconds, production must include measured margin and must not change unrelated timeouts. Remove active Krea service/env/token/source plumbing only after Qwen real acceptance passes. Do not declare completion until a real forced-primary-failure WhatsApp single-reference edit visibly preserves the reference and returns exactly one edited image with the normal Kurisu caption.
```
