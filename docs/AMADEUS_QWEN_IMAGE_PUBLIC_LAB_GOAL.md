# Amadeus Public Qwen Image Lab — Goal

Date: 2026-10-08 (Asia/Shanghai)
Baseline: Amadeus 1.9.7 GPT-only image production route
Target host: Mac mini M6 / 24GB unified memory
Public hostname: `image.nyannyan.top`
Type: local image lab UI simplification + protected public publishing

## Goal

Keep production image generation completely GPT-only while turning the existing local Qwen LAN debug page into a small public Image Lab for manual experimentation.

Production must remain:

```text
WhatsApp / OpenClaw
  -> openai/amadeus-image
  -> 9Router
  -> cx/gpt-image-2.5
```

No automatic Qwen fallback is allowed.

The local/public Image Lab must remain separate:

```text
Browser
  -> LAN direct OR https://image.nyannyan.top
  -> Qwen Image Lab UI
  -> one local Qwen bridge
  -> one local sd-server process at a time
  -> Qwen-Image-2.1 Uncensored Q4_K_M
```

The operator will manually compare quality and speed after deployment.

## Explicit scoped authorization

The operator explicitly authorized this Goal to execute continuously until the public site is deployed and reachable.

Within this Goal, no additional confirmation is required for the following scoped actions:

- Git source changes required by this Goal;
- building/rebuilding the local patched `stable-diffusion.cpp` candidate if required;
- installing/restarting the Qwen Image Lab macOS LaunchAgent;
- creating/updating the Image Lab runtime password verifier/secret outside Git;
- updating/restarting the HomeLab frpc service for the one Image Lab proxy;
- updating/restarting VPS frps only as required to admit the one new remote port;
- updating/reloading VPS Caddy for `image.nyannyan.top`;
- creating/updating only the `image.nyannyan.top` DNS record if an already-available Cloudflare credential can perform that exact change;
- creating protected rollback checkpoints;
- performing minimal local and public smoke tests;
- using explicit `--apply` or equivalent mutation flags for the above actions.

Do not pause merely to request authorization for those scoped mutations.

This authorization does **not** include:

- changing SSH authentication;
- changing the SSH port;
- changing firewall policy unless an already-required existing public port must be preserved;
- deleting unrelated services or data;
- rotating unrelated credentials;
- changing Xray/Hysteria credentials;
- changing OpenClaw image routing;
- enabling Qwen production fallback;
- exposing the Qwen bridge or sd-server directly to the Internet.

If an operation would cross one of those boundaries, fail closed rather than broadening scope.

## Secret handling

The public login password is supplied by the operator at execution time.

Never write the plaintext password to:

- Git;
- Markdown;
- commit messages;
- logs;
- checkpoints;
- generated source;
- Caddyfile;
- frpc/frps config.

Prefer generating a salted verifier from the supplied password using a standard library KDF such as `hashlib.scrypt`, and store only the verifier outside Git in a mode-`0600` file.

Suggested runtime path:

```text
~/Library/Application Support/Amadeus/secrets/qwen-image-lab-auth.json
```

The executor may transiently receive the password through the Goal invocation/environment, but it must not echo it.

## Product boundary

This Goal does not make local Qwen part of the production Amadeus route.

Keep:

```text
AMADEUS_QWEN_IMAGE_LOCAL_ONLY=0
AMADEUS_QWEN_IMAGE_FALLBACK_ENABLED=0
```

Do not alter 9Router image desired state.

Do not modify the production GPT image lifecycle, Asset Registry, Completion Agent, WhatsApp delivery, image captions, or image upscale.

## Image Lab UI

The UI should expose only the controls the operator requested.

### Mode

Exactly two visible choices:

```text
Quality
  Qwen Base 16-step

Fast
  Qwen Fun-Acc 4-step
```

No other profile may be exposed.

### Resolution

Expose only:

```text
1024x1024
1024x768
768x1024
```

Default:

```text
1024x1024
```

The selected resolution applies to both generation and edit requests.

Reference image bytes and MIME must remain unchanged.

Do not silently replace the selected target size with a different UI value.

### Seed

Expose one numeric seed control.

Default:

```text
-1
```

Semantics:

```text
-1       random seed
>= 0     fixed deterministic seed where supported by the runtime
```

The exact seed selected in the UI must be forwarded to the engine for both generation and edit requests.

The task/result view should display the profile, output resolution and effective seed so the operator can compare runs.

### Everything else

Do not expose controls for:

- CFG;
- edit strength;
- sigma schedule;
- sampler;
- prefix cache;
- Flash Attention;
- mmap;
- LoRA multiplier;
- model path;
- timeout.

Those remain server-owned defaults.

Keep the existing prompt field, reference upload, result preview, task history and automatic PNG saving.

## Quality profile

The Quality profile is the current base-model reference.

Use:

```text
model: qwen-image-2.1-UC-Q4_K_M.gguf
Qwen3-VL-8B-Instruct-Q4_K_M.gguf
mmproj-Qwen3VL-8B-Instruct-F16.gguf
Qwen-Image-2.1 VAE
Metal
steps = 16
CFG = 6
Fun-Acc = disabled
```

Reference editing must use the native Qwen reference-edit path.

Do not inject an edit `strength < 1.0` on the Image Lab path.

If the pinned sd.cpp contract requires an explicit strength value, use `1.0` internally.

Do not expose strength in the UI.

This removes the current `strength=0.9` variable from the operator's Quality-vs-Fast comparison and avoids intentionally selecting an img2img-style partial-denoise path.

## Fast profile

Use the existing source-managed Fun-Acc candidate work:

```text
Qwen-Image-2.1 Uncensored Q4_K_M
Alibaba PAI Fun-Acc / PDD 4-step adapter
correct PDD custom sigma grid
CFG = 1
Metal
Qwen3-VL-8B + mmproj for edits
```

The Fast profile must use real PDD semantics, including the per-step output-head behavior already represented by the repository sd.cpp patch.

Do not emulate Fast mode by only setting `steps=4`.

Keep the pinned custom sigma grid:

```text
1.0
0.9169867038726807
0.7861579060554504
0.5494909882545471
0.0
```

Reference editing uses the same native edit contract as Quality.

Do not expose the Fun-Acc internals in the UI.

## One-engine runtime design

Do not keep separate 16-step and 4-step model processes resident at the same time on the 24GB Mac.

Refactor the Image Lab bridge to own exactly one active `sd-server` child.

Track:

```text
activeProfile = quality | fast | none
```

Behavior:

```text
request profile == activeProfile
  -> reuse warm sd-server

request profile != activeProfile
  -> stop current sd-server
  -> start the requested profile
  -> process request
```

A profile switch may pay a cold-load penalty. That is acceptable for the lab.

Never launch both profile engines concurrently.

Keep generation concurrency at one and at most one bounded waiter.

A patched sd.cpp binary may be used for both profiles as long as:

- Quality starts it without the Fun-Acc/PDD model argument and without the Fun-Acc adapter;
- Fast starts it with the verified Fun-Acc/PDD model argument and adapter;
- Quality remains ordinary base 16-step inference.

## Runtime acceleration defaults

For Fast mode only, use the already supported candidate defaults:

- real Fun-Acc/PDD 4-step;
- correct custom sigmas;
- prefix cache `q8_0` first, `auto` only if q8 initialization fails;
- mmap if stable;
- supported Flash Attention configuration;
- idle warm lease 900 seconds.

Do not expose these as UI controls.

Quality may keep the stable baseline runtime defaults except for the native edit-strength correction described above.

## Request contract

Extend the private Image Lab proxy contract with:

```text
profile = quality | fast
resolution = one of the three allowed sizes
seed = integer >= -1
```

For generation, the debug UI sends a bounded JSON request.

For editing, the debug UI sends bounded multipart with:

- one reference image only;
- prompt;
- profile;
- size;
- seed.

The bridge validates the new fields and strips lab-only control fields before calling sd-server.

Reject unknown profiles, unsupported resolutions, invalid seeds, multiple references, wrong MIME, oversize media, and prompt-injected `<sd_cpp_extra_args>` markers.

The browser must never supply a model path, LoRA path, bridge token, or engine argument string.

## LAN access behavior

Preserve convenient direct LAN usage.

For private/loopback clients using a private/loopback Host header:

- no login is required;
- existing same-origin protections remain;
- the page remains available on the current LAN port.

Do not weaken the private-client checks for arbitrary Internet clients.

## Public authentication

Requests for the exact public host:

```text
image.nyannyan.top
```

must require password authentication.

Use a password-only login page; do not require a username.

Recommended behavior:

1. unauthenticated `GET /` renders the login surface;
2. `POST /api/login` validates against the protected scrypt verifier;
3. successful login creates a cryptographically random server-side session;
4. set a cookie with:
   - `HttpOnly`;
   - `Secure`;
   - `SameSite=Strict`;
   - bounded expiration, e.g. 12 hours;
5. authenticated public sessions may access the Image Lab;
6. `POST /api/logout` invalidates the session;
7. failed login attempts receive a bounded delay/rate limit;
8. model/task/generation/edit/output APIs require a valid public session.

Do not put the password into JavaScript or HTML.

The public login flow must not expose the protected Qwen bridge token.

## Public origin / CSRF

Current LAN-only origin checks accept only HTTP private hosts. Extend them narrowly.

Allowed write origins:

```text
LAN direct:
  http://<private-host>:18798

Public:
  https://image.nyannyan.top
```

For the public path, require the exact Host and Origin pair.

Do not add wildcard Origin support.

Do not trust arbitrary `X-Forwarded-Host` or `X-Forwarded-Proto` values from direct Internet clients.

The UI may trust the existing Caddy/frp topology only for the exact declared public hostname.

## Public network topology

Reuse the existing public-services architecture.

Target:

```text
Internet
  -> image.nyannyan.top
  -> VPS Caddy :443
  -> 127.0.0.1:18798 on amadeus-gateway
  -> frps
  -> HomeLab frpc
  -> macOS Image Lab :18798
```

Do not expose ports 18793 or 18795 publicly.

### HomeLab frpc

Add one declared proxy, source-managed as a template, for example:

```toml
[[proxies]]
name = "qwen-image-lab-tcp"
type = "tcp"
localIP = "<verified-macos-host-address>"
localPort = 18798
remotePort = 18798
```

Before applying, verify the actual HomeLab-frpc-to-macOS address rather than assuming a transient LAN IP.

Prefer an already-proven stable host alias/address if the OrbStack/frpc runtime resolves one.

If only the Mac LAN address is available, verify it is the intended host address immediately before apply and document that dependency.

Validate the frpc config before restart.

### VPS frps

Add only TCP `18798` to the allowed remote-port set if it is not already allowed.

Increase `maxPortsPerClient` only by the minimum necessary amount.

Run the pinned frps config verify command before restart/reload.

Do not touch existing proxy ports.

### VPS Caddy

Add a source-managed site:

```text
image.nyannyan.top {
    encode gzip
    reverse_proxy 127.0.0.1:18798
}
```

Authentication remains in the Image Lab application so public UX is password-only rather than Caddy Basic Auth with an extra username.

Validate the full Caddyfile before reload.

Do not change unrelated sites.

### DNS

First determine whether the existing wildcard/public DNS setup already makes `image.nyannyan.top` resolve to the gateway.

If it already resolves correctly, do not change DNS.

If an exact record is required, create/update only `image.nyannyan.top` using an already-available Cloudflare credential outside Git.

Do not modify unrelated DNS records.

Do not copy Cloudflare credentials into the repository or checkpoint.

## Public TLS

Caddy terminates HTTPS.

Acceptance requires a valid certificate for:

```text
image.nyannyan.top
```

Do not expose the Image Lab over public plaintext HTTP except ACME/redirect behavior managed by Caddy.

## Debug output storage

Keep successful PNG auto-save under the existing protected local output directory.

Do not serve arbitrary filesystem paths publicly.

If the public UI offers a download action, it may return only the output associated with an authenticated task/session through a bounded handler.

Prevent path traversal.

## Minimal source tests

Add/update focused tests for:

- exactly two profiles;
- exactly three resolutions;
- seed validation and forwarding;
- Quality -> 16 steps / CFG 6 / no Fun-Acc;
- Fast -> real Fun-Acc 4-step / CFG 1 / custom sigmas;
- profile switching leaves only one sd-server child;
- generation and edit preserve the selected profile/size/seed;
- reference bytes/MIME remain unchanged;
- Image Lab does not inject `strength < 1.0`;
- LAN direct access still works;
- public host requires login;
- wrong password fails;
- valid runtime password session succeeds;
- cookie flags are Secure/HttpOnly/SameSite=Strict;
- exact public Origin accepted;
- wrong public Origin rejected;
- protected APIs reject unauthenticated public requests;
- secrets do not appear in source/log fixtures.

Run:

```sh
pnpm workflow:plan
python3 -m unittest apps/qwen-image-service/test_bridge.py
python3 -m unittest apps/qwen-image-service/test_debug_ui.py
python3 -m py_compile apps/qwen-image-service/bridge.py apps/qwen-image-service/debug_ui.py
bash -n infra/macos/manage-qwen-image.sh
bash -n infra/macos/manage-qwen-image-debug-ui.sh
pnpm check:secrets
git diff --check
```

Run broader tests only if the implementation touches broader OpenClaw/Amadeus code.

## Deployment sequence

Execute continuously in this order:

```text
1. read-only current-state audit
2. protected Mac Image Lab checkpoint
3. implement two-profile UI + resolution + seed
4. implement one-engine profile switching
5. integrate existing Fun-Acc candidate into Fast profile
6. focused source tests
7. provision password verifier outside Git
8. apply/restart local Image Lab services
9. local LAN login-bypass/UI smoke
10. local Quality 16-step smoke
11. local Fast 4-step smoke
12. protected HomeLab frpc checkpoint
13. add/validate/restart qwen-image-lab-tcp proxy
14. protected VPS frps/Caddy checkpoint
15. admit VPS TCP 18798 if needed
16. add/validate/reload image.nyannyan.top Caddy site
17. verify/create exact DNS only if necessary and credential is already available
18. wait for/verify valid HTTPS
19. public unauthenticated rejection/login-page smoke
20. public wrong-password rejection smoke
21. public authenticated page/API smoke
22. one minimal public image request
23. confirm production OpenClaw remains GPT-only
24. write checkpoint/current-state evidence
```

Do not stop between those phases for routine confirmation; this Goal message already authorizes the scoped apply work.

## Minimal image smoke

Do not run a large quality benchmark.

Only prove:

### Quality

One 1024-class generation with:

```text
profile = quality
fixed seed
```

returns one valid image.

### Fast

One 1024-class generation or one single-reference edit with:

```text
profile = fast
fixed seed
```

returns one valid image and the runtime log proves Fun-Acc/PDD 4-step is active.

The operator will perform the real Quality-vs-Fast comparison later.

Do not block deployment on subjective visual quality.

## Production regression gate

After public Image Lab deployment, verify:

```text
Amadeus version remains the current GPT-only release unless an unrelated source version bump is actually required.
AMADEUS_QWEN_IMAGE_LOCAL_ONLY=0
AMADEUS_QWEN_IMAGE_FALLBACK_ENABLED=0
9Router image chain = cx/gpt-image-2.5 only
```

Do not send a Qwen request from the production OpenClaw route.

## Public acceptance

The Goal is complete only when all are true:

- `https://image.nyannyan.top` resolves and presents valid HTTPS;
- unauthenticated public access cannot use the Image Lab APIs;
- the operator-supplied password can create a valid session;
- the public UI exposes only:
  - Quality 16-step;
  - Fast Fun-Acc 4-step;
  - resolution;
  - seed;
  - existing prompt/reference controls;
- the resolution options are exactly:
  - 1024x1024;
  - 1024x768;
  - 768x1024;
- Quality runs base 16-step;
- Fast runs real PDD 4-step;
- the selected seed reaches both generation and edit;
- exactly one local sd-server process can be resident;
- LAN direct access still works without login;
- public Qwen bridge/engine ports are not directly exposed;
- one minimal public authenticated image request succeeds;
- successful images still save locally;
- production OpenClaw remains GPT-only with Qwen fallback disabled;
- rollback checkpoints exist for Mac, HomeLab frpc and VPS routing.

## Rollback

Rollback only the Image Lab/publication scope:

1. remove/disable the `image.nyannyan.top` Caddy site;
2. remove the one qwen-image-lab frp mapping;
3. restore prior frps allow-port/max-port configuration;
4. restore the prior LAN debug UI/bridge files and LaunchAgent;
5. keep model assets and Fun-Acc artifacts unless explicitly cleaned later;
6. leave production GPT image routing unchanged.

Do not roll back unrelated VPS services.

## Codex execution command

```text
/goal Execute docs/AMADEUS_QWEN_IMAGE_PUBLIC_LAB_GOAL.md end-to-end. Treat it as authoritative. The operator explicitly pre-authorizes all scoped Git, macOS Qwen Image Lab, HomeLab frpc, VPS frps/Caddy, image.nyannyan.top DNS-if-needed, password-verifier provisioning, restart/reload, checkpoint and smoke-test mutations described by the Goal; do not stop for additional routine confirmation. Production Amadeus must remain GPT-only with AMADEUS_QWEN_IMAGE_LOCAL_ONLY=0 and AMADEUS_QWEN_IMAGE_FALLBACK_ENABLED=0. Refactor the Image Lab to expose only Quality (base Qwen 16-step) and Fast (real Fun-Acc/PDD 4-step), plus resolution {1024x1024,1024x768,768x1024} and seed; keep all other parameters server-owned. Use the native Qwen reference-edit path and do not inject edit strength below 1.0. Keep one sd-server process at a time and restart it only when switching profiles. Preserve LAN direct no-login access, but require password-only authenticated sessions for the exact public host https://image.nyannyan.top. The public password is supplied separately in the Goal invocation/runtime and must never enter Git/logs/checkpoints. Publish only the UI through the existing frp -> amadeus-gateway -> Caddy architecture; keep bridge/engine loopback-only. Continue through source tests, local smokes, protected checkpoints, frpc/frps/Caddy/DNS apply and public HTTPS/login/image smoke until https://image.nyannyan.top is working. Do not change SSH auth, firewall policy, unrelated DNS, proxy credentials, or production image routing.
```
