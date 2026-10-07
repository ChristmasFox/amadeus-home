# Amadeus Qwen-Image-2.1 Uncensored Edit-First Local Fallback — Goal

Date: 2026-10-06 (Asia/Shanghai)
Initial baseline (historical): Amadeus 1.9.5 / OpenClaw 2026.9.4 / 9Router 0.5.91
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

## Current production rollout — 2026-10-07

Operator-authorized release commit `e7a815c` advanced Amadeus to 1.9.6 and is
deployed on CasaOS machine `nyannyan` as
`local/openclaw-amadeus:git-e7a815c07114-20261007054830`. The active route is
cloud-primary `cx/gpt-image-2.5` through 9Router, with `AMADEUS_QWEN_IMAGE_LOCAL_ONLY=0`
and one OpenClaw-owned local Qwen fallback for eligible operational failures.
Safety refusals and invalid requests remain terminal. The loopback bridge is
authenticated, healthy, serial, reference-edit enabled and bounded to 600000 ms.
Release health and authenticated container model discovery passed; 9Router
checks confirm primary-only ownership, reference preservation and no local
fallback after a safety refusal. Live provider fault injection was not
performed. The user accepted the corrected local-only pose edit, but the real
production GPT-failure-to-Qwen WhatsApp edit and healthy-primary no-fallback
acceptances remain pending. Do not mark this Goal complete until they pass.

Active Krea2 bridge, tests, LaunchAgent template, engine config, Compose secret
mount and deploy token injection have been retired. The Krea LaunchAgent was
absent at release; external model assets remain untouched. Full release and
rollback evidence: `.agent/checkpoints/2026-10-07-amadeus-1.9.6-qwen-fallback-release.md`.

## Historical pre-Qwen live facts

Start from the actual post-Krea rollback state, not the old 1.8.4 assumptions:

- current live release is **Amadeus 1.9.5**;
- the Krea2 candidate was paused after a real local fallback exceeded the 600-second image deadline;
- production OpenClaw/9Router were restored to the pre-candidate runtime;
- local Krea bridge is stopped;
- `infra/9router/model-capabilities.json` intentionally contains only `cx/gpt-image-2.5`;
- 9Router remains the primary image transport only;
- **OpenClaw's source-managed OpenAI provider boundary owns the local fallback**;
- actual post-rollback OpenClaw image timeout is 120000 ms; the source example
  `integrations/openclaw/openclaw.json.example` still says 600000 ms, so this
  source/runtime discrepancy must be resolved from the Qwen latency evidence;
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

### Candidate asset pins — 2026-10-07

The four existing assets were hashed from their external model directory. The
diffusion checkpoint and VAE hashes match the upstream `SHA256SUMS` at the
pinned uncensored-model repository revision. The Qwen3-VL model and mmproj
repository revision metadata confirms their exact filenames and byte sizes; the
local SHA-256 values are the startup verification pins.

| Role | Repository @ revision | File | Bytes | SHA-256 |
| --- | --- | --- | ---: | --- |
| Diffusion | `abenzerps/Qwen-Image-2.1-Uncensored-GGUF` @ `6b34e59458d3eb7ba6a6f86a116aed5253dc02c3` | `qwen-image-2.1-UC-Q4_K_M.gguf` | 4,604,558,112 | `e79c8a009f2ecbdb6c70fd663d9aea9ee304a0d91f347e4169a756b8ad141b41` |
| Text encoder | `Qwen/Qwen3-VL-8B-Instruct-GGUF` @ `f982a07559d4a2f6c8744d840bf6fccab30eea96` | `Qwen3VL-8B-Instruct-Q4_K_M.gguf` | 5,027,784,800 | `67d1659bfe71b89d50b45a4ad1a9e5b997e5bb16ce5da66a6a6167abd569e9e2` |
| Vision projection | `Qwen/Qwen3-VL-8B-Instruct-GGUF` @ `f982a07559d4a2f6c8744d840bf6fccab30eea96` | `mmproj-Qwen3VL-8B-Instruct-F16.gguf` | 1,159,029,824 | `ca524100ebf825c9a870db1c580d03879e0da0ab2541697e2458e64891cf9d38` |
| VAE | `abenzerps/Qwen-Image-2.1-Uncensored-GGUF` @ `6b34e59458d3eb7ba6a6f86a116aed5253dc02c3` | `vae/qwen_image_2.1_vae_bf16.safetensors` | 675,509,688 | `bb21f7473051e1ac368515dd3f2e15cd44d7a11748ee8823e1ddca3e4876b7c9` |

The benchmark runtime is `leejet/stable-diffusion.cpp` commit
`3f8527a46c54ecf4cb4ed6003da8e8982283c73c`; the existing external
`sd-server` binary SHA-256 is
`49ae85e6d0a29a94bc2176daac9e0849dbb5e0a131f0b6c0ba3046163a4779b6`.
The installed bridge must fail closed if an asset size/hash, binary hash, or
runtime source commit differs from these pins.

## Phase 0 — re-audit current source and runtime

Before edits:

1. read `docs/CONTEXT.md`, `docs/CURRENT_TASK.md` and this Goal;
2. run `git status --short --branch` and `git log -5 --oneline --decorate`;
3. confirm live `VERSION=1.9.5` unless main advanced after this Goal;
4. confirm current production containers match the paused-Krea rollback checkpoint;
5. verify Krea LaunchAgent/bridge is stopped;
6. verify 9Router desired/live image chain is primary-only `cx/gpt-image-2.5`;
7. verify and record the live and source image timeouts; the read-only audit
   found 120000 ms live versus 600000 ms in the source example;
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

### Candidate result — 2026-10-06

The pinned `stable-diffusion.cpp` commit `3f8527a46c54ecf4cb4ed6003da8e8982283c73c` runs the required uncensored Q4_K_M checkpoint on Metal (`MTL0`) with the pinned Qwen3-VL, mmproj and Qwen-Image-2.1 VAE. Test A produced a 768×768 image, but it was visually pale. Test B used the synthetic 768×768 `portrait-source.png` and the official multipart `/v1/images/edits` endpoint. Two initial requests using the default `strength=0.75` returned HTTP 200 with one 768×768 PNG each in 263.27 s and 263.54 s, but changed only the collar or added red shoulder outlines; they left the requested jacket body blue. Their outputs are `portrait-edit-B.png` (SHA-256 `c906252ef59ca0020e9b788ab322d1e89d4a402bc0b9f0c92c9d21ded377bd05`) and `portrait-edit-B2.png` (SHA-256 `3601a7e3fca59c0fb90aae68e6f3edeca0f71d90f5524174db359990ff8bf316`).

The first edit client exited at its default 300-second response-header timeout; the server log later confirmed inference completed in 411.41 s, but no response artifact was retained. After the operator requested continuation, Phase 1 technical review resumed without changing the checkpoint. A concise instruction with supported `strength=1.0` returned HTTP 200, one 768×768 PNG, in 458.52 s; visually, it recolored the whole jacket red while preserving the person and scene. Test B passes at that setting: `portrait-edit-strength-1.png` (SHA-256 `5df536e99903d603529adcb4905768162c7e41605b18da679e1861bdc2fd3f0c`).

Full-strength Test C recolored the pot as requested and preserved the portrait/composition, but also shifted the jacket hue. Full-strength Test D replaced `TEA` with `COFFEE`, with visibly broader color drift. At `strength=0.9`, Test C2 recolored the pot teal while visually preserving the blue jacket and composition; it returned one 768×768 PNG in 310.93 s, artifact `portrait-edit-C2.png` (SHA-256 `a2bba6011075ebcb487911b53b52258d881ae8924358d89e9c811dc095144188`). Test D2 returned one 768×768 PNG in 338.26 s and changed `TEA` to `COFFEE`; side-by-side inspection shows the rest of the flat illustration is substantially preserved, contrary to the initial “washed out” assessment. A rough pixel comparison against the fixtures supports locality: outside an approximate pot ROI, C2 mean absolute RGB-channel difference is 4.91/255 (95th percentile 7); outside an approximate label ROI, D2 is 5.82/255 (95th percentile 8). D2 artifact SHA-256 is `4cbf0c0428a5c88aedb668f77a30d97350f398cc2a35fcb87913299484a5fc94`. This supports accepting C2/D2 as localized edits at `strength=0.9`; the full-strength variants remain documented failure cases. All artifacts, response JSON and source fixtures stay outside Git under `/Volumes/Avalon/models/qwen-image-2.1-uncensored/acceptance/`.

Test B plus the strength-0.9 C2/D2 reference edits now pass direct visual/locality review; Test A generated a recognizable 768×768 fox image but remains notably pale and needs image-quality follow-up. Candidate inference reduced reported free memory to 9–12%; at the latest post-run snapshot, swap is 26.9 GiB used of 27 GiB with about 755 MiB free. Keep the candidate loopback-only on port 18795 and do not start another expensive inference until memory/swap headroom is recovered and a bounded Phase 2 plan is in place. Production, provider code, 9Router, and Krea state remain unchanged.

### Phase 2 candidate benchmark — 2026-10-07

Measured on the 24GB Apple M6 host while the existing Qwen3-TTS service remained healthy. The benchmark used the pinned `3f8527a46c54ecf4cb4ed6003da8e8982283c73c` runtime, verified Qwen assets, Metal `MTL0`, 16 steps, CFG 6, 768×768, and one request at a time. The candidate listened only on loopback and was stopped after testing.

- An isolated `--eager-load` startup diagnostic took about 135 s from process start to HTTP listener; the runtime reported 133.86 s across tensor-loader stages. This diagnostic sent no image request. The normal lazy-load cold reference edit returned HTTP 200, one 768×768 PNG, in 447.64 s (server generation 447.52 s; sampler 354.81 s).
- Warm reference-edit samples at `strength=0.9` were C2 310.93 s and D2 338.26 s. Warm text-to-image returned HTTP 200, one 768×768 PNG, in 253.28 s. No prompt or output image bytes are retained in benchmark logs.
- Ten-second process sampling observed peak RSS 14,076,032 KiB (~13.4 GiB), minimum system-wide free memory 11%, and peak swap 27,783.56 MiB of 28,672 MiB. Swap was about 26,229 MiB immediately before the cold request; memory pressure returned to 82% free after stopping the candidate. This is acceptable only for strictly serial local inference with a bounded idle shutdown; do not keep the Qwen process resident indefinitely or allow concurrent image jobs.

The slowest successful cold edit was 447.64 s; adding the required 120 s margin gives 567.64 s. Apply the 600 s minimum as the **candidate image-generation deadline** (600,000 ms) when implementing the service. This does not authorize changing primary-provider, generic Agent, text, caption, TTS or ASR deadlines. Phase 2 benchmarks are complete; queue behavior and idle-memory recovery remain service-level tests before candidate rollout.

## Phase 2 — 24GB memory and latency gate (benchmarked)

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

### Candidate bridge evidence — 2026-10-07

The pinned Qwen service is installed on `Amadeus-M204` as a separate LaunchAgent
with its own mode-0600 bearer token. Full runtime/asset SHA-256 verification
passed before the loopback bridge listened. The existing OpenClaw container can
reach its `/health` and authenticated `/v1/models`; unauthorized access returns
401. The Krea LaunchAgent was absent and its ports were closed at preflight.

One real bridge `/v1/images/edits` call using the synthetic Phase 1 portrait
returned exactly one 768×768 PNG in 398.35 s. The small pot turned teal while
the person, blue jacket, pose and composition remained visually recognizable.
The output SHA-256 is
`a0127c214a609d96d300ed41cf075cae18f109f6aa36391a54739f8680bc50f4`;
its artifact stays outside Git under the existing acceptance directory.
Bridge unit tests (11), OpenClaw overlay tests (11), syntax/plist checks,
secrets scan and `git diff --check` pass. The OpenClaw runtime is unchanged;
this does not prove a real provider fallback or WhatsApp delivery. After about
three idle minutes the child `sd-server` stopped, port 18795 closed, the bridge
still reported `ready/idle`, and system free memory recovered to 81% while swap
remained elevated near its pre-run baseline. Installed bridge/config bytes
match the source candidate.
Full bridge checkpoint:
`.agent/checkpoints/2026-10-07-amadeus-qwen-image-bridge-candidate.md`.

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

The original candidate plan required real reference-edit fallback acceptance
before version bump. At the operator's explicit request the 1.9.6 release was
deployed after local-only edit acceptance but before the production primary-
failure path was proven. Record this as an acceptance deviation: the release
is live, but Phase 14 and the Goal remain open. Do not bump again merely to
close the pending WhatsApp acceptance.

## Phase 14 — mandatory real WhatsApp acceptance

The 2026-10-07 temporary local-only OpenClaw candidate was deployed for
operator testing and then superseded by the 1.9.6 production release. Its route
bypassed GPT Image deliberately; it did not satisfy the final forced-primary-
failure fallback acceptance. Candidate evidence is in
`.agent/checkpoints/2026-10-07-amadeus-qwen-image-local-only-candidate.md`.

The current 1.9.6 production route and the remaining acceptance gap are
documented in `.agent/checkpoints/2026-10-07-amadeus-1.9.6-qwen-fallback-release.md`.

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

The 2026-10-07 production release completed these retirement changes after
operator acceptance of the local-only pose edit:

- the Krea LaunchAgent was absent;
- active Compose/env/token injection and the Krea secret mount were removed;
- active Krea bridge source, tests, LaunchAgent template and engine config were removed;
- Krea historical checkpoint documents and external model files were preserved.

The Qwen manager still refuses to start while a legacy Krea process is loaded,
as a concurrency safety guard.

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
/goal Resume docs/AMADEUS_QWEN_IMAGE_2_1_UNCENSORED_EDIT_FALLBACK_GOAL.md from the deployed Amadeus 1.9.6 production state. Do not repeat the completed candidate rollout, Krea retirement, or version bump. The remaining work is mandatory real WhatsApp acceptance: prove a GPT-primary operational failure routes exactly once to the pinned local Qwen single-reference /v1/images/edits path, retains the original reference, returns one visible edit through Asset Registry and Completion Agent with one natural caption and no duplicate message, then prove a healthy GPT primary reference edit does not call Qwen. Preserve 9Router's primary-only cx/gpt-image-2.5, the 600000 ms local-only deadline, terminal safety refusals and current rollback boundary. Do not claim the Goal complete until those checks pass.
```
