# Current Task — Qwen-Image-2.1 Uncensored edit-first local fallback

Date: 2026-10-06 (Asia/Shanghai).

Active Goal: `docs/AMADEUS_QWEN_IMAGE_2_1_UNCENSORED_EDIT_FALLBACK_GOAL.md`.

Superseded Goal: `docs/AMADEUS_KREA2_NSFW_LOCAL_FALLBACK_GOAL.md`.

## Objective

- keep `cx/gpt-image-2.5` as the primary image backend;
- keep 9Router's active image Combo primary-only;
- replace the paused Krea2 local fallback with `abenzerps/Qwen-Image-2.1-Uncensored-GGUF` using `qwen-image-2.1-UC-Q4_K_M.gguf`;
- make single-reference image editing the P0 local fallback capability;
- use Qwen3-VL-8B GGUF + verified mmproj/`--llm_vision` + `qwen_image_2.1_vae_bf16.safetensors`;
- route eligible failed reference edits to the protected local `/v1/images/edits` path without dropping the reference image;
- preserve the existing Asset Registry -> native task_completion -> Completion Agent -> exactly one WhatsApp image+caption lifecycle;
- keep Gemini image generation absent;
- retire active Krea service/env/token/source plumbing only after Qwen candidate acceptance.

## Current live baseline

Current live release is **Amadeus 1.9.5** (`VERSION=1.9.5`).

The previous Krea2 candidate exceeded the 600-second local image deadline and was paused by the operator. Runtime was restored to the pre-candidate OpenClaw/9Router checkpoints. The normal 9Router/GPT image route is active, WhatsApp is healthy, the local Krea bridge is stopped, and `infra/9router/model-capabilities.json` currently contains only `cx/gpt-image-2.5`.

Phase 0 read-only audit on 2026-10-06 confirmed the OpenClaw and 9Router
containers match the rollback image tags and are healthy. The live
`agents.defaults.mediaModels.image.timeoutMs` is **120000 ms**, not 600000 ms;
`integrations/openclaw/openclaw.json.example` still says 600000 ms. Treat this
as a source/runtime discrepancy and choose the final image deadline only from
the Qwen benchmark. Krea ports 18793/18796 are closed, no Krea LaunchAgent is
loaded, and the OpenClaw provider overlay remains text-only for Krea. The live
9Router image fixture confirms a single `cx/gpt-image-2.5` primary and terminal
safety refusals. Host baseline: Mac mini M6/24 GB, memory-pressure free 82%,
swap used 27569.62 MiB of 28672 MiB, Qwen3-TTS `/healthz` ready, and 201 GiB
free on `/Volumes/Avalon`.

The Krea candidate and rollback evidence remain historical:

```text
.agent/checkpoints/2026-10-06-amadeus-krea2-local-fallback-candidate.md
.agent/checkpoints/2026-10-06-amadeus-krea2-local-fallback-paused.md
```

## P0 acceptance boundary

A prompt-only local generation is not sufficient.

The new Goal must prove a real WhatsApp **single-reference edit** where:

```text
GPT Image primary -> eligible operational failure
Qwen-Image-2.1 Uncensored local fallback -> /v1/images/edits
reference bytes preserved -> edited image returned
Asset Registry -> Completion Agent
exactly one WhatsApp image + natural Kurisu caption
```

Safety/policy refusals remain terminal and must not trigger the uncensored local fallback.

Two initial default-strength Phase 1 edits changed only the collar/outline, not
the jacket body. The same-checkpoint `strength=1.0` Test B recolored the full
jacket. Full-strength Test C shifted the jacket hue, but strength-0.9 C2 changed
the pot to teal and preserved the blue jacket/scene. Full-strength Test D had
broader color drift; strength-0.9 D2 changed `TEA` to `COFFEE` while preserving
the surrounding illustration. Side-by-side inspection plus approximate
out-of-edit-ROI pixel comparisons supports C2/D2 locality. Test A produced a
recognizable but notably pale fox image. Phase 1 reference-edit smoke tests
B/C/D pass; review text-to-image quality and proceed to Phase 2 only after
memory/swap headroom recovers. The local candidate server is loopback-only;
production and source runtime remain unchanged.

Phase 2 benchmark completed on 2026-10-07: cold edit 447.64 s, warm edits
310.93/338.26 s, warm text-to-image 253.28 s; peak sampled RSS ~13.4 GiB,
minimum free memory 11%, and swap peaked at 27,783.56/28,672 MiB before
recovering to 82% free after stopping the candidate. Implement strict serial
generation and bounded idle shutdown. The candidate-only image deadline is
600,000 ms (cold edit + 120 s margin, rounded up to the 600 s minimum); do not
change unrelated deadlines. The local candidate server is stopped. Production,
provider code, 9Router, and Krea state remain unchanged.

Asset revision, byte-size and SHA-256 pins were recorded on 2026-10-07.
The uncensored-model repository SHA256SUMS matches the local diffusion and VAE
hashes; the official Qwen3-VL repository pins the local encoder and mmproj
filenames and byte sizes. The external `sd-server` binary digest is also
recorded. At that pinning stage, no asset or runtime was changed.

On 2026-10-07, the new protected Qwen bridge was installed as a macOS
LaunchAgent with explicit `--apply`. It uses its own mode-0600 bearer token;
the Krea LaunchAgent remains absent. Complete asset/runtime hash validation,
host `/health`, authenticated and unauthorized OpenClaw-container -> bridge
`/v1/models` checks, and one real host bridge `/v1/images/edits` request passed.
The synthetic portrait reference produced one 768×768 PNG in 398.35 s: the pot
turned teal while the person, blue jacket and composition remained visually
recognizable. The artifact and input stay outside Git. This proves the bridge
path, **not** the provider fallback, Asset Registry or WhatsApp delivery.
The first real OpenClaw-container edit using Node's built-in `fetch` failed
after about 303 seconds (`fetch failed`). A retry with `undici.fetch`,
`undici.FormData`, and an `Agent` with 600000 ms headers/body timeouts
completed in about 409 seconds and returned a 537640-byte image. Built-in
`fetch` cannot use that Agent (`UND_ERR_INVALID_ARG`). The candidate
image-route source uses the successful client; container transport success
does not yet prove the OpenClaw route or WhatsApp delivery.
OpenClaw/9Router have not been switched; Amadeus 1.9.5 remains live. Service
idle shutdown was observed after about three minutes: the bridge remained
healthy with state `idle`, port 18795 closed, and system free memory recovered
to 81% (swap remained elevated near its pre-run level). The installed bridge
and engine config match the current source bytes. A protected OpenClaw
candidate checkpoint/switch remains pending.
Evidence: `.agent/checkpoints/2026-10-07-amadeus-qwen-image-bridge-candidate.md`.

Status: `PHASE_0_AUDITED; PHASE_1_TESTS_B_C_D_PASS; TEST_A_OUTPUT_PALE; PHASE_2_BENCHMARK_COMPLETE; IMAGE_DEADLINE_CANDIDATE_600S; ASSET_PINS_VERIFIED; QWEN_BRIDGE_CANDIDATE_EDIT_PASS; OPENCLAW_CANDIDATE_NOT_DEPLOYED; REAL_WHATSAPP_ACCEPTANCE_PENDING`.
