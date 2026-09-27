# Amadeus Model Capability Adapter — Image Fallback, Explicit Text-to-Voice, and Group Image Access

Date: 2026-09-27

## Goal

Establish the first production-ready model-capability abstraction between OpenClaw and 9Router without changing the current Agent architecture.

OpenClaw remains the sole Agent/planner and decides **which capability** is needed. 9Router remains the model/backend control plane and decides **which concrete model/account** executes that capability.

This Goal delivers three scoped changes:

1. Replace the concrete default image model exposed to OpenClaw with the stable logical capability `amadeus-image`, backed by a 9Router ordered fallback chain:
   1. `ag/gemini-3.1-flash-image`
   2. `cx/gpt-image-2.5`
2. Extend the existing voice-reply contract so a user can explicitly request a voice reply from typed text while preserving the accepted Japanese-audio + bilingual-visible-text format and existing length/safety constraints.
3. Allow all users in supported group chats to call native `image_generate` directly, without owner approval, while preserving existing restrictions on sensitive tools and capabilities.

Do not add `fast`, `normal`, `smart`, `local`, or similar model tiers. Do not add a second Agent, a keyword router, or a duplicate image/TTS tool.

---

## Architectural boundary

The target boundary is:

```text
User
  ↓
OpenClaw
  ├─ decides: chat / image / ASR / TTS / other native tool capability
  ↓
Stable logical model capability
  ├─ arthur-combo
  ├─ amadeus-asr
  ├─ amadeus-tts
  └─ amadeus-image
  ↓
9Router
  ├─ provider/account selection
  ├─ account failover
  ├─ model fallback where supported
  └─ provider-specific protocol translation
  ↓
Concrete provider/model
```

OpenClaw must not be responsible for retrying Gemini vs GPT Image. The Agent performs one `image_generate` action against `amadeus-image`; 9Router owns fallback.

The first production image chain is fixed for this Goal:

```text
amadeus-image
1. ag/gemini-3.1-flash-image
2. cx/gpt-image-2.5
```

Fallback is strict ordered fallback, not round robin.

---

## Current-state constraints to preserve

Preserve all accepted runtime behavior unless explicitly changed below:

- OpenClaw 2026.9.4 remains the sole Agent runtime.
- `nine_router/arthur-combo` remains the primary conversation/reasoning model.
- Existing native `image_generate` remains the only image-generation tool.
- Existing `amadeus-asr` and `amadeus-tts` logical model names remain unchanged.
- Existing TTS provider remains the 9Router OpenAI-compatible endpoint.
- `speakerVoice=kurisu-v1`, MP3 output, `maxTextLength=1200`, and 120-second TTS timeout remain unchanged.
- Agent-facing generic `tts` and `message` tools remain denied; do not re-enable them.
- Existing WhatsApp/Telegram channel behavior, session scoping, Identity, NAS, HomeLab, VPS, market, notification, and other capability permissions remain unchanged except for the group image permission described below.
- Existing private-network SSRF opt-in required by native image generation remains unchanged.
- Do not change the native Mac TTS backend, reference voice, MLX model, launchd settings, or production TTS service.
- Do not restart 9Router or the native TTS service unless an existing documented deployment procedure explicitly requires it; this Goal should not require either.

---

# Workstream A — `amadeus-image` logical model with 9Router fallback

## A1. Create the logical image capability in 9Router without modifying 9Router source

Do **not** patch or fork 9Router in this Goal.

Use 9Router's existing Combo persistence/API/runtime support to create or reconcile an image combo named exactly:

```text
amadeus-image
```

The combo must have:

```text
kind: image
strategy: fallback
models, in this exact order:
1. ag/gemini-3.1-flash-image
2. cx/gpt-image-2.5
```

The current 9Router dashboard intentionally hides image/TTS combo creation, so provisioning must not depend on a visible `Create Combo` button. Use the supported 9Router management API/persistence boundary already used by the deployment/provisioning layer rather than editing 9Router source or hand-editing its database.

Implementation should be idempotent:

- if `amadeus-image` does not exist, create it;
- if it exists with the wrong kind, stop with a clear error rather than silently repurposing it;
- if it exists with a different model order, reconcile it to the canonical two-model order above;
- preserve unrelated combos and settings;
- preserve 9Router credentials/accounts/OAuth state;
- do not store 9Router secrets in Git.

Prefer extending the existing repository provisioning approach rather than adding a second ad-hoc management path. The desired state must be reproducible from the repository.

## A2. Point OpenClaw at the logical model only

Replace the concrete image model in canonical OpenClaw configuration:

```text
openai/ag/gemini-3.1-flash-image
```

with:

```text
openai/amadeus-image
```

The OpenAI-compatible provider continues to use:

```text
http://9router:20128/v1
```

and the existing `OPENCLAW_9ROUTER_API_KEY` SecretRef/env source.

The canonical provider model catalog should expose `amadeus-image` as the image model expected by OpenClaw. Do not keep the concrete Gemini model as the OpenClaw default after migration.

The image Skill must remain model/provider-neutral. It must not contain either `ag/gemini-3.1-flash-image` or `cx/gpt-image-2.5`.

## A3. Fallback semantics

Use 9Router's existing fallback error classification. Do not implement a second retry loop in OpenClaw or the Amadeus plugin.

Expected behavior:

```text
Gemini success
→ return image

Gemini fallback-eligible failure
(e.g. 429, quota/capacity, transient 5xx according to 9Router rules)
→ try cx/gpt-image-2.5

Request-scoped non-fallback client error
→ return the real error; do not blindly switch models

Both models unavailable
→ return the final structured failure to OpenClaw
```

No round robin.

## A4. Scope of image capability

This Goal preserves the currently accepted **new-image generation** contract.

Do not claim reference-image/editing parity between the two fallback models unless it is explicitly tested. If the current native OpenClaw image tool sends only prompt-based generation in production acceptance, test that exact contract.

If reference-image editing is already exposed and accepted in the current branch, verify both models preserve the required inputs before treating fallback as valid for editing. Otherwise document editing as deferred rather than silently dropping reference images.

---

# Workstream B — explicit typed request for voice reply

## B1. Desired user behavior

The existing inbound-voice behavior remains unchanged:

```text
Inbound voice note
→ normal Agent reasoning
→ Japanese spoken reply
→ visible Japanese line
→ visible concise Chinese summary
```

Add one new semantic trigger:

```text
Typed user message explicitly asks the assistant to reply using voice/audio
→ produce the same accepted voice-reply contract
```

Examples that should qualify semantically include requests equivalent to:

- “用语音回答我”
- “这次发语音”
- “念给我听”
- “reply with voice”

Do not implement fixed substring/keyword routing. The Agent/Skill must distinguish explicit output intent from discussion about the voice feature itself. For example, “你的语音是怎么实现的？” must remain an ordinary text reply unless the user also explicitly asks for voice output.

## B2. Preserve one voice-reply contract

Do not create a second TTS reply format or a duplicate Skill with diverging rules.

Extend the existing `voice-reply` contract so it applies when either:

1. the verified current turn is an inbound voice turn, or
2. a typed user explicitly requests a voice reply.

For both cases, the output contract remains:

```text
中文：<faithful concise Chinese summary>

日本語：<natural Japanese reply>
[[tts:text]]<exactly the same Japanese text>[[/tts:text]]
```

Preserve all existing rules:

- spoken audio is Japanese only;
- visible Chinese + Japanese text remains;
- the `日本語` line and `[[tts:text]]` content are identical;
- natural Japanese kanji/kana, not romaji;
- routine spoken content should stay concise, preferably under about 150 Japanese characters;
- additional detail belongs in the Chinese visible summary when practical;
- never omit safety-critical content just to hit a soft length target;
- configured TTS hard limit stays 1200 characters;
- no directive markers leak into visible text;
- output remains MP3 through `amadeus-tts` with `kurisu-v1`;
- no duplicate sender or duplicate audio delivery.

## B3. TTS activation mode

The current `tts.auto=inbound` cannot synthesize an explicitly tagged typed reply. Migrate to the OpenClaw mode that permits explicit `[[tts:*]]` / `[[tts:text]]` directives while keeping ordinary untagged text silent.

The intended runtime behavior is equivalent to:

```text
tts.auto = tagged
```

provided the pinned OpenClaw 2026.9.4 runtime/schema confirms the exact semantics before deployment.

Because inbound voice turns currently depend on injected `voice-reply` context and emit an explicit `[[tts:text]]` block, they must continue to synthesize under the new mode.

Do not change this setting without tests proving all three cases:

1. inbound voice → audio still generated;
2. typed explicit voice request → audio generated;
3. ordinary typed message → no audio generated.

## B4. Prompt/Skill integration

Keep the existing verified inbound WhatsApp voice-lease mechanism for inbound voice turns.

For typed explicit voice requests, use the smallest OpenClaw-native semantic mechanism that lets the Agent apply the same `voice-reply` contract. Prefer Skill eligibility/description and normal Agent semantic selection over a second hard-coded phrase router.

Do not weaken the inbound voice verification boundary: typed requests must not impersonate or fabricate the inbound voice lease.

The implementation may refactor the reusable voice-reply contract body so both valid activation paths share one authoritative rule source, but the inbound verified lease remains the authoritative signal for inbound-audio-specific behavior.

---

# Workstream C — group image generation for all users

## C1. Confirm current policy before changing it

Before modification, reproduce the current effective tool surface for:

- owner in direct chat;
- owner in group chat;
- non-owner group member.

Record whether `image_generate` is present for each case.

Do not describe the current behavior as “approval-gated” unless there is an actual approval workflow. If the current behavior is simply sender-policy filtering, document it accurately as “tool unavailable to non-owner/group sender”.

## C2. New permission rule

After this Goal:

> Any admitted user in supported WhatsApp and Telegram group chats may directly invoke native `image_generate` when the Agent determines the request is an image-generation request.

There must be no owner approval step for group image generation.

This permission expansion is scoped to image generation only.

Do **not** grant non-owner group members broader access to:

- generic `message` or Agent-facing `tts`;
- runtime/exec/process/filesystem tools;
- NAS/HomeLab/VPS mutation capabilities;
- Identity mutation tools;
- owner notification/admin capabilities;
- other sensitive Amadeus plugin tools;
- unrestricted `*` tool access.

Existing group admission/channel policies remain in force. “All group users” means all users already admitted by the channel/group access policy, not arbitrary unauthenticated external callers.

## C3. Policy shape

Use the narrowest OpenClaw-native tool-policy layer that expresses:

```text
Group sender:
  existing safe group tools
  + image_generate
```

Do not solve this by replacing the wildcard sender policy with `allow: ["*"]`.

Preserve owner privileges and current direct-message behavior.

If WhatsApp and Telegram require different group policy syntax in pinned OpenClaw 2026.9.4, configure each explicitly but keep the semantic policy identical.

Add regression tests that prove a non-owner group member receives `image_generate` while sensitive tools remain unavailable.

---

# Testing and validation

## Static/config tests

Update repository tests so they assert at minimum:

- primary chat model remains `nine_router/arthur-combo`;
- OpenClaw image primary is `openai/amadeus-image`;
- the OpenAI-compatible image provider still points to internal 9Router and reuses the existing SecretRef;
- concrete Gemini/GPT Image IDs do not appear in the image Skill;
- 9Router desired-state provisioning contains exactly the ordered `amadeus-image` chain defined by this Goal;
- image fallback strategy is `fallback`, not `round-robin`;
- global deny still contains Agent-facing `tts` and `message`;
- TTS provider remains `amadeus-tts`, `kurisu-v1`, MP3, timeout 120000 ms, max text 1200;
- configured TTS activation supports explicit tagged replies while ordinary untagged typed replies stay silent;
- non-owner group tool policy includes `image_generate` but does not widen to unrestricted tool access;
- existing ASR configuration remains `amadeus-asr`;
- config validates under the pinned OpenClaw runtime.

## 9Router transport and fallback acceptance

From the live OpenClaw network context, prove:

1. authenticated request using `model=amadeus-image` returns a valid generated image;
2. logs/evidence show the first backend is `ag/gemini-3.1-flash-image` during a healthy request;
3. exercise a safe, reversible fallback test without damaging account state or production credentials:
   - use a controlled temporary test combo or a supported non-destructive simulation/config override if necessary;
   - demonstrate first-backend fallback-eligible failure causes the second model `cx/gpt-image-2.5` to be attempted and succeed;
   - restore canonical production ordering/state immediately afterward;
4. do not intentionally exhaust quota or corrupt credentials merely to trigger fallback.

If a safe live fallback fault cannot be induced, provide unit/integration evidence against the exact 9Router combo response path plus a real successful `amadeus-image` production smoke, and explicitly label the limitation.

Do not retain generated image binary/base64 in Git.

## Real channel acceptance — Image

Perform real group-channel tests through supported channels:

- owner group member requests an image → succeeds;
- non-owner group member requests an image → succeeds without approval;
- normal non-image group text → no image generation;
- non-owner group member attempts a sensitive unrelated capability → remains denied/unchanged.

Image reply must arrive as the normal structured channel attachment, not as raw base64 or a leaked internal URL.

## Real channel acceptance — Voice

Perform real acceptance for all three cases:

1. inbound voice note → Japanese audio + Japanese visible line + Chinese summary;
2. typed explicit voice request → Japanese audio + Japanese visible line + Chinese summary;
3. ordinary typed message → text only, no audio.

Also verify:

- spoken Japanese and visible Japanese line are identical;
- no Chinese is synthesized into the audio;
- routine spoken length respects existing concise guidance;
- only one audio attachment is sent;
- no raw `[[tts:*]]` directive is visible to the user;
- existing TTS health remains stable.

---

# Deployment and rollback

Follow the repository's normal release/deployment workflow and existing protected checkpoint conventions.

Before production apply:

- record the current Git/source commit;
- create a protected OpenClaw config rollback checkpoint;
- record the current live OpenClaw image/tag;
- snapshot only the minimal 9Router combo desired/runtime state required to reverse `amadeus-image` creation/reconciliation, without copying secrets into Git;
- do not disturb existing 9Router provider connections or native TTS process.

Rollback must independently support:

1. restoring the prior OpenClaw image/config;
2. restoring/removing the `amadeus-image` combo to its pre-change state;
3. restoring prior TTS activation/voice Skill behavior;
4. restoring previous group image tool policy.

Rollback must not require rolling back unrelated 9Router accounts, TTS model files, ASR, or other Amadeus capabilities.

---

# Documentation and release state

Update the appropriate project state/checkpoint/release documentation with:

- `amadeus-image` as the stable OpenClaw-facing image capability;
- exact fallback order: Gemini 3.1 Flash Image → GPT Image 2.5;
- confirmation that fallback is owned by 9Router, not OpenClaw;
- explicit typed-to-voice behavior and unchanged Japanese-audio/bilingual-text contract;
- group image access for all admitted group members;
- confirmation that sensitive tool permissions remain restricted;
- tests and real acceptance evidence;
- rollback checkpoint references.

Do not publish secrets, phone numbers, account emails, OAuth tokens, image payloads, voice samples, private prompts, or other sensitive artifacts in Git.

Version/release handling must follow the repository's existing versioning policy; do not bump repeatedly during implementation. Bump once only when the production-ready change is accepted according to the existing release workflow.

---

# Non-goals

This Goal does **not** include:

- modifying/forking 9Router source;
- adding STT/ASR model combo fallback to 9Router;
- adding TTS model combo fallback beyond the currently configured `amadeus-tts` backend;
- adding image tiers such as fast/smart/local;
- model selection by OpenClaw based on provider/model brand;
- round-robin image routing;
- automatic cost/quality routing;
- local FLUX/ComfyUI deployment;
- changing the Kurisu reference voice or TTS model;
- reopening Agent-facing generic `tts` or `message` tools;
- broadening group access to sensitive tools;
- image editing/reference-image parity unless already supported and explicitly verified.

---

# Acceptance criteria

The Goal is complete only when all of the following are true:

1. OpenClaw uses `openai/amadeus-image`, not a concrete image provider/model, as its canonical default image model.
2. 9Router has an idempotently provisioned `kind=image` logical combo `amadeus-image` with strict order:
   - `ag/gemini-3.1-flash-image`
   - `cx/gpt-image-2.5`
3. A normal image request succeeds through `amadeus-image`.
4. There is credible tested evidence that a fallback-eligible first-model failure advances to GPT Image 2.5 without OpenClaw issuing a second model-specific request.
5. `arthur-combo`, ASR, and unrelated capabilities are unchanged.
6. Inbound voice replies still work exactly as accepted.
7. A typed user who explicitly asks for voice receives Japanese audio plus the existing Japanese/Chinese visible text format.
8. An ordinary typed request remains text-only.
9. Group users other than the owner can invoke `image_generate` directly without approval.
10. The same non-owner group users do not gain unrelated sensitive tool access.
11. No duplicate audio/image delivery paths are introduced.
12. Repository tests/build/typecheck/secret checks/config validation and normal release checks pass.
13. Production acceptance and rollback evidence are recorded without secrets or generated media payloads.

Stop after these criteria are satisfied. Do not expand into ASR/TTS combo work or 9Router source changes in this Goal.
