# Amadeus Qwen-Image-2.1 Fun-Acc 4-Step Acceleration — Goal

Date: 2026-10-07 (Asia/Shanghai)
Baseline: Amadeus 1.9.6 / OpenClaw 2026.9.4 / 9Router 0.5.95
Target host: Mac mini Apple Silicon / 24GB unified memory
Type: local image inference optimization
Previous Goal: `docs/AMADEUS_QWEN_IMAGE_2_1_UNCENSORED_EDIT_FALLBACK_GOAL.md`

## Goal

Accelerate the already deployed local Qwen-Image-2.1 Uncensored fallback without changing the successful image-routing, reference-edit, Asset Registry, completion, caption, or WhatsApp delivery architecture.

Target local inference stack:

```text
Qwen-Image-2.1 Uncensored Q4_K_M GGUF
+ stable-diffusion.cpp Metal
+ Fun-Acc / PDD 4-step acceleration
+ correct 4-step sigma schedule
+ CFG approximately 1
+ Flash Attention
+ Qwen-Image-2.1 prefix KV cache
+ Q8_0 prefix-cache candidate
+ mmap candidate
+ Qwen3-VL-8B Q4_K_M
+ Qwen3-VL mmproj for reference editing
```

Primary product requirement remains **single-reference image editing**.

The optimization is successful only if it materially reduces real local edit latency while preserving acceptable edit fidelity, identity/composition preservation, the existing uncensored checkpoint behavior, and the current GPT-primary -> local-Qwen-fallback route.

## Current production baseline

The current source-managed local engine is:

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
  local generation concurrency = 1
  idle shutdown = 180 s
```

Existing measured baseline from the accepted candidate work:

```text
cold edit       447.64 s
warm edit       310.93 s
warm edit       338.26 s
warm T2I        253.28 s
peak RSS        ~13.4 GiB
minimum free    ~11%
swap peak       ~27.8 / 28.7 GiB
```

These numbers are the comparison baseline. Do not claim acceleration without same-machine A/B evidence.

## Non-negotiable invariants

Do not redesign the working image lifecycle.

Preserve:

- `cx/gpt-image-2.5` as the healthy primary image backend;
- 9Router image desired state remains primary-only;
- OpenClaw remains the sole owner of one bounded local Qwen fallback attempt;
- zero references -> local `/v1/images/generations`;
- exactly one trusted reference -> local `/v1/images/edits`;
- reference bytes and MIME are preserved;
- edit strength remains 0.9 unless a dedicated quality benchmark proves a replacement;
- Asset Registry behavior remains unchanged;
- native `task_completion` remains unchanged;
- Completion Agent still writes the natural Kurisu caption;
- exactly one WhatsApp image primitive is delivered;
- no duplicate completion text;
- existing image upscale remains a separate on-demand capability;
- safety/policy refusals remain terminal and are not converted into local fallback triggers;
- text, voice, TTS, ASR, PUBG and Product Radar are out of scope.

Do not introduce keyword routing, a second Agent, or model selection authored by the LLM.

## Architecture decision

This is an **inference-engine optimization**, not a routing migration.

Keep:

```text
OpenClaw
  -> openai/amadeus-image
     -> 9Router / cx/gpt-image-2.5
     -> eligible operational failure only
        -> local Qwen bridge
           -> stable-diffusion.cpp
```

Only the last local inference layer may change.

## Phase 0 — read-only capability audit

Before any runtime mutation:

1. read `docs/CONTEXT.md`, `docs/CURRENT_TASK.md`, this Goal, and the previous Qwen fallback Goal;
2. run `git status --short --branch` and `git log -5 --oneline --decorate`;
3. verify current live release and immutable OpenClaw image;
4. verify 9Router image chain is still only `cx/gpt-image-2.5`;
5. verify local bridge health and current installed engine config;
6. verify current `sd-server` commit and binary digest;
7. verify current Mac memory pressure / swap / free disk;
8. verify Qwen3-TTS and other normal HomeLab services are healthy;
9. prove the current 16-step reference-edit path still succeeds before benchmarking a new engine.

No production mutation in Phase 0.

## Phase 1 — Fun-Acc/PDD compatibility gate

Use the official acceleration source as the semantic reference:

```text
alibaba-pai/Qwen-Image-2.1-Fun-Acc-LoRAs
Qwen-Image-2.1-Fun-Acc-4Step.safetensors
base model: Qwen/Qwen-Image-2.1
4 NFE
rank = 64
network_alpha = 64
```

The official PDD path is not equivalent to setting `steps=4`.

It uses:

- PDD-specific scheduler behavior;
- an explicit 4-step sigma grid;
- per-step/PDD output-head behavior;
- CFG/true-CFG behavior appropriate for the distilled adapter.

Therefore the implementation must first determine which of these is true for the chosen pinned `stable-diffusion.cpp` revision:

### Path A — preferred

The pinned upstream `stable-diffusion.cpp` can represent the official Fun-Acc/PDD adapter semantics directly and correctly.

Use the official adapter without lossy conversion.

### Path B — allowed only after proof

Upstream sd.cpp cannot express the official PDD output-head behavior directly, but a reproducible conversion can produce an sd.cpp-compatible LoRA with acceptable error.

If Path B is required:

- pin the converter source revision;
- pin the source Fun-Acc adapter revision;
- store the converted artifact outside Git;
- record SHA-256 and byte size;
- document the approximation;
- compare against the official Diffusers/PDD output contract on fixed safe fixtures.

Do not download a random "turbo" LoRA and assume it is equivalent.

Do not merely change `steps=16` to `steps=4`.

## Phase 2 — pin or upgrade stable-diffusion.cpp

The current engine may be upgraded only if needed for the target features.

The selected pinned sd.cpp commit must prove support for:

- Qwen-Image-2.1 GGUF diffusion;
- Qwen3-VL-8B GGUF text encoder;
- `--llm_vision` / mmproj;
- Metal;
- OpenAI-compatible generation and edit endpoints;
- custom sigma schedules in the server generation API;
- Qwen-Image-2.1 prefix cache;
- selectable prefix-cache storage type including `q8_0`;
- Flash Attention on the relevant Metal graphs;
- mmap.

If an sd.cpp upgrade is required, build it in a candidate path and do not overwrite the accepted binary until tests pass.

Record:

- repository commit;
- build command;
- binary SHA-256;
- binary byte size.

## Phase 3 — candidate sampling profiles

Benchmark explicit profiles rather than changing several variables at once.

### Baseline

```text
16 steps
CFG 6
current accepted engine
current resolution policy
```

### Fast candidate

```text
Fun-Acc PDD
4 NFE
CFG / true-CFG = adapter-recommended value, expected near 1
correct custom sigma grid
Q4_K_M diffusion
Metal
```

### Quality control

Retain a reproducible 12- or 16-step non-distilled control profile for A/B and rollback.

Do not automatically run the quality profile after every fast result; that would destroy the latency benefit.

The final production default may switch to 4-step only after the P0 edit acceptance passes.

## Phase 4 — sigma schedule correctness

The 4-step candidate must use the exact schedule required by the selected Fun-Acc/PDD implementation.

Do not rely on sd.cpp's ordinary `steps=4` generated schedule.

Use the server's custom sigma capability or an equivalent verified engine contract.

If the official PDD grid is resolution-dependent in the implementation being used, derive or select the grid deterministically from the actual output geometry.

At minimum validate:

- square;
- portrait;
- landscape.

Record the exact sigma arrays used by the engine config, not prompts or media.

## Phase 5 — Flash Attention audit

The current service starts sd.cpp with `--diffusion-fa`.

For Qwen-Image-2.1, benchmark at least:

```text
A. current --diffusion-fa
B. --fa
C. the exact upstream-recommended combination for the pinned commit
```

The purpose is to determine whether the Qwen3-VL/text-encoder path also benefits from Flash Attention, not just the diffusion transformer.

Acceptance requires log evidence that the intended graphs actually select Flash Attention.

Do not assume Flash Attention is faster on Metal merely because it reduces memory.

Choose the fastest stable setting that does not worsen memory pressure or output correctness.

## Phase 6 — prefix KV cache

Qwen-Image-2.1 prefix cache is important for reference editing because text/reference conditions are step-independent.

Benchmark:

```text
prefix cache = auto
prefix cache = f16
prefix cache = q8_0
```

Use the exact sd.cpp model argument, equivalent to:

```text
qwen_image_2_1_prefix_cache_type=q8_0
```

Do not assume Q8 is automatically faster.

Q8 may reduce persistent cache memory while adding conversion overhead.

Choose the production cache type using measured:

- edit latency;
- peak RSS;
- swap delta;
- memory pressure;
- visual output comparison.

The target is the best **24GB Mac** tradeoff, not the smallest cache at any cost.

## Phase 7 — mmap and model residency

Benchmark `--mmap` enabled versus the current load path.

Measure separately:

- cold model startup;
- warm request latency;
- RSS;
- swap;
- file-cache behavior.

Treat mmap primarily as a load/residency optimization, not as a guaranteed denoising-speed optimization.

### Warm lease

Raise the current local engine idle shutdown candidate from:

```text
180 seconds
```

to:

```text
900 seconds
```

during the performance candidate.

Reason: the existing 3-minute idle lease makes ordinary multi-edit sessions frequently pay cold-load cost again.

Do not make the model permanently resident.

If 15-minute residency leaves the host under sustained critical memory pressure or materially harms TTS/OpenClaw, test a shorter bounded value such as 600 seconds.

## Phase 8 — resolution parity with cloud primary

Do not hardcode assumptions about GPT Image dimensions.

First capture, without storing prompt/media, the exact size classes used by the current healthy `openai/amadeus-image` primary for:

- square;
- portrait;
- landscape.

Define a source-managed local resolution map that preserves the same aspect-ratio intent.

### Required parity target

The fast local fallback must support the same **normal production size class** used by the cloud primary for those three aspect-ratio families, subject to the 24GB feasibility gate.

No silent stretching or portrait-default coercion.

For reference edits, preserve the reference aspect ratio unless the current request explicitly selects another supported ratio.

### 2K

Qwen-Image-2.1 natively supports 2K-class output, but 2K is not automatically the default on this 24GB host.

Benchmark 2K separately after 1K-class fast mode passes.

If native 2K exceeds the accepted latency/memory envelope, keep production fallback at cloud-primary normal resolution parity and leave higher-resolution finalization to the existing explicit upscale workflow.

Do not automatically invoke RealESRGAN after every generation.

## Phase 9 — bridge/config design

Prefer source-managed engine configuration rather than prompt tags.

Extend `infra/macos/qwen-image-engine.json` with explicit, validated acceleration fields, for example:

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
    "bytes": 0,
    "conversion": null
  },
  "flashAttention": "verified-setting",
  "prefixCacheType": "q8_0",
  "mmap": true,
  "idleShutdownSeconds": 900
}
```

The exact schema must be determined by implementation and tests.

Requirements:

- config validation remains fail-closed;
- all external assets are hash verified;
- no prompts/media/secrets enter Git;
- old 16-step accepted config remains recoverable through Git/checkpoint;
- one active generation remains enforced;
- one bounded waiter maximum remains enforced.

## Phase 10 — quality acceptance fixtures

Use ordinary, safe, non-private fixtures outside Git for visual acceptance.

The same input/prompt/seed must be used for A/B where the runtime supports deterministic comparison.

Required cases:

1. simple object color edit;
2. clothing edit while preserving person/pose;
3. local object replacement;
4. text replacement in an image;
5. portrait identity-preserving localized edit;
6. prompt-only generation.

Compare 4-step fast against the accepted 16-step baseline.

Score:

- instruction following;
- identity preservation;
- composition preservation;
- unwanted global color drift;
- sharpness;
- text legibility;
- artifacts;
- darkening/blur;
- output geometry.

Dense/small text degradation in the distilled path must be documented if observed.

## Phase 11 — performance benchmark

Run under ordinary HomeLab background load.

For each candidate profile record:

```text
cold T2I
warm T2I
cold edit
warm edit
second warm edit
model-load time
text/reference encode time if exposed
sampling time
VAE encode/decode time if exposed
peak RSS
minimum free memory
swap before/after
output dimensions
```

Do not include prompt/media contents in benchmark logs.

### Performance target

The main target is a material reduction from the current warm-edit baseline of approximately 311-338 seconds.

Candidate success target:

```text
warm reference edit <= 180 seconds
```

Stretch target:

```text
warm reference edit <= 120 seconds
```

Do not fail an otherwise strong 4-step candidate solely for missing the stretch target.

A result that is faster only because it silently lowered output resolution below the production parity target does not count.

## Phase 12 — production deadline

Do not immediately lower the existing 600-second OpenClaw/local fallback deadline.

After the 4-step engine is accepted, set the local engine timeout from measured cold worst case plus margin.

The outer image lifecycle timeout must remain greater than the local provider deadline.

No ordinary Agent/text/TTS/ASR/caption timeout changes are allowed.

## Phase 13 — deployment strategy

This is a runtime optimization and requires explicit operator apply.

Required order:

```text
1. read-only audit
2. pin Fun-Acc source/adaptation
3. candidate sd.cpp build if needed
4. direct CLI/API 4-step T2I
5. direct 4-step reference edit
6. A/B quality acceptance
7. prefix cache / FA / mmap matrix
8. resolution parity benchmark
9. 24GB memory/swap gate
10. source tests
11. protected Qwen runtime checkpoint
12. install/restart local Qwen candidate
13. local-only WhatsApp reference-edit acceptance
14. restore normal GPT-primary mode
15. forced eligible GPT-primary failure -> local 4-step fallback acceptance
16. healthy-primary contrast
17. release/version bump only if source/runtime changed and all gates pass
```

Do not modify 9Router image model order.

## Phase 14 — real acceptance

A real reference-edit acceptance is mandatory.

Prove:

```text
primary = cx/gpt-image-2.5
primary result = eligible operational failure
local model = qwen-image-2.1-UC-Q4_K_M
local acceleration = Fun-Acc/PDD 4-step
local mode = edit
reference count = 1
reference MIME/bytes preserved
result = success
Asset Registry = success
Completion Agent = success
WhatsApp image primitives = 1
duplicate completion text = 0
```

The output must visibly preserve the reference identity/composition while performing the requested edit.

Then prove a healthy cloud-primary edit does not call the local engine.

## Phase 15 — rollback

Before the runtime switch create a protected external checkpoint.

Rollback restores:

- prior accepted Qwen 16-step engine config;
- prior sd.cpp binary/commit;
- prior local service definition if changed;
- previous 180-second idle policy if required.

Rollback does not touch:

- 9Router;
- GPT Image account/provider;
- OpenClaw sessions;
- Asset Registry;
- TTS/ASR;
- image upscale;
- external model assets unless explicitly requested.

Keep the Fun-Acc adapter/conversion files after rollback for diagnosis unless explicitly cleaned up.

## Validation

Use the repository workflow rules and lowest sufficient validation during implementation.

At minimum before runtime apply:

```sh
pnpm workflow:plan
python3 -m unittest apps/qwen-image-service/test_bridge.py
pnpm test:openclaw-image-route-authority
pnpm test:amadeus
pnpm typecheck:amadeus
pnpm build:amadeus
python3 scripts/verify-9router-image-reference.py --machine nyannyan
python3 scripts/verify-9router-image-fallback.py --machine nyannyan
pnpm check:secrets
git diff --check
```

Add focused tests for:

- 4-step config validation;
- custom sigma serialization;
- Fun-Acc asset hash validation;
- prefix cache type validation;
- resolution mapping;
- reference aspect-ratio preservation;
- fast-engine output still entering the unchanged OpenClaw image lifecycle.

## Done definition

Complete only when:

- Q4_K_M Uncensored diffusion remains the production local model;
- stable-diffusion.cpp Metal remains the runtime;
- Fun-Acc/PDD 4-step semantics are implemented correctly rather than simulated by plain `steps=4`;
- the adapter/conversion and sigma schedule are pinned and hash verified;
- reference editing still uses Qwen3-VL-8B + mmproj;
- Flash Attention setting is proven by logs and benchmark;
- prefix cache is enabled with the measured best type; Q8_0 is used only if it wins the 24GB tradeoff;
- mmap is enabled only if benchmarked beneficial;
- warm residency is long enough to avoid unnecessary cold starts without destabilizing the host;
- normal local output resolution matches the current cloud-primary production size class/aspect intent;
- single-reference edit quality remains acceptable versus the 16-step baseline;
- warm edit latency is materially below the current 311-338 second baseline;
- 9Router/GPT primary behavior is unchanged;
- exactly one image + Kurisu caption is delivered on WhatsApp;
- no duplicate task/completion regression exists;
- upscale/text/voice/TTS/ASR regressions pass;
- a real forced-primary-failure reference edit proves the complete accelerated fallback path.

## Codex execution command

```text
/goal Execute docs/AMADEUS_QWEN_IMAGE_2_1_FUNACC_4STEP_ACCELERATION_GOAL.md end-to-end. Treat it as authoritative. Start from the accepted Amadeus 1.9.6 Qwen-Image-2.1 Uncensored reference-edit fallback and preserve its routing, Asset Registry, native task_completion, Completion Agent and exactly-one WhatsApp image+caption lifecycle. Optimize only the local Qwen inference layer: keep qwen-image-2.1-UC-Q4_K_M.gguf, Qwen3-VL-8B Q4_K_M, the verified mmproj and Qwen-Image-2.1 VAE; add a correctly implemented Alibaba PAI Fun-Acc/PDD 4-step path with the required adapter semantics and custom sigma schedule, not plain steps=4. Pin every adapter/converter/runtime revision and hash. Benchmark the exact pinned stable-diffusion.cpp Metal build for --fa/--diffusion-fa, prefix cache auto/f16/q8_0, mmap, and a 900-second warm lease, and select settings from measured 24GB latency/memory results rather than assumptions. Preserve edit strength 0.9 unless a dedicated A/B proves otherwise. Audit the current GPT Image primary size classes and make the fast local fallback preserve the same normal square/portrait/landscape resolution intent; test native 2K separately and do not silently lower resolution to win benchmarks. Keep 9Router primary-only cx/gpt-image-2.5 and keep safety/policy refusals terminal. Require same-input A/B quality tests against the accepted 16-step baseline and target <=180s warm reference edits, with <=120s as a stretch target. Do not deploy until reference-edit fidelity, memory/swap, resolution parity and regression gates pass. Runtime writes require explicit --apply and a protected checkpoint. Do not declare completion until a real forced-primary-failure WhatsApp reference edit succeeds through the 4-step local path with exactly one edited image and the normal Kurisu caption.
```
