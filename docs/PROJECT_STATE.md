# Project State — 2026-10-07

## 2026-10-07 — Amadeus 1.9.7 GPT-only image route deployed

Release source commit `4316946bd3fe` runs on CasaOS machine `nyannyan` as
immutable image
`local/openclaw-amadeus:git-4316946bd3fe-20261007125707` (manifest
`sha256:5244b1f681a33c64cba633095c6529e613dcba0dddf6637213028965a2b806ba`).
The production environment has `AMADEUS_QWEN_IMAGE_LOCAL_ONLY=0` and
`AMADEUS_QWEN_IMAGE_FALLBACK_ENABLED=0`; the existing route overlay is
fail-closed for automatic Qwen fallback. 9Router remains the unchanged sole
`cx/gpt-image-2.5` primary. The operator reported an `arthur-combo` HTTP 408;
no live image request was issued to re-probe it, so the provider timeout remains
unresolved and will surface directly without fallback.

Protected pre-switch checkpoint:
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261007125707` (mode `0700`,
18 backup items). The saved pre-switch Compose names the prior image
`local/openclaw-amadeus:git-e7a815c07114-20261007054830`; the previous `.env`
and runtime state are protected in the same checkpoint. Post-deploy evidence:
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261007125707`.
OpenClaw/Product Radar health, Gateway registration, NAS read-only smoke,
owner notification/outbox and post-deploy maintenance passed. The optional
media-adapter smoke was skipped because the service is absent; managed log
policy returned `warning`. Release evidence:
`.agent/checkpoints/2026-10-07-amadeus-1.9.7-gpt-only-image-release.md`.

The Qwen bridge/token were not modified. The Fun-Acc Goal is paused and its
uncommitted candidate work remains preserved outside the deployed commit.

## 2026-10-07 — 9Router 0.5.95 protected runtime upgrade deployed

Committed source `cb223a0bc9e4a2652acfc012797abd79aedf930c` is running on
CasaOS machine `nyannyan` as immutable image
`local/9router:git-cb223a0bc9e4-20261007T065751Z` (manifest
`sha256:2e5f966f3b063f9d5045e0b75ace38758e9e5e6867505bbb39a2a5a9a1f966e4`).
The npm package is `0.5.95`; its base remains pinned to
`decolua/9router:0.5.75@sha256:7c893bc2c27ecea2ae337abd5eacfec9e5763091b3a3b7862fc0625b770bb156`.
The exact package passed the TTS-style, runtime-policy, and Combo-safety source
patches. Focused tests, secrets scan, isolated image checks, health, expected
host-loopback auth rejection, live GPT Image Combo and runtime-policy checks
passed. The previous image archive is outside Git and SHA-256 verified. The
protected pre-switch backup is
`/DATA/AppData/9router/backups/router-upgrade-20261007T065751Z`; its directory
is mode `0700` and its files are mode `0600`. The existing
`0.0.0.0:20128` container port binding was retained, not changed by this
release. Rollback and evidence:
`.agent/checkpoints/2026-10-07-9router-0.5.95-upgrade.md`.
9Router remains the sole `cx/gpt-image-2.5` primary; Qwen fallback ownership
remains in OpenClaw. Real WhatsApp fallback acceptance remains open.

## 2026-10-07 — Amadeus 1.9.6 cloud-primary/local-Qwen release deployed

Release commit `e7a815c` is running on CasaOS machine `nyannyan` as
`local/openclaw-amadeus:git-e7a815c07114-20261007054830` (image ID
`sha256:ea225fc0ebbc8cd64a340883d16990fa538e3f94fd066ed2f67a849b4d14ec7b`).
9Router remains the sole `cx/gpt-image-2.5` primary; production
`AMADEUS_QWEN_IMAGE_LOCAL_ONLY=0` enables one OpenClaw-owned Qwen fallback for
eligible operational failures. Safety refusals and invalid requests do not
fall back. OpenClaw/Product Radar health, Gateway registration, authenticated
Qwen model discovery, NAS read-only smoke, owner notification/outbox and
post-deploy maintenance passed. Optional media-adapter smoke was skipped
because the adapter is absent; log policy reported a warning. Krea active
source, deployment env and Compose secret mount are retired; external model
files are preserved.

The user confirmed the corrected local-only pose edit looked acceptable, but
the production GPT-failure-to-Qwen WhatsApp path and healthy-primary reference
edit have not been proven end to end. Goal remains open. Protected rollback and
evidence: `.agent/checkpoints/2026-10-07-amadeus-1.9.6-qwen-fallback-release.md`.

## 2026-10-07 — Qwen edit strength corrected before production release

Commit `6b7623e` corrected the bridge's native edit parameter to
`{"strength":0.9}`. The authorized Mac LaunchAgent restart is healthy after
startup asset verification, and the OpenClaw container's authenticated
`/v1/models` request returned HTTP 200. The operator later reported the corrected
local-only pose edit looked acceptable. This was candidate-path validation,
not evidence of the production primary-failure fallback. Protected pre-restart
local copies and recovery details:
`.agent/checkpoints/2026-10-07-qwen-image-edit-strength-restart.md`.

## 2026-10-07 — Qwen local-only OpenClaw candidate before production release

Operator-authorized candidate commit `e0a2217` was briefly running on the
canonical CasaOS host as OpenClaw image
`local/openclaw-amadeus:git-e0a2217f302d-20261006185442`. The temporary
`AMADEUS_QWEN_IMAGE_LOCAL_ONLY=1` switch routes image generation and edits
directly to the authenticated local Qwen bridge; GPT Image is not attempted
for candidate image requests. 9Router remains on the unchanged primary-only
image, and Amadeus is still version 1.9.5, not a release. Health, Gateway
registration, authenticated container-to-bridge reachability and protected
token mode passed. The pre-switch checkpoint is
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261006185442`.
Real WhatsApp image/caption acceptance and the final GPT-primary-to-Qwen
fallback remained pending when this candidate was superseded by the 1.9.6
release above. Evidence:
`.agent/checkpoints/2026-10-07-amadeus-qwen-image-local-only-candidate.md`.

## 2026-10-07 — Qwen edit bridge candidate, OpenClaw not switched

The Qwen-Image-2.1 Uncensored bridge is installed as a separate loopback-only
Mac LaunchAgent with its own protected token. Complete pinned asset/runtime
hash validation, host health, authenticated OpenClaw-container reachability,
and one real single-reference edit through `/v1/images/edits` passed. The
synthetic portrait's pot turned teal in one 768×768 PNG after 398.35 seconds,
visually preserving the blue jacket and scene. The Krea LaunchAgent was absent
at preflight. OpenClaw and 9Router are still the Amadeus 1.9.5 primary-only
baseline; no candidate OpenClaw overlay or release has been deployed. The model
child stopped after about three idle minutes, leaving the bridge healthy and
host memory free at 81%; swap remained elevated near its pre-run level.
Protected rollout, real WhatsApp fallback, and Krea source retirement remain
open. Evidence:
`.agent/checkpoints/2026-10-07-amadeus-qwen-image-bridge-candidate.md`.

## 2026-10-07 — VPS proxy credentials rotated

At the operator's explicit authorization, the one Xray VLESS UUID and the
Hysteria 2 password were regenerated on the VPS. The four subscription bodies
at the existing current token URL were updated; the token and Reality keypair
were not changed. Both proxy services were stopped before the six live files
were atomically replaced, then started with the new credentials. The old
credentials are absent from the live server and subscription files. Candidate
Xray configuration and Hysteria loopback startup tests passed. Both services
are active and listening on TCP/UDP 2053; eight local HTTPS body checks on 443
and 8443 and four public HTTPS checks passed. This does not prove client-side
handshakes; the owner's devices must refresh or re-import their subscription.
Two later 20-second network samples still showed approximately 5.4–6.8 Mbps
of aggregate interface traffic. Successful post-restart Hysteria connections
came from one source IP matching the current SSH egress, but the traffic cannot
be attributed to a device or protocol from these counters alone. Further
isolation is needed if the aggregate usage keeps rising.
The root-only protected checkpoint is
`/root/amadeus-gateway-checkpoints/proxy-credential-rotation-20261007T014956`.
Evidence: `.agent/checkpoints/2026-10-07-vps-proxy-credential-rotation.md`.

## 2026-10-07 — VPS subscription token rotation completed

A new shared random subscription token is active for Clash/Mihomo,
Shadowrocket, and Quantumult X. After the operator's explicit revocation
request, the old token was removed from both Caddy matchers and its subscription
directory was deleted. All four old public links return `404`; all four new
public links return `200`. Local checks also passed for both formats over ports
443 and 8443. Caddy and the subscription responder remain active, and the
Caddyfile is `root:caddy` mode `0640`. Proxy UUIDs and Xray/HY2 client
credentials were not changed; already-imported proxy configurations may still
connect at that stage. The proxy credential rotation above supersedes that
intermediate state. Current URLs remain outside Git in a local `0600` file. Protected
pre-revoke checkpoint:
`/root/amadeus-gateway-checkpoints/subscription-old-url-revocation-20261007T003714`.
Evidence: `.agent/checkpoints/2026-10-07-vps-subscription-old-url-revoked.md`;
the earlier staged checkpoint remains at
`.agent/checkpoints/2026-10-07-vps-subscription-rotation-staged.md`.

## 2026-10-06 — Wild Krea2 local fallback rollout paused

The operator paused the local Krea2 deployment after two real WhatsApp
text-to-image attempts reached the local engine but exceeded the 600-second
image deadline. The previous Amadeus 1.9.5 runtime was restored from the
pre-candidate checkpoints: OpenClaw
`local/openclaw-amadeus:git-0a062a1c2c13-20261005153543` and 9Router
`local/9router:git-0a062a1c2c13-20261005T153458Z`. OpenClaw is healthy, WhatsApp
is connected, the primary route is back on 9Router/GPT, and the Krea bridge plus
the synthetic primary test endpoint are stopped. The candidate source and
external model assets remain preserved for a later optimization pass; no Krea2
release or version bump was made.

## 2026-10-06 — Wild Krea2 local fallback candidate (paused)

The local `ModdiAdam/Wild_Krea-2-turbo_NSFW` Q4_1 transformer is pinned and
hash-verified outside Git with the pinned Metal `stable-diffusion.cpp` runtime,
Qwen3-VL 4B Q4_K_M text encoder, and Wan2.1 VAE. Direct 1024-class generation,
the protected loopback bridge, and OrbStack container-to-bridge requests passed;
the bridge reports one active worker, one queued request, and a 600-second image
deadline. The cold/warm portrait and landscape benchmark completed without OOM;
the host remained responsive and Qwen TTS stayed healthy, although macOS swap
was high after the large model runs.

The active image desired state is one native `cx/gpt-image-2.5` primary. Gemini
image fallback is removed. An OpenClaw-only provider fallback sends
`local/wild-krea2-turbo-nsfw` to the authenticated loopback bridge for eligible
429/5xx/transport failures. Reference-image requests remain fail-closed until a
local edit path is separately proven. Candidate images are
`local/9router:git-2290e8926b70-20261006T095859Z` and
`local/openclaw-amadeus:git-2290e8926b70-20261006100001`; this is not yet a
version release.

The authenticated 9Router primary smoke passed (PNG, 818180 bytes), and a
real owner WhatsApp reference-image request established the activity path but
failed at the Codex entitlement boundary; it correctly did not degrade to
prompt-only Krea generation. A prior synthetic-primary failure produced a valid
local Krea image and claimed one Asset Registry attachment, but it used a CLI
session without an active WhatsApp completion port, so it is not accepted as
the required end-to-end WhatsApp fallback proof. The remaining gate is one
owner WhatsApp text-to-image request while the primary is deliberately made to
return 503, followed by proof of exactly one image primitive, native completion,
and the natural caption.

Protected checkpoints and external evidence:
`/Volumes/Avalon/backups/operation-skuld/amadeus-model-capability/amadeus-image-preapply-20261006T095850Z-70815.json`,
`/DATA/AppData/9router/backups/router-upgrade-20261006T095859Z`,
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261006100422`, and
`/Volumes/Avalon/models/krea2/acceptance/`.

Full candidate evidence: `.agent/checkpoints/2026-10-06-amadeus-krea2-local-fallback-candidate.md`.

## Amadeus 1.9.5 — current live image retry and safety chain

Release commits `adcd431` and `0a062a1` are live in immutable OpenClaw
2026.9.4 image
`local/openclaw-amadeus:git-0a062a1c2c13-20261005153543`; image manifest
`sha256:f1723c78db0f21f4867d2b607b4407d13babb997f41eced25e5628469e9bb80c`.
Runtime `/opt/amadeus/VERSION=1.9.5`. OpenClaw and Product Radar are healthy,
Gateway registration passed, and post-deploy maintenance passed.

The native image generation overlay classifies safety/policy refusals,
account/entitlement failures, invalid requests, and transient provider faults.
Only the transient class receives one bounded retry. The typed failure lifecycle
passes the category to localized Kurisu notices: safety failures suggest a
non-sensitive reformulation and never advise bypassing safeguards; raw upstream
payloads remain suppressed. The 9Router Combo patch returns a safety refusal
without trying the next provider while retaining fallback for ordinary eligible
provider failures.

9Router is live as
`local/9router:git-0a062a1c2c13-20261005T153458Z`; image manifest
`sha256:347a905f925d5b29ea16e950cddc1c2d56fe4cb14ca10560a160534913fdf57e`.
The exact compiled fixture passed the synthetic safety no-fallback check and
the ordinary fallback checks without changing provider or account state.

Focused tests, Amadeus delivery tests, typecheck, secrets scan, BuildKit image
builds, health/smoke, Gateway registration, NAS read-only smoke, owner
notification/outbox smoke, and post-deploy maintenance passed. The optional
media adapter was absent and its network smoke was skipped. No unsafe live
prompt acceptance was performed.

Protected checkpoints:
`/DATA/AppData/9router/backups/router-upgrade-20261005T153458Z` and
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261005153543`; external
deployment evidence is under
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261005153543/`.
Full evidence:
`.agent/checkpoints/2026-10-05-amadeus-1.9.5-image-retry-safety-chain.md`.

## Amadeus 1.9.4 — superseded inbound image reference recovery release

Release commit `5c738c9` repaired model-authored `/media/inbound/` staging path
references before native image generation. Evidence remains in
`.agent/checkpoints/2026-10-04-amadeus-1.9.4-inbound-image-reference-recovery.md`.

## Historical release context retained below

# Project State — 2026-10-04

## Amadeus 1.9.4 — current live inbound image reference recovery release

Release commit `5c738c9` is live in immutable OpenClaw 2026.9.4 image
`local/openclaw-amadeus:git-5c738c9be1ff-20261003190303`; image manifest
`sha256:c5513dc0127a074e047f701f1b9747073d95369903da4c1b25de0f600676b89b`.
Runtime `/opt/amadeus/VERSION=1.9.4`. The affected private-chat image was
successfully downloaded and sent in model context. The failure happened when the
model-authored `image_generate` call reproduced the inbound temporary path with
one separator missing, so native media loading returned `Local media file not
found`.

The plugin now stores the current inbound image path at `message_received`, binds
it to the current image context at `before_dispatch`, and repairs only model
parameters containing `/media/inbound/` immediately before `image_generate`.
Durable generated-image paths are not rewritten, and no image bytes or paths are
logged. Verification passed: the focused inbound-reference tests (2), the full
Amadeus suite (132), `pnpm typecheck:amadeus`, `pnpm check:secrets`, and
`git diff --check`. The BuildKit image build, Gateway registration, OpenClaw and
Product Radar health, NAS read-only smoke, owner notification/outbox smoke, and
post-deploy maintenance passed. The optional media adapter was absent and its
network smoke was skipped; the host Docker default log policy remains a warning.
Protected checkpoint:
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261003190303`; external
evidence is under
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261003190303/`.
Full evidence:
`.agent/checkpoints/2026-10-04-amadeus-1.9.4-inbound-image-reference-recovery.md`.

## Amadeus 1.9.3 — superseded live reply envelope recovery release

Release commit `e2a94af` is live in immutable OpenClaw 2026.9.4 image
`local/openclaw-amadeus:git-e2a94af6def4-20261003182157`; image manifest
`sha256:583f747e0b0a410e1133ea8383c1d6b2b5e95b1010592b40054c74f724a9f698`.
Runtime `/opt/amadeus/VERSION=1.9.3`. A successful image completion had a
legacy `MEDIA:/...` path prepended to a valid v2 typed reply, so the decoder
sent the generic format-error text even though the attachment was delivered.
The decoder now strips only that compatibility prefix, parses the typed
envelope, and never uses the path for asset selection.

Verification passed: 130 Amadeus tests, focused delivery regressions,
typecheck, architecture and delivery-boundary checks, secrets scan, BuildKit
image build, OpenClaw and Product Radar health, Gateway registration, NAS
read-only smoke, owner notification/outbox smoke, and post-deploy maintenance.
The optional media adapter was absent and its network smoke was skipped; the
host Docker default log policy remains a warning. Protected checkpoint:
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261003182157`; external
evidence is under
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261003182157/`.
Full evidence:
`.agent/checkpoints/2026-10-04-amadeus-1.9.3-media-envelope-recovery.md`.

## Amadeus 1.9.2 — superseded live upscale recovery release

Release commit `8e667cf` is live in immutable OpenClaw 2026.9.4 image
`local/openclaw-amadeus:git-8e667cf26122-20261003174442`; image manifest
`sha256:e0a96aea78b62d2598b93f021e2dfc2e9f55411a245401272f9e06015b09c83b`.
Runtime `/opt/amadeus/VERSION=1.9.2`. The host-native ImageAssets service is
running with the pinned Real-ESRGAN MLX engine and default tile size 256.

The observed 2x result (`853x1843 -> 1185x2560`) was a plain multiplier request
that also carried a model-authored `2k` profile, so the service applied its
2560px long-edge cap. A 4x request from `1185x2560` failed in untiled MLX
inference before producing an asset. The plugin now forwards `2k`/`4k` only
when the user explicitly names that profile; ordinary 2x/4x requests preserve
exact multiplier dimensions. Large capped 4x jobs use a bounded x2 inference
pass before the deterministic profile resize, and all large jobs use tiled
inference by default.

Verification produced ready assets for the prior failures: exact 2x
`853x1843 -> 1706x3686`, exact 4x `853x1843 -> 3412x7372`, and capped 4x
`1185x2560 -> 1778x3840` with `engineScale=2`. The source originals remained
unchanged. Focused service tests, 129 Amadeus tests, typecheck, architecture
and delivery-boundary checks, secrets scan, BuildKit image build, OpenClaw and
Product Radar health, Gateway registration, NAS read-only smoke, owner
notification/outbox smoke, and post-deploy maintenance passed.

Protected checkpoint:
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261003174442`; external
evidence is under
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261003174442/`.
Full evidence: `.agent/checkpoints/2026-10-04-amadeus-1.9.2-upscale-recovery.md`.

## Amadeus 1.9.0 — superseded private reply recovery release

Release commit `d43246a` is live in immutable OpenClaw 2026.9.4 image
`local/openclaw-amadeus:git-d43246af1d21-20261003063024`; image ID
`sha256:347056d00ce97a01b40b0335c66753229647fbbf9f2ac070b91f6b007a5f429f`.
Runtime `/opt/amadeus/VERSION=1.9.0`. The 14:22 private VPS status reply was
normal assistant text, but the strict DeliveryEnvelope boundary treated it as
malformed JSON and sent the generic format-error response. The decoder now
recovers safe plain external-user text as a typed text part; protocol-shaped
objects, paths, fenced payloads, control tokens, voice runs and internal origins
remain strict. Protected checkpoint:
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261003063024`; external
evidence is under
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261003063024/`.

Release verification passed: 129 Amadeus tests, focused decoder and reply-hook
regressions, typecheck, architecture and delivery-boundary checks, BuildKit
image build, secrets scan, OpenClaw and Product Radar health, Gateway
registration, NAS read-only smoke, owner notification/outbox smoke, and
post-deploy maintenance. The optional media adapter was absent and its network
smoke was skipped; the host Docker default log policy remains a warning because
`/etc/docker/daemon.json` is absent. Full evidence:
`.agent/checkpoints/2026-10-03-amadeus-1.9.0-plain-reply-recovery.md`.

## Amadeus 1.8.9 — superseded upscale target recovery release

Release commit `f82fb78` is live in immutable OpenClaw 2026.9.4 image
`local/openclaw-amadeus:git-f82fb78b712f-20261003060001`; image ID
`sha256:9902b49c364c093b88621bde1ec9692df846dbb091087cfb64658f8539f90716`.
Runtime `/opt/amadeus/VERSION=1.8.9`. The recent private-chat upscale failures
were caused by model calls putting inbound staged paths or filenames in
`target.imageId`; the service rejected them as `image_id_invalid`. The plugin
now accepts only canonical `img_[0-9a-f]{32}` IDs and otherwise falls back to
the reply/current-conversation image resolver. Protected checkpoint:
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261003060001`; external
evidence is under
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261003060001/`.

Release verification passed: 128 Amadeus tests, focused upscale target
regression, typecheck, architecture and delivery-boundary checks, BuildKit
image build, secrets scan, OpenClaw and Product Radar health, Gateway
registration, NAS read-only smoke, owner notification/outbox smoke, and
post-deploy maintenance. The optional media adapter was absent and its network
smoke was skipped; the host Docker default log policy remains a warning because
`/etc/docker/daemon.json` is absent. Full evidence:
`.agent/checkpoints/2026-10-03-amadeus-1.8.9-upscale-target.md`.

## Amadeus 1.8.8 — superseded private image completion fallback release

Release commit `e4e3498` is live in immutable OpenClaw 2026.9.4 image
`local/openclaw-amadeus:git-e4e3498ba664-20261002162339`; image ID
`sha256:2869cfc03311c84eb95e0cb383d6aa1290d454f9fc086cd055b89c1179bae856`.
Runtime `/opt/amadeus/VERSION=1.8.8`. The private WhatsApp failure showed a
successful image generation followed by a native continuation timeout. The
fallback now transfers an unprepared media claim without hijacking the private
session route, so the generated image remains deliverable and later follow-ups
use their own inbound runs. Protected checkpoint:
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261002162339`; external
evidence is under
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261002162339/`.

Release verification passed: 127 Amadeus tests, typecheck, architecture and
delivery-boundary checks, build, secrets scan, OpenClaw and Product Radar
health, Gateway registration, NAS read-only smoke, owner notification/outbox
smoke, and post-deploy maintenance. The optional media adapter was absent and
its network smoke was skipped; the host Docker default log policy remains a
warning because `/etc/docker/daemon.json` is absent. Full evidence:
`.agent/checkpoints/2026-10-03-amadeus-1.8.8-image-completion-fallback.md`.

## Amadeus 1.8.7 — superseded silent protocol guard release

Release commit `8037979` is live in immutable OpenClaw 2026.9.4 image
`local/openclaw-amadeus:git-8037979fe652-20261002120821`; image ID
`sha256:93b594cf543139fbb8a0927766df65c25ba5079463c80f26ce0eb4847ad49f24`.
Runtime `/opt/amadeus/VERSION=1.8.7`. The typed DeliveryEnvelope decoder now
silences control-token-prefixed uppercase sentinels, and the WhatsApp final
text adapter rejects any control token before provider send. Normal typed text,
voice and image delivery remain unchanged. Protected checkpoint:
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261002120821`; external
evidence is under
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261002120821/`.

Release verification passed: 126 Amadeus tests, typed decoder and pinned
WhatsApp boundary regressions, typecheck/build, architecture checks, secrets
scan, OpenClaw and Product Radar health, Gateway registration, NAS read-only
smoke, owner notification/outbox smoke, and post-deploy maintenance. The
optional media adapter was absent and its network smoke was skipped; the host
Docker default log policy remains a warning because `/etc/docker/daemon.json`
is absent. Full evidence:
`.agent/checkpoints/2026-10-02-amadeus-1.8.7-silent-protocol-guard.md`.

## Amadeus 1.8.4 — superseded unrestricted Kurisu image caption release

Release commit `808678c` (caption behavior implementation `f196b4d`) is on
`main`. The release is live in immutable OpenClaw 2026.9.4 image
`local/openclaw-amadeus:git-808678cdc952-20261002085415`; image ID
`sha256:dc4c9461f1e1ce06db75bba2dab51bf65802bac39bce764f6f88f909580d545a`.
Runtime `/opt/amadeus/VERSION=1.8.4`. Protected checkpoint:
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261002085415`; external
evidence is under
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261002085415/`.

The successful post-generation image caption no longer has an Amadeus
character-count ceiling or a short-caption instruction. The Completion Agent
is asked to let the current Kurisu persona choose wording, detail, tone and
natural length from the generated image. Fallback caption enrichment follows
the same rule. Structured protocol, JSON, path, `MEDIA:` and internal control
token rejection remains in place.

Release verification passed: 125 Amadeus tests, 87 Delivery tests plus the
pinned delivery contract, typecheck/build, secrets scan, image-route authority
and integration preflight, OpenClaw and Product Radar health, Gateway
registration, NAS read-only smoke, owner notification/outbox smoke, and
post-deploy maintenance. The optional media adapter was absent and its network
smoke was skipped; the host Docker default log policy remains a warning because
`/etc/docker/daemon.json` is absent. Full evidence:
`.agent/checkpoints/2026-10-02-amadeus-1.8.4-unrestricted-kurisu-caption.md`.

## Amadeus 1.8.3 — superseded native image completion caption release

Source commits `dfcc7fa`, `66489ff`, `2ae5b6d`, `0565c44` and release commit
`6bde9f9` are on `main`. The release is live in immutable OpenClaw 2026.9.4
image `local/openclaw-amadeus:git-6bde9f91e5f7-20261002081707`; image ID
`sha256:c05ec704c628bb9a735c07426450735b078aeff947447fb4289505e23d478a7b`.
Runtime `/opt/amadeus/VERSION=1.8.3`. Protected checkpoint:
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261002081707`; external
evidence is under
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261002081707/`.

The completion path now imports the trusted generated image before native
continuation, preserves exact `image_generate:<taskId>` provenance, carries
verified image bytes as read-only Completion Agent context through durable
queued handoff, and waits while a handoff is `session_queued`. The native
caption is bound to the existing inline attachment. A real owner WhatsApp
acceptance produced `image_completion_caption_ready` with
`caption_source=native_completion`, one image provider primitive and no
separate completion text send. Failure/malformed/timeout fallback remains
attachment-only and idempotent; unrelated text, voice, TTS/ASR, upscale and
reference-image paths are unchanged.

Release verification passed: 125 Amadeus tests, pinned image-route tests (10),
build/typecheck, secrets scan, plugin/config/skill preflight, OpenClaw and
Product Radar health, Gateway registration, NAS read-only smoke, owner
notification/outbox smoke, and post-deploy maintenance. The optional media
adapter was absent and its network smoke was skipped. Managed Compose log
policies passed; host Docker default log policy remains a warning because
`/etc/docker/daemon.json` is absent. Full evidence:
`.agent/checkpoints/2026-10-02-amadeus-1.8.3-native-image-completion-caption-release.md`.

## Amadeus 1.8.2 — superseded native image completion release

Source commits `e6c31e1` (completion behavior) and `76ece67` (release gate
fixture) are pushed to `main`; `76ece67` is live in immutable OpenClaw 2026.9.4
image `local/openclaw-amadeus:git-76ece6705ee5-20261002065812`. The image ID is
`sha256:c86e41c4d2bdddd9dfb7c70a7b31d3a261bb851efce54571737103d3efda4ea3` and
runtime `/opt/amadeus/VERSION=1.8.2`. OpenClaw health, zero-restart check,
Gateway registration, Product Radar health, NAS read-only smoke, owner outbox
smoke, and protected rollback checkpoint pass.

After a successful ordinary `image_generate`, Amadeus still owns the trusted
generated attachment, Asset Registry, DeliveryEnvelope, 9Router route, and
single channel image send. The completion overlay now clears only native media
primitives and falls through to native `task_completion` / Completion Agent
continuation, preserving native task terminal settlement and the natural
completion reply. The pinned integration test proves one typed completion and
one native continuation with no duplicate native attachment/media primitives.
Voice/TTS/ASR, normal text, upscale/document, reference-image routing, and other
DeliveryEnvelope behavior were left unchanged.

Release verification passed: `pnpm test:amadeus` (124), pinned image-route
tests (10), build/typecheck, secrets scan, plugin/config/skill preflight,
OpenClaw and Product Radar health, Gateway registration, NAS smoke, owner
notification/outbox smoke, and post-deploy maintenance. The optional media
adapter was absent and its network smoke was skipped. Managed Compose log
policies passed; the host Docker default policy remains a warning because
`/etc/docker/daemon.json` is absent. Full evidence:
`.agent/checkpoints/2026-10-02-amadeus-1.8.2-native-image-completion-release.md`.

Protected checkpoint:
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261002065812`; external
evidence:
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261002065812/`.

## Amadeus 1.8.1 — current live structured-reply reliability release

Source commit `2525d38` is pushed to `main` and live in immutable OpenClaw
2026.9.4 image `local/openclaw-amadeus:git-2525d3892169-20261002063108`, image
ID `sha256:6d9b88d0f53664e58504ebbce1b8e7fbe647f9bf3f42ac7876d7d20edf447e77`.
Runtime `/opt/amadeus/VERSION=1.8.1`; OpenClaw health, Gateway registration,
Product Radar health, NAS read-only smoke, owner outbox smoke, and protected
rollback checkpoint pass. The checkpoint is
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261002063108`; external
evidence is under
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261002063108/`.

Malformed external structured Agent replies now settle through a bounded visible
fallback instead of being silently dropped. Literal control characters inside
JSON strings are repaired before strict validation; malformed protocol text is
never echoed or logged. Safe run correlation metadata is recorded, while trusted
internal origins remain silent. The existing `nine_router/arthur-combo` route
continues to serve the agent/tool loop; web search provider selection remains a
separate retrieval configuration. Full evidence:
`.agent/checkpoints/2026-10-02-amadeus-1.8.1-structured-reply-release.md`.

## Amadeus 1.8.0 — superseded reference-image route release

Source commit `2244f98` is pushed to `main` and live in immutable OpenClaw
2026.9.4 image `local/openclaw-amadeus:git-2244f98140e0-20261001145719`, image
ID `sha256:c418bc6397c713c401ed9bc060542d3464318c4c1f6cb9c6b1b38f14ce8c4e35`.
Runtime `/opt/amadeus/VERSION=1.8.0`; OpenClaw health, Gateway registration,
Product Radar health, and protected rollback checkpoint pass. The checkpoint is
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261001145719` (directory
0700, manifests 0600); external evidence is under
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261001145719/`.

The 1.7.9 reference-image failure root cause was the missing 9Router
`/api/v1/images/edits` route: OpenClaw sent multipart edits while live 9Router
0.5.91 exposes only `/api/v1/images/generations`. A content-free multipart
probe reproduced the HTTP 500/Next.js Server Action error. 1.8.0 adapts one
PNG/JPEG/WebP reference (<=10 MiB) into the existing logical JSON generations
contract. Codex receives `input_image`; the Gemini fallback receives
`inlineData`; the original bytes are preserved. Multi-reference input fails
closed before admission. No 9Router source/account/credential/Combo change was
made; other providers retain native multipart edits.

Focused route tests (9), exact compiled 9Router byte-preservation fixture,
live post-deploy fixture, canonical Combo verification, build/typecheck/tests,
secrets, health, Gateway registration, NAS smoke, owner outbox, and maintenance
passed. Live fixture:
`LIVE_REFERENCE_ROUTE_FIXTURE=passed route=openai/amadeus-image bytes=preserved multi_reference=blocked http_requests=0`.
No post-switch route invariant/transport/Server Action error was observed. No
paid reference-image transport smoke or manual owner WhatsApp reference-image
acceptance was performed; that is the only pending manual acceptance. No
cross-restart exactly-once claim is made. Full evidence:
`.agent/checkpoints/2026-10-01-amadeus-1.8.0-reference-route-deploy.md`.

## Amadeus 1.7.8 — superseded image-generation repair (historical)

Source commit `9f23572` was pushed to `main` and was live in immutable OpenClaw 2026.9.4
image `local/openclaw-amadeus:git-9f2357210a07-20261001112610`, image ID
`sha256:c5c1b2d410e25b98bb71c7bf6212699f35b5a8714141c297d8bd0522143d624e`.
Runtime `/opt/amadeus/VERSION=1.7.8`, container/OpenClaw health, Product Radar
health, and Gateway Amadeus registration pass. Protected rollback checkpoint:
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261001112610` (directory 0700,
manifest 0600); content-safe evidence:
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261001112610/`.

After 1.7.7, the owner retried image generation and it failed again. Safe logs
confirmed its `before_tool_call` handler fired but OpenClaw's pinned shallow
merge preserved the omitted `model` key. 1.7.8 writes a blank sentinel, which
the native image tool parses as no override and resolves to configured
`openai/amadeus-image`/fallback. The same task's language stayed unknown because
`event.body` could be present but blank, blocking fallback to non-empty
`event.content`; 1.7.8 selects the first non-empty field. The provider response
contained no safe parameter name, so no more specific invalid field is claimed.
No private prompt/message/image contents are retained.

Pre-apply gates passed: `pnpm test:delivery` (84 plus pinned integration),
`pnpm test:amadeus` (121), typecheck/build, architecture/fixture checks, version,
secrets, and `git diff --check`. OpenClaw/Product Radar health, plugin
registration, NAS read-only smoke, owner notification/outbox smoke, and
post-deploy maintenance passed. The optional media adapter was absent; its
network smoke was skipped. Host Docker default log policy remains a warning;
managed Compose policies are bounded.

No new paid image-generation transport smoke or manual owner WhatsApp acceptance
was performed after 1.7.8. Automated verification is not real-channel
acceptance; no cross-restart exactly-once claim is made. Detailed evidence:
`.agent/checkpoints/2026-10-01-amadeus-1.7.8-image-route-repair.md`.

## Amadeus 1.7.7 — interim attempt, superseded after retry failed

Commit `79577cc` deployed as
`local/openclaw-amadeus:git-79577cc27dfc-20261001110629`; health and automated
gates passed, but owner retry reproduced the generation failure because omitted
hook params did not delete the original model field. The runtime was not rolled
back; the blank-sentinel correction was deployed as 1.7.8. Evidence:
`.agent/checkpoints/2026-10-01-amadeus-1.7.7-image-route-repair.md`.

## Amadeus 1.7.6 — prior delivery-boundary repair

Source commit `092b262` was deployed in image
`local/openclaw-amadeus:git-092b262332b7-20261001102103`; its final WhatsApp
callback re-runs strict typed preparation when OpenClaw bypasses `preparePayload`.
It was superseded by the later image-generation fixes. Evidence:
`.agent/checkpoints/2026-10-01-amadeus-1.7.6-whatsapp-final-delivery-release.md`.

## Amadeus image persona 1.7.5 — prior rollout evidence, not current runtime

The earlier final-release record describes immutable image
`local/openclaw-amadeus:git-5444b3a94a82-20261001073247`, original-request
context and caption automation. It remains historical evidence only; a later
read-only audit found production had reverted to the 1.7.4 rollback image. The
1.7.5 manual owner WhatsApp/image-experience acceptance was waived and not
performed. Evidence:
`.agent/checkpoints/2026-10-01-amadeus-image-persona-1.7.5-final-release.md`.

## Qwen3-TTS MLX production rebaseline — applied, Gate A–G passed

Runtime rebaseline, destructive retirement cleanup, final state documentation,
and push to canonical `main` are complete. Implementation/deployment source
commit `0fdfdbb`, source cleanup commit `45f96a9`, and content-safe evidence
commit `46d0b49` are pushed to `main`.
Amadeus `VERSION=1.7.4` was not bumped.

M204 now runs only the authenticated Qwen3-TTS MLX 1.7B Base / MLX 8-bit
`mlx-audio` 0.5.6 local engine through `com.amadeus.qwen3-tts` on loopback
`127.0.0.1:18794`, using the unchanged 46s original A `kurisu-v1` reference
and Auto language. Port `18792` remains the separate ImageAssets service; this
live collision and its protected rollback evidence are documented in the active
Goal. 9Router's single `amadeus-tts` connection points to its loopback TTS
bridge and reports local Qwen3 MLX → Qwen Audio 3.1 → Qwen Audio 3.0. The live
immutable 9Router image is
`local/9router:git-0fdfdbbd91f2-20260930T211901Z`
(`sha256:c6c2bf40c95d62a49c14cd7ec7c8188002a35352bedc7cc911397e857f1caf7b`).
OpenClaw and Product Radar were not rebuilt or restarted for this Goal; the
ImageAssets endpoint stayed unchanged.

GPT-SoVITS and OminiX resident/runtime/model/venv/tuner/LaunchAgent/active
source assets and legacy 9Router provider connections have been removed after
the automated gates passed. The original Kurisu A profile remains protected
outside Git. The sole Kurisu WAV sample from the retired package is archived
outside Git at
`/Volumes/Avalon/backups/operation-skuld/amadeus-kurisu-wav-archive-20261001`;
manifest SHA-256:
`e1362946d7d04abb4d22faa4ed65e93acbeb97045445c955992ebfd58e75a6c9`.

Focused service/provision/bridge tests, Amadeus tests/typecheck/build, pinned
MLX asset verification, direct WAV/MP3 synthesis, unauthorized-auth rejection,
logical 9Router route, forced Qwen Audio 3.1 fallback, synthetic 3.0 ordering,
restart/health, secrets scan, source search and `git diff --check` passed. The
controlled local-busy test used the live cloud 3.1 endpoint; the local service
remained healthy. Memory pressure and post-warmup footprint were recorded. The
owner explicitly waived human listening/WhatsApp acceptance; none is claimed.
Detailed content-safe evidence is in
`.agent/checkpoints/2026-10-01-amadeus-qwen3-tts-mlx-rebaseline.md`.

## TTS default-only local-first policy — deployed and verified

Commit `5013800` is deployed in immutable 9Router image
`local/9router:git-5013800c8de2-20261001T045604Z`
(`sha256:816eb335fb382a3d1b2ad0e4bb62d0aa3e43cf9c318fe230ecdf78fba4ce425f`).
The owner-requested behavior is active: all valid styles/emotions normalize to
`default`, every request tries local Qwen3 MLX first, and only operational local
failure reaches cloud Qwen Audio 3.1 → 3.0. The source preserves emotion
instructions behind `AMADEUS_TTS_EMOTIONS_ENABLED`; the live Compose value is
false and bridge health reports it disabled. A non-default `angry` smoke
returned local Qwen MLX audio with no cloud fallback. ASR, OpenClaw, ImageAssets,
model/profile, credentials and voice IDs are unchanged. The follow-up task and
evidence are in `.agent/tasks/2026-10-01-amadeus-tts-default-only-policy.md`
and `.agent/checkpoints/2026-10-01-amadeus-tts-default-only-policy.md`.

## Image generation lifecycle + Kurisu caption UX — candidate applied; owner Gates A–F accepted

Source commits `1dd9dd2` (lifecycle/caption implementation) and `628703c` (Kurisu caption wording refinement)
are pushed to `main`. Amadeus VERSION remains `1.7.4`; no release bump was performed. Authorized candidate
apply uses immutable OpenClaw 2026.9.4 image
`local/openclaw-amadeus:git-628703c803e7-20260930184906`, image ID
`sha256:849311277404f7454adaaed3cbcdbf0678e4f92112adb2ff7cdfa8a4738a96f9` (ARM64). OpenClaw and
Product Radar health, Amadeus registration, NAS read-only smoke and candidate owner outbox smoke passed.
The protected external rollback checkpoint is
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930184906`; content-safe deployment evidence is under
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260930184906/`.

One pinned OpenClaw integration binds accepted to `notifyMediaGenerationAsyncTaskStarted` after detached
task scheduling and success/failure to the authoritative typed `wakeMediaGenerationTaskCompletion(params)`
status. Persisted generated `attachments[]` remain the only image authority. Kurisu's caption prompt now
allows natural free-form wording without a fixed word-count target; `AttachmentPart.caption` still obeys the
native provider maximum of 1024 characters. The captioner sees the verified registry image and workspace
persona; caption errors use a deterministic fallback and cannot block image settlement. WhatsApp uses one
native image send with caption; Telegram uses native `sendPhoto` caption. The image-generation Skill keeps
an accepted interim Agent reply silent so it does not duplicate the lifecycle acknowledgement.

Source checks passed: `pnpm workflow:plan`, `pnpm test:delivery` (66 focused tests including exact pinned
source integration), `pnpm test:amadeus` (100 tests), `pnpm typecheck:amadeus`, `pnpm build:amadeus`,
`git diff --check`, `pnpm check:secrets`, and `pnpm check:architecture`. The deployment workflow rebuilt the
OpenClaw image on the host; Product Radar reused its unchanged image. `media-organizer-adapter` was absent
before apply and was not restored; its optional network check was skipped.

The owner directly attested in chat on 2026-10-01, “真是AF全部通过”, confirming real WhatsApp owner Gates
A–F passed after candidate deployment. This owner attestation, rather than the deployment notification/outbox
smoke, is the acceptance evidence; no private chat contents/screenshots are retained. Detailed status is in
`.agent/checkpoints/2026-10-01-amadeus-image-generation-lifecycle-caption-candidate-applied.md`.
Task coordinator and delivery settlement are bounded process-local state, not a durable cross-restart
exactly-once journal; no stronger restart/replay claim is made.

## 9Router 0.5.91 upgrade and strict GPT Image account — deployed

Independent of the pending OpenClaw DeliveryEnvelope release, CasaOS 9Router
runs immutable image `local/9router:git-499d53576169-20260930T071137Z`
from committed source `499d535`. `codex/gpt-image-2.5` now admits only the
configured owner email even when other Codex connections remain enabled.
The permitted account returned a usage-limit `429` in one authenticated live
smoke; the router reported one permitted account locked and generated via the
existing Gemini model fallback. No other Codex account was used. The Next.js
standalone Server Actions body limit is `20mb`; a real >1 MB action upload has
not yet been exercised. Sixteen account definitions, all aliases, and the
`amadeus-image` Combo were preserved. Upgrade/policy checkpoints and rollback
are in `.agent/checkpoints/2026-09-30-9router-0.5.91-image-account.md`.


## Amadeus image generation background completion — prior corrective candidate (2026-09-30; superseded)

The 2026-09-30 corrective candidate used immutable image
`local/openclaw-amadeus:git-d7f2847d82f4-20260930154020`, built from committed
source `d7f2847d82f4f1dc15f84589a8a5907890992cae`. It was superseded by the
2026-10-01 lifecycle/caption candidate above. This prior candidate's OpenClaw/Product Radar health, Amadeus registration, NAS read-only and owner
outbox smokes passed at that time. Protected checkpoint:
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930154020`. Deployment
evidence path:
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260930154020/deployment-summary.md`.
This was a candidate apply, not a version release or owner-channel acceptance.

The corrective source was committed in `351b33e` and the exact-pinned handler
integration test in `8533713`. OpenClaw 2026.9.4's
`wakeMediaGenerationTaskCompletion(params)` has `status`, `handle`, and the
authoritative generated attachments/media URLs before it builds and hands off
the `task_completion` event. The version/digest-pinned bridge claims successful
WhatsApp/Telegram `image_generation` attachments there, before the completion
Agent. Amadeus imports the trusted attachment into the existing host image
registry, creates an inline DeliveryEnvelope v2 attachment, and settles through
the single delivery ledger and channel adapter. Native competing completion is
reported delivered only after this typed handoff/settlement succeeds; bridge
errors throw instead of silently cancelling. The async tool-start receipt is
not considered a generated image.

`pnpm workflow:plan`, `pnpm test:delivery` (including execution of the exact
pinned handler integration), `pnpm test:amadeus`, `pnpm typecheck:amadeus`,
`pnpm build:amadeus`, `git diff --check`, and `pnpm check:secrets` passed before
apply. Real owner WhatsApp tests for fallback success, LLM-independent delivery,
retry behavior, subsequent upscale, document integrity and text/voice regressions
remain required; the image-generation Goal is open until those gates have real
evidence. See `.agent/checkpoints/2026-09-30-image-background-completion-candidate.md`.

## Upscale default changed to 2x — candidate applied

The requested 2x default is deployed in both runtime boundaries. OpenClaw uses
`local/openclaw-amadeus:git-d7f2847d82f4-20260930154020`; the host image service
LaunchAgent was updated from Git source and is running/healthy. Runtime code
verification confirms omitted scale -> 2 and explicit scale 4 -> 4. The Amadeus
plugin defaults to 2 from trusted current-turn metadata and preserves explicit
user 4x; model-proposed 4x cannot override the default. No actual image was
upscaled as a production smoke. Protected rollback points and evidence are in
`.agent/checkpoints/2026-09-30-upscale-default2-candidate-applied.md`.

## DeliveryEnvelope v2 earlier source/rollback history (audit only)

Git source now defines one v2 typed user-facing settlement across text, voice and
registered image attachments. The retired text/voice-only contract and the two
JSON/document workaround scripts are removed from source. The source 2026.9.4
WhatsApp plan integration is an exact version/digest-pinned **single AST function
boundary**, not a multi-bundle JSON sanitizer or disposition hint chain.

**This is not production acceptance.** The first authorized candidate apply built
a new immutable image but stopped before the Compose switch because the pinned
container Node private-glibc environment could not execute npm via its shebang.
The old config was restored from protected checkpoint
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930074729`; the live
container remains the previous healthy immutable image. The source installer
was corrected and the next retry requires a new committed image/checkpoint.
See `.agent/checkpoints/2026-09-30-delivery-envelope-first-apply-failure.md`.

A second authorized candidate built and installed the typed WhatsApp boundary,
but non-root plugin inspection found the Amadeus image bundle unreadable (0600
root) before Compose switch. Protected checkpoint
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930080024` restored all
affected definitions/config and the previous WhatsApp module; the old image
remains healthy. The source build/image now set code artifact permissions 0644
and explicitly verify uid-1000 readability before a runtime write. Evidence:
`.agent/checkpoints/2026-09-30-delivery-envelope-second-apply-failure.md`.

The third candidate passed non-root readability and pinned module install but
stopped before switch at an out-of-process CLI inspector that also fails on the
previous healthy image. The Gateway's own startup log shows Amadeus registered
in that baseline. Checkpoint
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930081212` restored all
staged definitions and previous WhatsApp module; the source now gates on real
Gateway registration immediately after health. Evidence:
`.agent/checkpoints/2026-09-30-delivery-envelope-third-apply-failure.md`.

The fourth candidate also stopped before switch when the offline Skill CLI
omitted Amadeus; uid-1000 inspection of that exact image verified all 14
manifest-declared Skills and 27 tool declarations. Protected checkpoint
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930084057` restored
staged definitions and the previous WhatsApp module. The next candidate checks
bundle/Skill readability before switching, then real Gateway registration and
health immediately afterward. Evidence:
`.agent/checkpoints/2026-09-30-delivery-envelope-fourth-apply-failure.md`.

A fifth candidate briefly replaced OpenClaw but had no real Amadeus
registration, so the previous immutable image/config/module were restored from
checkpoint `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930085757`.
After restart, the old image also lacked Amadeus because a persisted SQLite
plugin index contained 63 entries without it. A separately protected,
consistent DB backup precedes the official registry refresh; the rebuilt
64-entry index includes Amadeus with no diagnostic. The old Gateway then
registered Amadeus twice on startup, its Skills returned, and health passed.
Source deployment now backs up this SQLite state and refreshes the index
before strict candidate plugin/Skill and post-switch Gateway gates. Evidence:
`.agent/checkpoints/2026-09-30-amadeus-plugin-registry-recovery.md`.

The previous immutable image and each failed attempt's protected runtime
snapshot remain external rollback evidence; they are not the current
production code path or a compatibility fallback.

# Historical Project State — 2026-09-29

## 2026-09-29 Amadeus image assets and on-demand upscale — deployed; owner-channel acceptance pending

The host-native image asset service is installed as launchd label
`com.amadeus.image-assets` and reports Apple MLX readiness on port `18792`.
The default Mac-local asset root, registry, model cache and token paths are
derived from the active `$HOME` host profile; no username or absolute personal
path is encoded in Git. The external volume remains an explicit override after
launchd write access is verified.

Source commits `849041e`, `d745e4f`, `6210c70`, and `7175240` add the opaque
`imageId` registry, native generation-result correlation, explicit-only
`amadeus_image_upscale`, Apple Silicon `realesrgan-mlx` runtime, CasaOS
read-only mount, and deployment Compose-path propagation. OpenClaw 1.7.4 is
healthy at image
`local/openclaw-amadeus:git-6210c70b0ca6-20260929215321`; the candidate
Compose environment is verified against the live host asset root and token.

Host acceptance passed for realistic 2x, anime 2x, explicit anime 4x, manual
`imageId`, authenticated controlled media reads, unauthenticated `401`, host
service restart durability, and OpenClaw container recreate durability. The
protected deployment checkpoints are
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260929215321` and the
candidate refresh
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260929215636`; post-deploy
evidence is retained under the matching external-volume deployment paths.

The remaining gate is a real owner WhatsApp inbound turn. Synthetic CLI runs
deliver through WhatsApp but lack trusted inbound sender metadata and therefore
see only the safe web tools; production sender policy was not weakened to make
the CLI probe pass. Do not claim owner-channel image-generation/upscale
acceptance until the owner sends a real inbound request and the reply/asset
correlation is recorded.

## 2026-09-29 Kurisu GPT-SoVITS v2Pro MPS production cutover — applied; owner acceptance pending

The production `amadeus-tts` cutover is applied from source commit `606270b`.
GPT-SoVITS v2Pro MPS is the only resident local TTS: the API listens on
loopback `127.0.0.1:19870` and the authenticated production adapter listens on
`127.0.0.1:19871`. The live bridge primary smoke returned
`X-Amadeus-TTS-Provider: gpt-sovits-mps` with valid MP3 audio. During a
controlled adapter stop, the same bridge returned valid cloud audio and the
container audit recorded `qwen-audio-3.1-tts-flash` as attempt 1 with
`provider_unavailable`; the executable bridge test records the exact
`qwen-audio-3.1-tts-flash` -> `qwen-audio-3.0-tts-flash` ordering.

The OminiX `com.amadeus.qwen3-tts` LaunchAgent is uninstalled and ports
`:18792` and `:18793` have no listeners. The complete rollback checkpoint is
retained at
`/Volumes/Avalon/backups/operation-skuld/kurisu-gpt-sovits-cutover-20260929T164028Z`;
its 2823-file manifest verifies with no missing, changed or symlinked entries.
Warm direct synthesis measured 2.581646 seconds for 3.312 seconds of audio
(RTF 0.7795); swap remained at 2202 MiB while sampled free memory was 62–78%.
All post-apply evidence is under
`/Volumes/Avalon/backups/operation-skuld/kurisu-gpt-sovits-cutover-postapply-20260929T171128Z/`.

On 2026-09-29 the latest active reference was changed through the
source-controlled MPS manager to
`WAV/crs_0695.WAV_0000000000_0000224000.wav`, using its matching dataset
transcript `裸の得意点が作れていないなら、つまり被験者はブラックホールに放り込まれるのと同じだから。`.
The source change is commit `fa434dc`, applied with
`infra/macos/manage-kurisu-gpt-sovits-tts.sh --apply`. Per owner request, the
active model directory retains only this one reference WAV alongside the
GPT-SoVITS weights. The previous active `crs_0274` WAV, before-change plist,
live health and final synthesis are retained in protected rollback/evidence at
`/Volumes/Avalon/backups/operation-skuld/kurisu-gpt-sovits-reference-20260929T200040Z-0695/`.
The earlier `crs_1373`, `crs_2263` and `crs_0274` reference evidence remains in
their respective external checkpoints. The NLTK `cmudict` and
`averaged_perceptron_tagger_eng` resources remain installed under the declared
`NLTK_DATA` runtime path.

The Goal remains open as `WAITING_FOR_OWNER_CHANNEL_ACCEPTANCE`. The owner
still needs to verify the real production voice turn for Japanese
pronunciation, Kurisu identity, visible text behavior and typed-text
isolation. MLX conversion remains a later independent Goal.

## 2026-09-29 Kurisu GPT-SoVITS v2Pro PoC — accepted for further integration

At the PoC checkpoint time, the isolated `bysq/TTS-KurisuMakise` v2Pro candidate loaded on MPS and passed
Japanese synthesis. An 8-line identical-text A/B set against the direct
`qwen-audio-3.1-tts-flash` model-bound voice, plus a five-run warm benchmark,
remain outside Git under
`/Volumes/Avalon/backups/operation-skuld/kurisu-gpt-sovits-poc-20260929/`.
The candidate then listened only on loopback `127.0.0.1:19870`; it was not
managed by launchd and had not been added to production routing. Production
`com.amadeus.qwen3-tts` was healthy at that checkpoint on PID `18387`, ports
`18792`/`18793`, and its Phase 0 file hashes were unchanged. The owner listened to the paired
files and judged `GPT-SoVITS 明显比 Qwen 3.1 更像牧濑红莉栖，Gate B 通过。`
The outcome was `ACCEPTED_FOR_FURTHER_INTEGRATION`; the MPS runtime and all
external evidence remain retained. The next planned Goal was
`docs/AMADEUS_KURISU_GPT_SOVITS_MPS_PRODUCTION_CUTOVER_GOAL.md`.
MLX conversion is deferred to a later independent optimization Goal.
Evidence and rollback scope are recorded in
`.agent/checkpoints/2026-09-29-amadeus-kurisu-gpt-sovits-poc-ab.md`.

## 2026-09-29 Qwen Audio TTS default pure voice clone — deployed

The cloud `default` request is now a pure voice-clone baseline. The bridge
sends only `text`, model-bound `voice`, `format`, `sample_rate`, and Japanese
`language_hints`; it omits instruction/persona/style, speed, and pitch.
Non-default emotions append the bounded emotion instruction.

Source commit `cc1ebfd` is deployed as
`local/9router:git-cc1ebfdeec3b-20260929T081836Z`. Focused bridge tests,
syntax checks, dry-run smoke, secrets scan, all three speech health checks,
and a real cloud default MP3 synthesis passed. The protected rollback
checkpoint is `/DATA/AppData/9router/backups/qwen-audio-tts-deploy-20260929T081836Z`;
source evidence is `.agent/checkpoints/2026-09-29-amadeus-qwen-audio-tts-default-pure-clone.md`.

# Project State — 2026-09-29

## 2026-09-29 Qwen Audio TTS model fallback — deployed

The protected `amadeus-tts` bridge now uses the bounded order
`qwen-audio-3.1-tts-flash` → `qwen-audio-3.0-tts-flash` → M204 OminiX local
fallback. The 3.1 and 3.0 cloned voices are separate protected files because
voice enrollment is model-bound. Source commit `13cbd55` is deployed as
`local/9router:git-13cbd559ab24-20260929T062044Z`; OpenClaw and ASR remain
unchanged.

3.1 voice enrollment from the authorized 46-second sample, four-case direct
cloud smoke, protected runtime preparation, live cloud bridge smoke, health/auth
checks, and the protected deployment checkpoint all passed. The temporary
`audio.nyannyan.top` Caddy/frp sample route was removed after enrollment; its
Cloudflare DNS record must be removed separately if it remains.

The protected deployment checkpoint is
`/DATA/AppData/9router/backups/qwen-audio-tts-deploy-20260929T062044Z`; the
dated source checkpoint is
`.agent/checkpoints/2026-09-29-amadeus-qwen-audio-tts-model-fallback.md`.

## 2026-09-29 Qwen Audio TTS cloud primary — owner accepted

The Qwen Audio TTS Goal is complete. Source commits `13ca03f` and `9347de1`
add the protected voice provisioning flow, the OpenAI-compatible 9Router
adapter, cloud-first `qwen-audio-3.0-tts-flash` synthesis, and one bounded
M204 OminiX fallback. The deployed 9Router image is
`local/9router:git-13ca03fa6fe0-20260929T051222Z`; OpenClaw remains on the
existing healthy `local/openclaw-amadeus:git-9e30a3dc08e8-20260928171059`
image. No second Agent/runtime or second resident local TTS model was added,
and the existing ASR route remains unchanged.

The protected 46-second reference and cloned voice identity stay outside Git.
Direct cloud smoke passed for the supported emotion cases and formats. The
real owner WhatsApp acceptance passed for all three required cases: typed
explicit voice produced one playable cloud media reply, ordinary typed text
produced no speech request and no media, and an inbound `audio/ogg; codecs=opus`
voice note produced one playable cloud media reply. No fallback was used in
these acceptance turns. The owner confirmed playback. The CLI
`openclaw agent --deliver` path is explicitly excluded from acceptance because
it bypasses the WhatsApp TTS lifecycle.

The protected deployment checkpoint is
`/DATA/AppData/9router/backups/qwen-audio-tts-deploy-20260929T051222Z`; the
owner acceptance evidence is
`/DATA/AppData/9router/backups/qwen-audio-tts-owner-acceptance-20260929T054329Z/evidence.json`.
The dated source checkpoint is
`.agent/checkpoints/2026-09-29-amadeus-qwen-audio-tts-cloud-release.md`.

## 2026-09-28 typed voice semantic modality heartbeat isolation — candidate live

Commit `bce1cc6` is pushed to `origin/main` and deployed as
`local/openclaw-amadeus:git-bce1cc67fc8a-20260928054649` on M204 OrbStack
`nyannyan`. Runtime SQLite/transcript evidence showed the reported private
message came from the 13:04 and 13:34 OpenClaw heartbeat polls, not an
inbound user message. Those turns carry native
`inputProvenance.kind=internal_system`, but the prior hook treated every
WhatsApp turn as typed input and caused `[[amadeus:reply-modality=default]]`
to prefix `NO_REPLY`, bypassing the core exact-token suppression.

The hook now injects typed reply modality only for
`inputProvenance.kind=external_user`. A marked `NO_REPLY` is also removed
before WhatsApp delivery as a narrow fail-closed guard. Existing inbound voice
lease handling and the sole voice-reply Skill are unchanged. Focused tests,
Amadeus tests, OpenClaw patch fixtures, architecture, secrets and build passed;
candidate health, Product Radar health and NAS read-only smoke passed. The
protected rollback checkpoint is
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260928054649`; post-deploy
evidence is under
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260928054649`.
The same heartbeat job was manually run after deployment. Its transcript
returned exact plain `NO_REPLY`, and the post-restart WhatsApp log contained no
outbound send for that run. Evidence:
`.agent/checkpoints/2026-09-28-typed-voice-heartbeat-isolation-candidate-live.md`.

## 2026-09-28 typed voice semantic modality candidate — owner-accepted

Commit `235387f` is pushed to `origin/main` and deployed as
`local/openclaw-amadeus:git-235387f23d2e-20260928043207` on M204 OrbStack
`nyannyan`. The previous fixed typed-text classifier was removed. Each typed
WhatsApp turn initializes a turn-scoped `replyModality=default`; the same
Agent turn semantically chooses `voice` or `default` and emits hidden control
metadata. The pinned OpenClaw TTS/WhatsApp patch records that metadata for the
current run/session, strips it globally before delivery, gates missing-marker recovery
on `voice`, and clears it at `agent_end`/TTL. The existing verified inbound
voice lease and sole `voice-reply` Skill remain unchanged.

The protected rollback checkpoint is
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260928043207`; health,
Product Radar, NAS read-only smoke, and WhatsApp linked/connected checks
passed. Focused tests, Amadeus full tests, OpenClaw 2026.9.4 patch fixtures,
architecture, secrets, and build passed. The owner confirmed the post-deploy
WhatsApp text and voice behavior is normal. Evidence:
`.agent/checkpoints/2026-09-28-typed-voice-semantic-modality-candidate-live.md`.

## Amadeus 1.6.5 model-capability adapter release — owner-accepted

Amadeus 1.6.5 is deployed on M204 OrbStack `nyannyan` with healthy immutable
OpenClaw image `local/openclaw-amadeus:git-fb7dd742b609-20260927142412`.
The owner confirmed the final repaired typed-to-voice behavior: one audio
attachment plus visible text in the exact `中文：...` / `日本語：...` format.

OpenClaw uses only the logical `openai/amadeus-image` capability. 9Router owns
strict GPT Image 2.5 → Gemini 3.1 Flash Image fallback; its Combo was
provisioned and reconciled through the existing management API, without source
or database edits. `arthur-combo`, `amadeus-asr`, `amadeus-tts`, `kurisu-v1`,
MP3, tagged TTS limits, global sensitive-tool denials, group admission and
unrelated service permissions remain preserved. Group image access is limited
to the existing admitted WhatsApp/Telegram groups plus the native
`image_generate` capability; direct non-owner access remains web-only.

Release gates, protected checkpoint, owner notification, health/smoke, real
transport/fallback evidence and post-deploy evidence are recorded in
`.agent/checkpoints/2026-09-27-amadeus-model-capability-final-release.md`.
The known pinned 9Router caveat remains: upstream HTTP 400 is
fallback-eligible, while missing-prompt 400 is rejected before Combo
 dispatch; no 9Router source change was introduced. The Goal is complete.

## Source and architecture

- Canonical `origin/main` contains the prior 1.6.4 released source and the new adapter Goal plan. Candidate source is on `codex/model-capability-adapter-2026-09`; its live image is not yet a final release. Keep source branch, candidate image tag, and release version distinct.
- OpenClaw 2026.9.4 is the **sole Agent runtime**. Native Amadeus/PUBG plugins, deterministic domain/presentation and one owner outbox remain; no retired runtime, keyword router, custom image provider, or sender fallback was introduced.

## Live release and rollback

- Previous released OpenClaw on M204 OrbStack `nyannyan` CasaOS: `local/openclaw-amadeus:git-b389e869d6a2-20260927084301` (Amadeus 1.6.4); Product Radar `local/product-radar:git-d988000e1c5d-20260924130631`; post-deploy OpenClaw and Product Radar health passed. WhatsApp remains linked. The protected pre-1.6.4 OpenClaw checkpoint is `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260927084301` (root chmod 0700; config copy 0600); post-deploy evidence is `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260927084301`. The 1.6.3 checkpoint `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260927082000` remains available. Preserve both for rollback.
- The previous released OpenClaw config had default image-generation model `openai/ag/gemini-3.1-flash-image`, a 180-second timeout, and the owner-approved shared `browser.ssrfPolicy.dangerouslyAllowPrivateNetwork=true` opt-in. It reuses the existing `OPENCLAW_9ROUTER_API_KEY` SecretRef/env source. No Google key/path was added. The owner confirmed real image-generation acceptance on 2026-09-27; see the acceptance record below.
- The **same** Mac `com.amadeus.qwen3-tts` LaunchAgent serves the original A (~46s) reference with pinned community MLX 1.7B Base 8-bit ICL, `language=Auto`, one bounded inference worker and `ProcessType=Interactive`. Post-1.6.4 read-only host health is HTTP 200/ready, LaunchAgent PID 50062, last exit 0. The matrix process PID 79839 is no longer present. No TTS service restart occurred; preserve the exact MPS rollback.
- The owner previously accepted real WhatsApp Japanese PTT/nonduplicated visible text/typed-without-voice and confirmed no pronunciation/naturalness/volume/rhythm anomaly after 1.6.2. This remains prior evidence, not post-1.6.3 acceptance.

## 1.6.4 image-generation rollout — owner-accepted

- The previous released 1.6.4 config had the native `image_generate` default path through the existing `openai` provider and 9Router. The bundled provider is loaded; `plugins/amadeus/skills/image-generation/SKILL.md` is eligible. The Skill uses semantic intent, with no fixed phrase router, duplicated model ID, or SOUL/global AGENTS change.
- A direct authenticated transport smoke from the OpenClaw container requested `ag/gemini-3.1-flash-image`, returned HTTP 200 and one JPEG (569,192 bytes), and handled the binary only in memory. This does not prove Agent selection or channel attachment delivery.
- CLI-driven agent turns were not real owner-inbound tests. The fresh explicit CLI session's exact `context.compiled` event offered only `web_fetch` and `web_search`; no `image_generate` call or attachment occurred. A factory reproduction under the configured owner sender rule includes `image_generate`, but this does not prove that CLI path. The owner subsequently confirmed real owner-channel image delivery, typed-text isolation, and inbound voice/TTS acceptance: “已验收 一切正常可以收尾”. Treat that owner attestation as the acceptance evidence; do not treat the CLI-only sessions as proof.
- Post-1.6.4 read-only host TTS health is HTTP 200/ready (LaunchAgent PID 50062, exit 0); no TTS or 9Router restart occurred.

## 1.6.2 stability cleanup release

- The historical 1.5.3 Voice remote branch had only an older Goal document and was retired after main-content comparison. MLX source terminology now says selected community backend, preserving the third-party caveat and explicit MPS rollback.
- Native LaunchAgent was applied with private launchd stderr, truncated above 1 MiB before each bootstrap. The previous native source/plist, protected A profile/token and exact MPS rollback remain outside Git. Same A/MLX/Auto/Interactive engine, model, timeout, worker and format are verified. Port 18792 remains deliberately wildcard for OrbStack/9Router; guest-to-host/LAN-address and authenticated 9Router speech succeeded, unauthenticated synthesis/inventory returned 401. No independent physical LAN peer test was available, so LAN exposure is conservatively assumed.
- A real WhatsApp audio inbound produced one media reply with Japanese TTS and a Chinese visible summary; an ordinary typed inbound produced a text-only reply. The owner replied “确认正常 通过” when asked to verify accepted Kurisu sound, visible text correctness/nonduplication and typed isolation. No Docker/CasaOS rebuild or new voice experiment was run. Protected native recovery and real acceptance: `.agent/checkpoints/2026-09-26-amadeus-1.6.2-stability-release.md`.

## Measured limits and operational watch

- Original single DM baseline: ASR 0.702s, Agent 3.471s, TTS+MP3 35.162s, end-to-end 42.462s. Fixed short HTTP A/MPS Interactive 20-run p50 4.48s/p95 5.28s; A/MLX 20-run p50 3.30s/p95 3.52s. A/MLX normal five-run p50 5.42s. MP3 encode remains minor; direct Opus not selected.
- MLX cold/real `vmmap` peak reached 18.4 GiB on 24 GiB Mac; swap rose from ~3.63 to ~6.75 GiB, reached ~7.03 GiB after a post-release real voice then fell to ~6.31 GiB; sampled memory pressure ~70–80% free. Idle footprint ~3.3 GiB; long-term memory safety is a monitoring gate, not a zero-risk claim. A/MPS before switch had ~9.3 GiB physical footprint. B ~15s reference hit four supervised 110s timeouts; its incomplete cells are explicitly documented, not filled with guessed p95.
- Docker cache patch-only candidate wall 39s→3s; plugin-dist-only 1s with OS/glibc/npm cached. Machine-checkable performance report and numeric data are in `docs/reports/`. Full local gates, immutable CasaOS release/checkpoint and owner notification passed. Known `LOG_POLICY=warning` and optional media adapter absence remain; post-release real WhatsApp owner acceptance and canonical `main` push passed. Four B configs remain safety-incomplete; owner explicitly cancelled further B tests after accepting released A+MLX (Goal §12). The numeric data remains incomplete, not fabricated; the performance Goal is complete as amended. Strict doctor has one known optional media-adapter failure; non-strict doctor exits 0.

Use `docs/CURRENT_TASK.md` for the next action and dated `.agent/checkpoints/2026-09-26-*` for evidence and rollback, not historical diaries as runtime instructions.
