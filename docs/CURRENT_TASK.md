# Current Task — GPT-only image route cutover

Date: 2026-10-07 (Asia/Shanghai).

Completed operation: disabled the OpenClaw-owned Qwen fallback and deployed Amadeus 1.9.7 with GPT Image as the only production image route.

## Local Qwen image debug UI — 2026-10-07

The stable local Qwen bridge remains on loopback port 18793. A separate
LaunchAgent serves the generation/edit page on port 18798 and proxies only to
that bridge; all private/loopback clients are allowed without a UI login. The
current LAN URLs are `http://192.168.5.3:18798` and
`http://192.168.5.112:18798`. The user UI access code from the first version
was removed. Successful PNG results now auto-save to
`~/Pictures/Amadeus/QwenImage` (directory `0700`, files `0600`); the page and
task history display saved paths and save failures. `/`, `/api/tasks`,
unauthenticated model discovery, and both LAN URLs returned HTTP 200 after
deployment. This does not alter the GPT-only production route, 9Router, or the
paused Fun-Acc candidate. Status:
`RUNNING; AUTO_SAVE_DEPLOYED; LAN_SMOKE_PASS; NO_REAL_POST_DEPLOY_GENERATION_TEST`.

One image request was still in flight during the operator-directed UI restart.
The model bridge-to-engine connection remains active, but its old UI client
connection was closed; the new UI's in-memory task history is empty and that
request's result cannot be confirmed or recovered from the page. Let the model
request finish before starting another one.
Rollback files and deployment evidence:
`.agent/checkpoints/2026-10-07-qwen-image-debug-ui-autosave.md`.

Paused Goal: `docs/AMADEUS_QWEN_IMAGE_2_1_FUNACC_4STEP_ACCELERATION_GOAL.md` (paused by operator; preserve candidate work without deployment).

Completed/deployed baseline Goal: `docs/AMADEUS_QWEN_IMAGE_2_1_UNCENSORED_EDIT_FALLBACK_GOAL.md`.

Superseded Goal: `docs/AMADEUS_KREA2_NSFW_LOCAL_FALLBACK_GOAL.md`.

## Active runtime operation — 2026-10-07

Add an explicit production fallback gate defaulting to disabled. Keep the
configured `openai/amadeus-image` route and 9Router's `cx/gpt-image-2.5`
primary unchanged. `AMADEUS_QWEN_IMAGE_LOCAL_ONLY=1` remains candidate-only and
does not enable normal production fallback. The currently reported 9Router
`arthur-combo` HTTP 408 is a primary-provider failure; after this cutover it
must remain a visible failure, not trigger a Qwen request. Do not alter 9Router
or the local Qwen bridge as part of this operation.

Status: `DEPLOYED; OPENCLAW_HEALTH_PASS; FALLBACK_GATE_OFF; CANDIDATE_WORK_PRESERVED`.

## Paused acceleration objective — 2026-10-07

The paused Goal was narrowed to a **1024-class-only** Fun-Acc/PDD 4-step local Qwen acceleration profile, with detailed speed and quality testing reserved for the operator after any future deployment.

Target:

```text
Qwen-Image-2.1 Uncensored Q4_K_M
+ stable-diffusion.cpp Metal
+ real Fun-Acc / PDD 4-step semantics
+ correct custom sigma schedule
+ CFG approximately 1
+ supported Flash Attention
+ Qwen-Image-2.1 prefix cache (q8_0 first, auto fallback)
+ mmap if stable
+ Qwen3-VL-8B Q4_K_M + mmproj for edits
+ idle shutdown 900s
```

Production resolution in this Goal:

```text
T2I: 1024x1024
Edit: preserve source aspect ratio inside a 1024-class envelope
2K: out of scope
```

Required validation is minimal:

- service/model starts;
- one 1024 text generation works;
- one single-reference edit works and visibly depends on the reference;
- no OOM/crash;
- OpenClaw can reach the protected bridge;
- normal OpenClaw/WhatsApp service health remains green.

No formal 16-step vs 4-step benchmark, detailed visual scoring, <=180s target, <=120s stretch target or 2K test is required before deployment. The operator will evaluate real-world speed and image quality after deployment.

The existing 600-second image timeout stays unless the minimal smoke proves it insufficient.

Status: `PAUSED_BY_OPERATOR; CANDIDATE_CHANGES_PRESERVED; NOT_DEPLOYED`.

## Concurrent VPS security operation — 2026-10-07

The old shared subscription URL token has been revoked. After the operator's
explicit authorization, the Xray VLESS UUID and Hysteria 2 password were also
rotated, the four current subscription formats were updated in place, and both
proxy services were restarted. The current URL token is unchanged; clients must
refresh or re-import their subscriptions to obtain the new proxy credentials.
The old proxy credentials no longer authenticate against the running services.
The four current public subscription links return `200`; Caddy, Xray, Hysteria,
and the subscription responder are active. Current links remain outside Git in
a local `0600`-protected file. Evidence:
`.agent/checkpoints/2026-10-07-vps-proxy-credential-rotation.md`. Prior stages:
`.agent/checkpoints/2026-10-07-vps-subscription-old-url-revoked.md` and
`.agent/checkpoints/2026-10-07-vps-subscription-rotation-staged.md`.

## Concurrent 9Router runtime upgrade — 2026-10-07

At the operator's authorization, 9Router npm `0.5.95` was built from committed
source `cb223a0` over the existing digest-pinned `0.5.75` base and deployed to
CasaOS machine `nyannyan` as
`local/9router:git-cb223a0bc9e4-20261007T065751Z`. Managed TTS-style,
runtime-policy, and image Combo safety patches were applied to the exact new
package. Focused tests, secrets scan, isolated image checks, live health,
expected auth rejection, GPT Image Combo, and runtime policy checks passed.
Protected pre-switch backup:
`/DATA/AppData/9router/backups/router-upgrade-20261007T065751Z`. Evidence and
manual rollback instructions:
`.agent/checkpoints/2026-10-07-9router-0.5.95-upgrade.md`. Qwen WhatsApp
fallback acceptance remains pending; do not mark the active Goal complete.

## Paused Qwen fallback Goal scope

- keep `cx/gpt-image-2.5` as the primary image backend;
- keep 9Router's active image Combo primary-only;
- replace the paused Krea2 local fallback with `abenzerps/Qwen-Image-2.1-Uncensored-GGUF` using `qwen-image-2.1-UC-Q4_K_M.gguf`;
- make single-reference image editing the P0 local fallback capability;
- use Qwen3-VL-8B GGUF + verified mmproj/`--llm_vision` + `qwen_image_2.1_vae_bf16.safetensors`;
- route eligible failed reference edits to the protected local `/v1/images/edits` path without dropping the reference image;
- preserve the existing Asset Registry -> native task_completion -> Completion Agent -> exactly one WhatsApp image+caption lifecycle;
- keep Gemini image generation absent;
- retire active Krea service/env/token/source plumbing only after Qwen candidate acceptance.

## Current live state — 2026-10-07

Amadeus **1.9.7** is deployed on the canonical CasaOS machine. OpenClaw runs
`local/openclaw-amadeus:git-4316946bd3fe-20261007125707`; 9Router remains the
sole `cx/gpt-image-2.5` primary. `AMADEUS_QWEN_IMAGE_LOCAL_ONLY=0` and
`AMADEUS_QWEN_IMAGE_FALLBACK_ENABLED=0`; the route overlay returns the primary
failure without issuing a Qwen request. The operator-reported
`nine_router/arthur-combo` HTTP 408 was not re-probed with a live image request.

OpenClaw/Product Radar health, Gateway registration, NAS read-only smoke,
owner notification/outbox, and post-deploy maintenance passed. The optional
media-adapter smoke was skipped because that service is absent; managed log
policy reported a warning. The Qwen bridge and protected token plumbing were
not modified by this cutover. Rollback and verification evidence:
`.agent/checkpoints/2026-10-07-amadeus-1.9.7-gpt-only-image-release.md`.

The 1.9.6 GPT-to-Qwen WhatsApp acceptance is superseded by this request to keep
production GPT-only; the Fun-Acc Goal remains paused and is not deployed.

### Historical pre-Qwen baseline

The previous stable release was **Amadeus 1.9.5**. The earlier Krea2 candidate
exceeded its 600-second deadline and was paused; the old runtime was restored
before Qwen work began. The 2026-10-06 Phase 0 read-only audit found the live
image-task timeout at 120000 ms while the source example said 600000 ms. That
discrepancy was resolved using Qwen benchmark evidence: only the local image
fallback uses 600000 ms; ordinary Agent, text, caption, TTS, and ASR deadlines
were not changed. The old Krea candidate and rollback records remain historical:

The Krea candidate and rollback evidence remain historical:

```text
.agent/checkpoints/2026-10-06-amadeus-krea2-local-fallback-candidate.md
.agent/checkpoints/2026-10-06-amadeus-krea2-local-fallback-paused.md
```

## P0 acceptance boundary

A prompt-only local generation is not sufficient.

The Goal still requires a real WhatsApp **single-reference edit** where:

```text
GPT Image primary -> eligible operational failure
Qwen-Image-2.1 Uncensored local fallback -> /v1/images/edits
reference bytes preserved -> edited image returned
Asset Registry -> Completion Agent
exactly one WhatsApp image + natural Kurisu caption
```

Safety/policy refusals remain terminal and must not trigger the uncensored local fallback.

### Historical candidate and benchmark evidence

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
At that bridge-test stage, OpenClaw/9Router had not been switched and Amadeus
1.9.5 remained live. Service
idle shutdown was observed after about three minutes: the bridge remained
healthy with state `idle`, port 18795 closed, and system free memory recovered
to 81% (swap remained elevated near its pre-run level). The installed bridge
and engine config match the current source bytes. A protected OpenClaw
candidate checkpoint/switch was then performed as described below.
Evidence: `.agent/checkpoints/2026-10-07-amadeus-qwen-image-bridge-candidate.md`.

On 2026-10-07, the operator authorized `--apply`. Commit `e0a2217` was
built as an immutable OpenClaw image and switched on the canonical CasaOS
host with `AMADEUS_QWEN_IMAGE_LOCAL_ONLY=1 --candidate --build-auto`. The
candidate sends image generation/edit requests directly to Qwen and does not
attempt GPT Image; this temporary test mode is not the final fallback route.
The protected pre-switch checkpoint is
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261006185442`.
Post-switch OpenClaw/Product Radar health, Gateway registration, container
Qwen token permissions (0600), authenticated `/v1/models`, NAS read-only
smoke, and owner outbox smoke passed. 9Router remains on its previous
primary-only image. No real WhatsApp image request has yet been accepted.
Evidence: `.agent/checkpoints/2026-10-07-amadeus-qwen-image-local-only-candidate.md`.

Status: `PAUSED_BY_OPERATOR; PHASE_0_AUDITED; PHASE_1_TESTS_B_C_D_PASS; PHASE_2_BENCHMARK_COMPLETE; QWEN_BRIDGE_CANDIDATE_EDIT_PASS; AMADEUS_1.9.7_GPT_ONLY_DEPLOYED; QWEN_FALLBACK_DISABLED; KREA_ACTIVE_SOURCE_RETIRED; NOT_DEPLOYED_FUNACC`.

On 2026-10-07, commit `6b7623e` corrected the bridge's image-edit extra
argument from ignored `denoising_strength` to the pinned engine's `strength`.
The authorized local LaunchAgent restart is healthy and authenticated
OpenClaw-container model discovery returns HTTP 200. The effective requested
strength is now 0.9 instead of the engine default 0.75. The operator later
confirmed the corrected local pose edit appeared acceptable. This local-only
candidate result did not exercise the production GPT-primary fallback. Evidence:
`.agent/checkpoints/2026-10-07-qwen-image-edit-strength-restart.md`.

Formal Amadeus 1.9.6 deployment evidence:
`.agent/checkpoints/2026-10-07-amadeus-1.9.6-qwen-fallback-release.md`.


## Active VPS subscription accounting Goal — 2026-10-08

See `docs/AMADEUS_VPS_SUBSCRIPTION_ACCOUNTING_GOAL.md`. Status:
`PHASE_0_AUDITED; PHASE_1_SOURCE_IMPLEMENTED; PHASE_2_APPLIED; PHASE_3_CONTROLLED_ACCOUNTING_PASS_RECONCILIATION_UNCALIBRATED; PHASE_4_SOURCE_VERIFIED_DEPLOY_PENDING; PHASE_5_ACCEPTANCE_PENDING`.
VPS accounting is live with T0 `2026-10-08T04:58:07Z`; sanitized snapshots and
the guarded legacy VLESS T0 baseline repair are verified. Provider/proxy
reconciliation remains uncalibrated. The existing morning/evening Cron jobs
were verified as unique, enabled, and using Asia/Shanghai; release deployment
will keep their IDs and set them to 09:30 and 21:30 via the owner outbox.
