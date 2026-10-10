# Current Task — Public Qwen Image Lab deployment

Date: 2026-10-10 (Asia/Shanghai).

## Concurrent Amadeus runtime fix — 2026-10-10

Amadeus 1.10.2 is deployed on CasaOS `nyannyan`. The native heartbeat sender
now blocks text-only `NO_REPLY`, handles control-prefixed sentinels, and strips
leading internal control markers from real alerts. This does not change the
active Image Lab scope or its production GPT-only image invariant. Evidence and
rollback are in
`.agent/checkpoints/2026-10-10-amadeus-heartbeat-silent-delivery-release.md`.

Active Goal: `docs/AMADEUS_QWEN_IMAGE_PUBLIC_LAB_GOAL.md`.

Production invariant: Amadeus 1.9.7 remains GPT-only for image generation; local Qwen stays outside the production route and is used only by the Image Lab.


## Concurrent VPS daily traffic fuse Goal — 2026-10-10

Planned Goal: `docs/AMADEUS_VPS_DAILY_TRAFFIC_FUSE_GOAL.md`.
Status: `PLANNED_NOT_APPLIED`; **this document submission is not permission to modify live traffic control**.

Policy: Shanghai-local calendar day (00:00 to next 00:00), 40 GB one-time warning, 50 GB whole-gateway threshold, shared 2 Mbps non-management business egress shaping until next 00:00, then verified automatic release. KiwiVM remains provider quota truth; local WAN monitoring needs calibrated scope and truthful source/coverage states. A VPS-side timer must restore speed even when OpenClaw/WhatsApp is unavailable.

Kurisu alert events **must reuse** the existing `worldline_notification_intent` -> presentation adapter -> canonical WhatsApp owner outbox. Warning/engagement are 世界线偏移, verified release is 世界线收束, scheduled VPS report remains D-Mail; operator failures use the current policy's appropriate theme. Never add a second sender or hand-built theme renderer.

Compatibility: `Labmem001`-`Labmem005` plus `M204-Net-Core` remain valid, Legacy stays retired, and existing VLESS/HY2 security hardening, ports, SSH recovery, subscriber credentials, and 09:30/21:30 jobs stay intact. Separate explicit runtime apply/checkpoint is mandatory.

## Concurrent VPS proxy security hardening Goal — 2026-10-09

Active concurrent Goal: `docs/AMADEUS_VPS_PROXY_SECURITY_HARDENING_GOAL.md` (explicitly selected by the operator).

Current security baseline: the active proxy identities are `Labmem001`–`Labmem005`
plus `M204-Net-Core`; Legacy is retired and its old subscription/HY2/VLESS
credentials are rejected. The hardening Goal must not rotate any active token,
HY2 secret, VLESS UUID, Reality key/shortId, SNI, hostname or public proxy
port, and must not require client re-import.

Planned scope is server-side only: Xray REALITY anti-steal loopback fallback
gate with exact SNI allowlist + blackhole, fallback inbound traffic telemetry,
HY2 masquerade egress audit/local-only replacement when necessary, bounded
failed-auth telemetry and conservative optional throttling using Hysteria's
reported client addr, plus owner-only Kurisu security visibility. Existing
09:30/21:30 reports are updated in place only after compatibility acceptance.

Status: `PHASE_0_4_APPLIED; VLESS_HY2_COMPATIBILITY_PASS; OPENCLAW_AND_REPORTS_APPLIED; MANUAL_REPORT_SENT; DIRECT_OWNER_DM_QUERY_PASS_2026-10-09T11:08+08:00; TASK_OUTPUT_EXPOSURE_ACCEPTED_RESIDUAL; ACTIVE_CREDENTIALS_UNCHANGED; COMPLETE`.

The operator explicitly pre-authorized the scoped Git/macOS/frpc/frps/Caddy/DNS-if-needed/runtime-secret/restart/smoke mutations in the active Goal and asked execution to continue without routine confirmation until `https://image.nyannyan.top` is deployed and usable. This authorization does not extend to SSH-auth/firewall changes, unrelated DNS/services, credential rotation, or other out-of-scope destructive operations.

## Active Image Lab target — 2026-10-08

The current LAN debug surface is being replaced by a deliberately small Image Lab:

```text
Mode:
  Quality — base Qwen 16-step
  Fast    — real Fun-Acc/PDD 4-step

Generation resolution:
  1024x1024
  1024x768
  768x1024

Edit resolution:
  automatic from reference geometry, capped at 1024px / 1MP

Seed:
  -1 random
  >=0 fixed
```

No CFG/strength/sampler/cache/FA/mmap/model controls are exposed. Reference editing remains supported through Qwen3-VL + mmproj. The Image Lab path must not inject an edit strength below 1.0. Exactly one local `sd-server` may be resident; profile changes restart that single engine rather than keeping both profiles loaded.

LAN/private direct access remains no-login. The exact public host `image.nyannyan.top` requires password-only application authentication using a runtime-only verifier; the operator-provided plaintext password must never enter Git, logs, Caddy, frp configs or checkpoints.

Public topology remains the existing architecture:

```text
image.nyannyan.top -> VPS Caddy -> VPS frps -> HomeLab frpc -> macOS Image Lab :18798
```

Only the UI is public. Qwen bridge/engine ports remain loopback-only.

Status: `SOURCE_AND_FOCUSED_CHECKS_PASS; MAC_UI_REDEPLOYED; PUBLIC_HTTPS_LOGIN_PAGE_LIVE; UNAUTH_APIS_BLOCKED; QUALITY_CFG1_DEPLOYED_FOR_OPERATOR_COMPARISON; TASK_MODAL_AND_AUTO_EDIT_RESOLUTION_DEPLOYED; OPERATOR_IMAGE_CHECK_PENDING`.

Quality remains capped at 16 steps. For the operator's sampling comparison,
the base profile now uses CFG 1 while retaining the same model, VAE, sampler,
and schedule. The operator will submit and judge the next image; no generation
was submitted during this configuration change. The protected pre-deploy
snapshot and rollback details are in
`.agent/checkpoints/2026-10-08-qwen-image-quality-cfg1-redeploy.md`.

Task-history image viewing now opens a modal without replacing the main output
preview. Reference edits automatically preserve valid source geometry or scale
proportionally within the 1024px / 1MP cap; completed task and result metadata
show the actual output dimensions. Reference bytes and MIME are preserved.
Focused bridge/UI tests (35), JavaScript/Python syntax checks, secrets scan and
`git diff --check` passed. The Mac bridge and UI LaunchAgents were applied; the
bridge is `ready`/`idle`, the local task queue is empty, local UI returns 200,
the public HTTPS root returns 200, and unauthenticated public tasks return 401.
No login or image generation was performed. Protected rollback snapshot and
details: `.agent/checkpoints/2026-10-08-qwen-image-modal-auto-resolution.md`.

The exact `image.nyannyan.top` Caddy site is now deployed from
`infra/vps/image-lab.example.Caddyfile`. The existing full Caddyfile validated
before and after the append, Caddy reloaded successfully, DNS already resolved
through the existing Cloudflare proxy, and Caddy obtained a valid Let's Encrypt
certificate. The authenticated Mac UI and single frpc mapping are now live:
`image.nyannyan.top` returns its password page over verified HTTPS. The
runtime verifier exists only at the documented Mac secrets path with mode
`0600`; its contents were not read. Wrong-password login and unauthenticated
public model/task/generation requests return `401`. The HomeLab guest reaches
the Mac UI at `192.168.5.3:18798`; frpc has exactly one additional mapping and
reports `qwen-image-lab-tcp` start success. Persistent IPv4/IPv6 INPUT rules
drop non-loopback TCP `18798` while permitting Caddy's loopback upstream; SSH
was verified in a new session and all unrelated firewall rules are unchanged.
Evidence and rollback are in `.agent/checkpoints/2026-10-08-qwen-image-public-lab-caddy-staged.md`,
`.agent/checkpoints/2026-10-08-qwen-image-public-lab-frps-port.md`,
`.agent/checkpoints/2026-10-08-qwen-image-public-lab-firewall.md`, and
`.agent/checkpoints/2026-10-08-qwen-image-public-lab-frpc.md`.

The new bridge reports ready and exposes only Quality/Fast. The public login
page and unauthenticated gates are verified. The earlier local Quality
1024x1024 fixed-seed smoke timed out at 600 seconds after reporting 15 of 16
steps; the UI received HTTP 504. The task failed after 610003 ms and is not
running. Generation deadlines are now 900000 ms in both profiles and the UI
proxy waits 910 seconds; the separate model-load timeout remains 600 seconds.
The bridge reports `deadlineMs: 900000`, and local UI/model-discovery smoke
passed after redeployment. The operator has since authenticated to the public
Image Lab and reports that several Fast-mode outputs look good across random
and fixed seeds. Quality CFG 1 is now deployed at 16 steps for operator
comparison; no image was generated during this config change. Evidence and
rollback are in
`.agent/checkpoints/2026-10-08-qwen-image-quality-cfg1-redeploy.md`.

The operator reported poor image quality and requested restoration of the
engine configs from `origin/main`. Quality/Fast JSON files now match that Git
revision: Quality remains 16 steps / CFG 1 with implicit legacy
`--diffusion-fa` and no configured prefix cache; Fast remains 4 Fun-Acc/PDD
steps / CFG 1 with `--diffusion-fa`, `q8_0` and mmap. The stale-engine port
ownership guard and SIGTERM child cleanup remain enabled. No image was
generated during the config restoration. Deployment and rollback evidence:
`.agent/checkpoints/2026-10-09-qwen-image-restore-origin-config.md`.

The 12:23 Quality task was marked successful after 92.169 seconds, but its
image was visibly incomplete. Investigation found an orphan Fast engine still
holding port 18795 after a bridge restart. The bridge now checks that its
internal port is free before starting and handles SIGTERM by stopping its own
engine child. Evidence is in
`.agent/checkpoints/2026-10-09-qwen-image-quality-stale-fast-engine.md`.

The earlier `--fa` plus prefix-cache `auto` trial is retained as historical
evidence in `.agent/checkpoints/2026-10-09-qwen-image-quality-fa-prefix-auto.md`.

The Image Lab task history now has an authenticated, task-ID-bound image viewer.
Seed entry uses decimal text and BigInt validation up to `9223372036854775807`;
the server converts the decimal string to an exact integer before forwarding,
and large effective seeds are serialized as strings for browser display. The
updated Mac LaunchAgent was applied and local UI/model-discovery smoke passed.
Public HTTPS still presents the password page and unauthenticated health,
models, tasks and generation APIs return `401`. No authenticated public image
request was made. Evidence and the protected pre-deploy Mac snapshot are in
`.agent/checkpoints/2026-10-08-qwen-image-public-lab-seed-view-redeploy.md`.

## Previous local Qwen image debug UI baseline — 2026-10-07

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

The unconfirmed request from the 2026-10-07 UI restart is historical. Before
the 2026-10-08 source rollout, the bridge reported `idle` and no `sd-server`
process was running; there is no model request currently in flight.
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


## Concurrent VPS subscription accounting Goal — 2026-10-08

See `docs/AMADEUS_VPS_SUBSCRIPTION_ACCOUNTING_GOAL.md`. Status:
`OPERATOR_CLOSED_WITH_ACCEPTED_RESIDUALS; OWNER_DIRECT_QUERY_REPORTED_NORMAL; SUBSCRIPTION_LINKS_24_OF_24_VERIFIED; LEGACY_TOKEN_PRESERVED; RECONCILIATION_UNCALIBRATED`.
The operator reported a normal direct owner query and requested that the
existing token be preserved. Both report Cron jobs remain enabled at 09:30 and
21:30 Asia/Shanghai; the 21:30 execution was still in the future at closure.
The provider/proxy relationship remains uncalibrated, no anomaly is claimed,
and the prior tool-output exposure remains documented. See the Goal and
`.agent/checkpoints/2026-10-08-vps-subscription-accounting-deployment.md` for
evidence. Subscription URLs are not stored in Git.
