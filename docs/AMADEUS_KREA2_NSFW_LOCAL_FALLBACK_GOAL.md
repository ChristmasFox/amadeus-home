# Amadeus Wild Krea-2 Turbo NSFW Local Fallback — Goal

Date: 2026-10-06
Baseline: Amadeus 1.8.4 / OpenClaw 2026.9.4 / 9Router 0.5.91
Target host: Mac mini Apple Silicon / 24GB unified memory
Type: image generation backend / local fallback deployment

## Goal

Replace the current Gemini image fallback with a local Krea-2 NSFW backend while preserving the existing Amadeus image lifecycle.

Production target:

```text
OpenClaw image_generate
  -> openai/amadeus-image
  -> primary: cx/gpt-image-2.5
  -> fallback: local Wild Krea-2 Turbo NSFW
  -> existing generated attachment
  -> Asset Registry
  -> native task_completion
  -> Completion Agent
  -> one WhatsApp image bubble with natural Kurisu caption
```

Remove `ag/gemini-3.1-flash-image` from active image desired state after local acceptance passes.

The initial local candidate is:

- model repository: `ModdiAdam/Wild_Krea-2-turbo_NSFW`
- diffusion GGUF: `Wild_Krea-2-turbo_NSFW-Q4_1.gguf`
- approximate file size: 8.02 GB
- architecture: Krea2 / 13B
- host runtime target: pinned `stable-diffusion.cpp` with Metal

Do not silently replace this candidate with ordinary Krea-2 Turbo or Qwen Image.

## Non-negotiable invariants

The existing Amadeus 1.8.4 successful image lifecycle is authoritative and must remain unchanged above the provider boundary.

Preserve:

- exactly one successful image send;
- Completion Agent remains responsible for the natural Kurisu caption;
- caption remains inside the same WhatsApp image bubble;
- generated assets still enter the Asset Registry;
- native `task_completion` remains live;
- the following user turn sees the previous generation as completed;
- `amadeus_image_upscale` behavior remains unchanged;
- text / voice / TTS / ASR behavior remains unchanged;
- model-authored provider/model/path/asset identifiers never become routing authority.

Do not create a second Agent image tool or a keyword route.

## Phase 0 — read-only live audit

Before writing runtime state:

1. Read `docs/CONTEXT.md` and `docs/CURRENT_TASK.md`.
2. Run `git status --short --branch` and `git log -5 --oneline --decorate`.
3. Verify live release is still Amadeus 1.8.4 unless main has advanced.
4. Verify live OpenClaw image primary remains `openai/amadeus-image`.
5. Verify the current 9Router Combo is exactly:
   - `cx/gpt-image-2.5`
   - `ag/gemini-3.1-flash-image`
   - strategy `fallback`
6. Verify current image timeout layers, including OpenClaw, 9Router, bridge/client and smoke harness.
7. Verify a free macOS localhost port before assigning the new service.
8. Record current Mac memory pressure, swap, running Qwen3-TTS service and current HomeLab baseline.

No production mutation in Phase 0.

## Phase 1 — pin and verify model assets

Never track model files in Git.

Download into a protected external model directory and record only:

- repository;
- exact revision/commit;
- filename;
- SHA-256;
- byte size.

Candidate diffusion model:

```text
Wild_Krea-2-turbo_NSFW-Q4_1.gguf
```

Do not assume the model card's auxiliary components are compatible with the selected `stable-diffusion.cpp` build.

There is a known component discrepancy that must be resolved experimentally before production:

- the Wild Krea model card recommends `qwen_image_vae.safetensors` and `qwen3vl_4b_fp8_scaled.safetensors`;
- current upstream `stable-diffusion.cpp` Krea2 documentation describes Krea2 with Wan2.1 VAE and Qwen3-VL 4B.

Therefore:

1. pin a `stable-diffusion.cpp` commit that explicitly supports Krea2;
2. begin with the official sd.cpp Krea2 component contract:
   - Qwen3-VL-4B text encoder, preferably a low-memory GGUF such as Q4_K_M;
   - Wan2.1 VAE;
3. run a direct compatibility smoke with the Wild Q4_1 transformer;
4. only if that combination is incompatible, test the Wild model-card component set in isolation;
5. do not switch production until one exact transformer + text encoder + VAE combination is proven by deterministic local smoke.

No compatibility claim may be made based only on filename or model-card metadata.

## Phase 2 — Mac mini 24GB feasibility gate

Use the real Mac mini under normal HomeLab background load.

Initial limits:

```text
generation concurrency = 1
resolution = 1024-class only
steps = Krea-2 Turbo validated value
```

Benchmark at minimum:

- 1024x1024;
- portrait 1024-class;
- landscape 1024-class;
- cold start;
- warm second image.

Record only bounded metrics:

- model load time;
- image generation time;
- peak process RSS;
- macOS memory pressure;
- swap before/after;
- output dimensions;
- success/failure.

Acceptance:

- no OOM;
- no sustained critical memory pressure;
- no uncontrolled swap growth;
- OpenClaw remains responsive;
- Qwen3-TTS stays healthy;
- 9Router stays healthy;
- output completes inside the planned image deadline.

If persistent model residency causes unacceptable idle unified-memory pressure, implement bounded lazy start / idle shutdown instead of keeping the diffusion model permanently resident.

## Phase 3 — local service

Add source-managed macOS runtime files following existing repository conventions, equivalent to:

```text
infra/macos/manage-krea2-image.sh
infra/macos/com.amadeus.krea2-image.plist.example
infra/macos/krea2-image-engine.json
```

Requirements:

- dry-run by default;
- all mutation requires explicit `--apply`;
- exact sd.cpp commit pin;
- Metal enabled;
- model hash verification before service start;
- one worker only;
- bounded queue;
- `status`, `health`, `start`, `stop`, `restart`, `uninstall`;
- uninstall preserves downloaded models unless explicitly told otherwise;
- no generated images or model binaries in Git;
- no unauthenticated public/LAN image endpoint.

Prefer loopback-only native inference plus a narrow protected bridge accessible from the OrbStack container.

## Phase 4 — local OpenAI-compatible bridge

Expose only the minimum image contract required by the current Amadeus provider path.

Target surface:

```text
GET  /health
GET  /v1/models
POST /v1/images/generations
```

Do not create a generic reverse proxy.

Requirements:

- bearer token or equivalent protected local boundary;
- token stored outside Git with mode 0600;
- one active generation;
- bounded request body;
- bounded output bytes;
- explicit request timeout;
- safe error mapping;
- no prompt or image bytes in logs.

Return the same OpenAI-compatible image result shape already accepted by the current OpenClaw/9Router path.

## Phase 5 — reference-image policy

The selected Wild Krea-2 Turbo NSFW candidate is accepted initially as a text-to-image fallback only unless a compatible edit path is proven.

Current production supports one trusted reference image. Do not silently drop a reference image when falling back.

For reference-image requests:

- keep GPT Image as primary;
- if GPT Image fails and the local Krea backend has not passed a real edit/reference acceptance, return a bounded terminal generation failure;
- do not pretend a prompt-only Krea generation is an edit;
- do not restore Gemini to cover this case.

A future Krea2 edit model may be added only as a separate validated Goal.

## Phase 6 — fallback ownership

Preferred architecture remains the existing single logical image route:

```text
OpenClaw
  -> openai/amadeus-image
  -> 9Router fallback Combo
```

First verify whether pinned 9Router 0.5.91 can register a local OpenAI-compatible image backend without patching 9Router source.

Preferred desired state:

```text
amadeus-image
  1. cx/gpt-image-2.5
  2. local/wild-krea2-turbo-nsfw
strategy=fallback
```

The exact local provider/model identifier must be derived from the implemented provider registration. Do not invent an ID that the live router cannot resolve.

If stock 9Router cannot dispatch to the local image endpoint, use a narrowly scoped OpenClaw image-provider fallback only after reading the pinned OpenClaw 2026.9.4 source and proving its asynchronous `image_generate` fallback semantics.

Do not weaken the current route-authority invariant to arbitrary model-authored values.

## Phase 7 — remove Gemini image fallback

After local Krea compatibility and forced-fallback acceptance are proven, change active desired state from:

```text
cx/gpt-image-2.5
ag/gemini-3.1-flash-image
```

to:

```text
cx/gpt-image-2.5
local Wild Krea-2 Turbo NSFW
```

Update active:

- `infra/9router/model-capabilities.json`;
- `scripts/provision-9router-image-combo.py`;
- `scripts/test-provision-9router-image-combo.py`;
- `scripts/verify-9router-image-fallback.py`;
- `scripts/smoke-9router-image.py`;
- current docs that describe production image routing.

Historical checkpoints remain immutable evidence.

Search all active source for:

```text
gemini-3.1-flash-image
ag/gemini
```

and ensure no active image path still uses Gemini.

Do not remove unrelated Gemini text/reasoning models.

## Phase 8 — extend image deadline

Current image timeout is 180 seconds, which is not a safe local-fallback budget.

Target an image-specific provider deadline of approximately:

```text
600000 ms
```

Audit every nested deadline.

The effective path:

```text
OpenClaw
 -> 9Router
 -> local bridge
 -> stable-diffusion.cpp
```

must not be killed by an inner 180s/300s timeout.

Do not globally increase ordinary text, TTS, ASR or caption deadlines.

Update smoke tooling to use one named image timeout constant rather than duplicated magic numbers.

The asynchronous image task must remain visibly running while fallback is executing; do not emit a false failure just because the primary provider failed.

Avoid repeated progress-message spam.

## Phase 9 — NSFW model deployment boundary

This Goal intentionally deploys a mature-content-capable Krea2 checkpoint.

Do not add provider-side prompt rewriting that defeats the selected model's intended adult-prompt capability.

However, preserve application/legal safety boundaries required by the model license and system policy:

- no sexual content involving minors;
- no non-consensual intimate imagery;
- no illegal sexual content;
- no secrets or private media in logs.

Do not use generated adult test media as Git fixtures.

Automated provider/transport tests should use ordinary non-explicit prompts; capability verification may rely on model/runtime identity and bounded operator acceptance rather than storing explicit test outputs in repository evidence.

## Phase 10 — focused tests

Required focused tests:

1. primary GPT Image success does not call local Krea;
2. eligible primary 429 triggers local Krea exactly once;
3. eligible primary 5xx triggers local Krea exactly once;
4. local Krea success returns one valid generated attachment;
5. both backends unavailable produce one bounded terminal failure;
6. local timeout terminates cleanly;
7. no Gemini image backend is attempted;
8. local generated image enters the existing Asset Registry;
9. Completion Agent still creates the natural caption;
10. exactly one image primitive is delivered;
11. following user turn sees the image task as completed;
12. `amadeus_image_upscale` continues to work on locally generated images;
13. reference-image fallback never drops the reference or converts it to prompt-only behavior;
14. text/voice/TTS/ASR regression suites remain green.

## Phase 11 — production rollout

Required order:

```text
1. Phase-0 audit
2. pin sd.cpp
3. download/hash-verify Wild Krea Q4_1
4. resolve exact VAE/text-encoder compatibility
5. direct Mac generation smoke
6. real 24GB memory benchmark
7. protected bridge smoke
8. container -> local bridge smoke
9. synthetic fallback fixture
10. protected snapshot of existing 9Router image Combo
11. install new local provider desired state
12. remove Gemini from active desired state
13. verify-live
14. forced-primary-failure acceptance
15. normal-primary acceptance
16. real WhatsApp acceptance
```

Do not mark rollout complete from a direct sd.cpp CLI image alone.

## Phase 12 — real acceptance

A real forced-fallback test is mandatory.

Prove with bounded diagnostics:

```text
primary = cx/gpt-image-2.5
primary = eligible failure
fallback = local Wild Krea-2 Turbo NSFW
fallback = success
gemini_attempted = false
```

The resulting ordinary acceptance image must:

- arrive exactly once on WhatsApp;
- contain the normal Kurisu Completion Agent caption in the same image bubble;
- be registered as the latest image;
- be available to the existing upscale workflow;
- leave the original task in terminal completed state.

Then perform a normal generation with a healthy GPT Image primary and prove local Krea is not called unnecessarily.

## Rollback

Before image Combo mutation, create the existing protected external checkpoint.

Rollback must independently support:

- restoring the prior image Combo;
- stopping/removing the Krea LaunchAgent/bridge;
- preserving model assets for later diagnosis;
- leaving chat models, TTS, ASR, Product Radar, PUBG, Asset Registry and unrelated provider credentials untouched.

Emergency rollback may restore the exact previous Gemini-containing checkpoint, but Gemini must not remain in the new successful desired state.

## Validation

Use the repository FAST/RUNTIME/RELEASE workflow rules.

Before release at minimum:

```sh
pnpm test:amadeus
pnpm typecheck:amadeus
pnpm build:amadeus
pnpm test:openclaw-image-route-authority
node scripts/test-delivery-boundary.mjs
python3 scripts/test-provision-9router-image-combo.py
python3 scripts/verify-9router-image-fallback.py --machine nyannyan
pnpm check:secrets
git diff --check
```

Add focused tests for the macOS Krea service, bridge and timeout behavior.

Actual host/runtime writes continue to require explicit `--apply`.

## Done definition

Complete only when:

- Wild Krea-2 Turbo NSFW Q4_1 has a pinned, hash-verified local runtime;
- the exact compatible text encoder and VAE have been proven with the pinned sd.cpp build;
- the Mac mini 24GB feasibility gate passes;
- local generation concurrency is one;
- GPT Image remains primary;
- local Wild Krea is the only active image fallback;
- Gemini image fallback is removed from active desired state;
- image deadline supports real local inference;
- ordinary local fallback reaches Asset Registry and native task completion;
- WhatsApp sends exactly one final image with natural Kurisu caption;
- reference-image requests are never silently degraded;
- upscale/text/voice/TTS/ASR regressions pass;
- one real forced-primary-failure acceptance proves the local Krea fallback path end-to-end.

## Codex execution command

```text
/goal Execute docs/AMADEUS_KREA2_NSFW_LOCAL_FALLBACK_GOAL.md end-to-end. Treat it as authoritative. Preserve the current Amadeus 1.8.4 image_generate -> Asset Registry -> native task_completion -> Completion Agent -> single WhatsApp image+caption lifecycle. Deploy ModdiAdam/Wild_Krea-2-turbo_NSFW using Wild_Krea-2-turbo_NSFW-Q4_1.gguf on the 24GB Mac mini with a pinned stable-diffusion.cpp Metal runtime. Do not assume the model-card VAE/text-encoder pairing is compatible with sd.cpp: resolve and prove the exact transformer + Qwen3-VL 4B + VAE combination before production. Keep cx/gpt-image-2.5 as primary, use local Wild Krea2 NSFW as the only fallback, remove ag/gemini-3.1-flash-image from active image desired state after acceptance, increase the image-specific generation deadline to about 600 seconds without changing unrelated text/TTS/ASR/caption deadlines, limit local generation concurrency to one, keep reference-image requests fail-closed unless a real local edit path is proven, and do not call the rollout complete until a real forced-primary-failure WhatsApp test produces exactly one image with the normal Kurisu caption and no Gemini attempt. Follow repository dry-run/--apply, secret, rollback and release rules.
```
