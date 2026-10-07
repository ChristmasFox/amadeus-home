# Amadeus Qwen-Image-2.1 Fun-Acc 4-Step Acceleration — Goal

Date: 2026-10-07 (Asia/Shanghai)
Baseline: Amadeus 1.9.6 / OpenClaw 2026.9.4 / 9Router 0.5.95
Target host: Mac mini Apple Silicon / 24GB unified memory
Type: local image inference optimization
Previous Goal: `docs/AMADEUS_QWEN_IMAGE_2_1_UNCENSORED_EDIT_FALLBACK_GOAL.md`

## Goal

Accelerate the already deployed local Qwen-Image-2.1 Uncensored fallback without changing the working routing and delivery architecture.

Target stack:

```text
Qwen-Image-2.1 Uncensored Q4_K_M GGUF
+ stable-diffusion.cpp Metal
+ Fun-Acc / PDD 4-step
+ correct 4-step sigma schedule
+ CFG approximately 1
+ Flash Attention
+ Qwen-Image-2.1 prefix cache
+ mmap
+ Qwen3-VL-8B Q4_K_M
+ Qwen3-VL mmproj for reference editing
```

Production resolution target is **1024-class only**.

Do not test or enable native 2K in this Goal.

The operator will perform detailed real-world quality and speed evaluation after deployment. This Goal only needs bounded technical smoke evidence that the accelerated path works.

## Current baseline

Current deployed local engine:

```text
diffusion:
  abenzerps/Qwen-Image-2.1-Uncensored-GGUF
  qwen-image-2.1-UC-Q4_K_M.gguf

text encoder:
  Qwen3-VL-8B-Instruct-Q4_K_M.gguf

vision:
  mmproj-Qwen3VL-8B-Instruct-F16.gguf

VAE:
  qwen_image_2.1_vae_bf16.safetensors

runtime:
  stable-diffusion.cpp
  Metal / MTL0
  steps = 16
  cfg = 6
  edit strength = 0.9
  concurrency = 1
  idle shutdown = 180 s
```

Historical measurements are informative only; this Goal does not require a new benchmark suite.

## Non-negotiable invariants

Preserve the existing production architecture:

- `cx/gpt-image-2.5` remains the healthy primary image backend;
- 9Router remains primary-only for image routing;
- OpenClaw owns exactly one local Qwen fallback attempt;
- zero references -> local `/v1/images/generations`;
- one trusted reference -> local `/v1/images/edits`;
- reference bytes and MIME remain preserved;
- single-reference image editing remains supported;
- Qwen3-VL mmproj remains present for editing;
- edit strength remains 0.9 unless required by the Fun-Acc implementation itself;
- Asset Registry remains unchanged;
- native `task_completion` remains unchanged;
- Completion Agent remains unchanged;
- exactly one WhatsApp image primitive is delivered;
- no duplicate completion text;
- existing image upscale remains separate/on-demand;
- safety/policy refusals remain terminal and do not become local fallback triggers;
- text, voice, TTS, ASR, PUBG and Product Radar are out of scope.

Do not add keyword routing, a second Agent or an LLM-authored provider route.

## Phase 0 — read-only audit

Before writes:

1. read `docs/CONTEXT.md`, `docs/CURRENT_TASK.md` and this Goal;
2. run `git status --short --branch` and `git log -5 --oneline --decorate`;
3. verify live Amadeus/OpenClaw version;
4. verify 9Router image route remains only `cx/gpt-image-2.5`;
5. verify the current Qwen bridge/service is healthy;
6. verify the current pinned Qwen assets and sd.cpp binary;
7. verify the existing 16-step local edit path is still available as rollback.

No production mutation in Phase 0.

## Phase 1 — Fun-Acc/PDD correctness gate

Use the official Fun-Acc source as the semantic reference:

```text
alibaba-pai/Qwen-Image-2.1-Fun-Acc-LoRAs
Qwen-Image-2.1-Fun-Acc-4Step.safetensors
4 NFE
```

The deployment must implement actual Fun-Acc/PDD semantics.

Do **not** implement this Goal by only changing:

```text
steps = 16
```

to:

```text
steps = 4
```

Required:

- correct Fun-Acc adapter semantics;
- correct 4-step sigma schedule;
- correct CFG/true-CFG behavior for the adapter;
- reproducible pinned source/revision;
- external adapter/conversion artifact hash if conversion is needed.

If the pinned sd.cpp cannot directly express the official PDD adapter, a reproducible sd.cpp-compatible conversion is allowed.

Pin:

- source adapter revision;
- converter revision if used;
- resulting artifact SHA-256;
- resulting artifact byte size.

Model/adapter assets remain outside Git.

## Phase 2 — stable-diffusion.cpp candidate

Reuse the current sd.cpp binary if it already supports everything required.

Upgrade only if necessary.

The selected build must support:

- Qwen-Image-2.1 GGUF diffusion;
- Qwen3-VL-8B GGUF;
- `--llm_vision`;
- Metal;
- OpenAI-compatible generation;
- OpenAI-compatible edits;
- custom sigma schedule;
- Qwen-Image-2.1 prefix cache;
- Flash Attention;
- mmap.

If rebuilt, pin:

- sd.cpp commit;
- build command;
- binary SHA-256;
- binary byte size.

Do not overwrite the accepted binary before the candidate smoke passes.

## Phase 3 — production inference profile

Target profile:

```text
resolution: 1024-class only
sampling: Fun-Acc/PDD 4-step
CFG: adapter-recommended value, expected near 1
diffusion: qwen-image-2.1-UC-Q4_K_M.gguf
backend: Metal
reference editing: Qwen3-VL-8B Q4_K_M + mmproj
edit strength: 0.9 unless incompatible with the verified Fun-Acc edit contract
concurrency: 1
```

Use dimensions divisible by 32.

For prompt-only generation:

```text
1024x1024
```

For reference edits:

- preserve the source aspect ratio;
- scale to a 1024-class canvas;
- do not exceed the current 1024-class policy;
- do not stretch/crop merely to force square output.

No 2K generation, testing or production mode in this Goal.

## Phase 4 — acceleration switches

Enable only settings supported by the selected pinned sd.cpp build.

### Flash Attention

Prefer the upstream-recommended Qwen-Image-2.1 setting.

Verify from runtime logs that Flash Attention is actually active.

Do not run a full performance matrix.

### Prefix cache

Use Qwen-Image-2.1 prefix cache.

Start with:

```text
qwen_image_2_1_prefix_cache_type=q8_0
```

If Q8_0 fails to initialize or causes an obvious runtime error, fall back to `auto`.

No extensive auto/f16/q8 benchmark is required.

### mmap

Enable mmap if supported by the pinned build.

If mmap causes startup/runtime failure, disable it and continue.

### Warm residency

Change:

```text
idleShutdownSeconds = 180
```

to:

```text
idleShutdownSeconds = 900
```

Keep concurrency at one.

Do not make the model permanently resident.

## Phase 5 — source-managed config

Update `infra/macos/qwen-image-engine.json` and bridge/service validation with explicit acceleration fields.

Expected shape may include:

```json
{
  "samplingProfile": "fun-acc-4step",
  "steps": 4,
  "cfgScale": 1.0,
  "customSigmas": [],
  "funAcc": {
    "enabled": true,
    "repository": "...",
    "revision": "...",
    "path": "...",
    "sha256": "...",
    "bytes": 0
  },
  "prefixCacheType": "q8_0",
  "mmap": true,
  "idleShutdownSeconds": 900,
  "defaultGenerationSize": "1024x1024"
}
```

Use the exact schema required by the implementation.

Requirements:

- fail-closed config validation;
- external asset hash verification;
- no secrets/prompts/media in Git;
- one active generation;
- one bounded waiter;
- current 16-step source/config remains recoverable by Git/checkpoint.

## Phase 6 — minimal technical smoke only

Do not perform a large A/B benchmark or detailed visual scoring.

Required candidate smoke:

### Smoke A — service

Prove:

- Qwen bridge starts;
- sd-server starts;
- model loads;
- authenticated `/v1/models` succeeds;
- health reports ready.

### Smoke B — 1024 text-to-image

Run one safe 1024x1024 prompt.

Pass if:

- request returns HTTP 200;
- exactly one valid image is returned;
- output dimensions are 1024x1024 or the exact configured 1024-class size;
- no runtime crash/OOM occurs.

No subjective quality acceptance is required.

### Smoke C — one reference edit

Run one safe reference edit.

Pass if:

- `/v1/images/edits` returns HTTP 200;
- exactly one output image is returned;
- the reference-image code path is exercised;
- no runtime crash/OOM occurs;
- output remains in the configured 1024-class envelope.

Only a basic visual sanity check is needed: the result must not be blank/corrupt and should visibly depend on the reference.

No detailed identity/quality scoring is required.

### Smoke D — OpenClaw/container reachability

From the OpenClaw container prove:

- authenticated Qwen model discovery works;
- one bounded request can reach the local bridge.

Do not run a full benchmark matrix.

## Phase 7 — deploy

After the candidate smokes pass:

1. create a protected external checkpoint of the accepted 16-step Qwen service/runtime;
2. apply the new source-managed Qwen config/service;
3. restart the Qwen LaunchAgent/service;
4. verify health;
5. verify OpenClaw container can reach the bridge;
6. keep `AMADEUS_QWEN_IMAGE_LOCAL_ONLY=0`;
7. do not change 9Router image model order;
8. do not change GPT Image primary routing;
9. do not change unrelated OpenClaw services.

Runtime writes require explicit `--apply`.

## Phase 8 — minimal post-deploy check

After deployment only verify:

- Qwen bridge is healthy;
- accelerated model loads successfully;
- one 1024 text generation works;
- one single-reference edit works;
- OpenClaw/Qwen connectivity is healthy;
- OpenClaw/WhatsApp normal service health remains green.

Detailed speed, image quality, identity preservation, editing fidelity and repeated WhatsApp usage will be tested manually by the operator after deployment.

Do **not** block deployment waiting for:

- multi-prompt benchmark suites;
- formal 16-step vs 4-step A/B;
- <=180 second performance target;
- <=120 second stretch target;
- 2K testing;
- repeated WhatsApp acceptance runs;
- detailed human quality scoring.

## Phase 9 — timeout policy

Keep the existing image-specific 600-second timeout for this deployment unless the accelerated runtime demonstrably exceeds it during the minimal smoke.

Do not lower the timeout simply because 4-step is expected to be faster.

Do not modify ordinary Agent, text, caption, TTS or ASR deadlines.

## Phase 10 — rollback

Rollback must restore the accepted pre-acceleration Qwen service:

```text
16 steps
CFG 6
previous sd.cpp binary
previous engine config
previous adapter state
```

The protected checkpoint must be sufficient to restore the local Qwen service without touching:

- 9Router;
- GPT Image;
- OpenClaw sessions;
- Asset Registry;
- TTS/ASR;
- image upscale;
- other HomeLab services.

Keep Fun-Acc assets after rollback unless explicitly cleaned later.

## Validation

Use only the minimum source validation needed for the changed files.

At minimum:

```sh
pnpm workflow:plan
python3 -m unittest apps/qwen-image-service/test_bridge.py
pnpm test:openclaw-image-route-authority
pnpm check:secrets
git diff --check
```

Run additional Amadeus build/typecheck only if source changes touch the plugin/OpenClaw build boundary.

Do not run unrelated full repository test suites without a concrete reason.

## Done definition

Complete when:

- Qwen-Image-2.1 Uncensored Q4_K_M remains the local diffusion model;
- stable-diffusion.cpp Metal remains the runtime;
- real Fun-Acc/PDD 4-step semantics are implemented;
- the correct sigma schedule is used;
- Qwen3-VL-8B Q4_K_M + mmproj remain enabled for editing;
- 1024-class is the only production image size target in this Goal;
- Flash Attention is enabled and initializes successfully;
- prefix cache initializes successfully, preferably q8_0;
- mmap is enabled if stable;
- idle shutdown is 900 seconds;
- one 1024 text generation smoke passes;
- one single-reference edit smoke passes;
- bridge/OpenClaw connectivity is healthy;
- 9Router/GPT primary route is unchanged;
- rollback checkpoint exists;
- the accelerated local service is deployed.

The operator will perform detailed image-quality and real-world speed testing after deployment.

## Codex execution command

```text
/goal Execute docs/AMADEUS_QWEN_IMAGE_2_1_FUNACC_4STEP_ACCELERATION_GOAL.md end-to-end. Treat it as authoritative. Start from the working Amadeus 1.9.6 Qwen-Image-2.1 Uncensored fallback and preserve all routing, Asset Registry, completion, caption and WhatsApp delivery behavior. Optimize only the local Qwen inference layer. Keep qwen-image-2.1-UC-Q4_K_M.gguf, Qwen3-VL-8B Q4_K_M, mmproj and the Qwen-Image-2.1 VAE. Implement a real Alibaba PAI Fun-Acc/PDD 4-step path with the correct adapter semantics and custom sigma schedule; do not fake it by only setting steps=4. Use Metal, enable the supported Flash Attention path, use Qwen-Image-2.1 prefix cache with q8_0 first and auto only if q8_0 is not viable, enable mmap if stable, keep edit strength 0.9 unless the verified Fun-Acc edit contract requires otherwise, and change idle shutdown from 180s to 900s. Production image resolution for this Goal is 1024-class only: use 1024x1024 for prompt-only generation and preserve reference aspect ratio within a 1024-class envelope for edits. Do not test or enable 2K. Keep 9Router primary-only cx/gpt-image-2.5 and leave safety/policy refusals terminal. Testing should be minimal: prove the service/model starts, one 1024 text generation returns one valid image, one reference edit returns one valid reference-dependent image, and OpenClaw can reach the protected bridge without OOM/crash. Do not run a formal benchmark or detailed visual A/B; the operator will test quality and speed after deployment. Create a protected rollback checkpoint, apply the optimized Qwen service, verify health, and leave the existing 600-second image timeout unless the smoke requires more. Runtime writes require explicit --apply.
```
