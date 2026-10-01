# Amadeus Image Route Authoritative Fix — Hotfix Goal

Date: 2026-10-01
Priority: P0 production hotfix
Baseline: Amadeus `1.7.8`, OpenClaw `2026.9.4`
Scope: native `image_generate` model routing / detached task execution / 9Router image Combo
Operator authorization: source changes, focused tests, patch release, production apply and restart are authorized in this Goal. Do not wait for an additional human approval between implementation and deploy if automated gates pass.

## Incident

Owner image requests are accepted as detached/background `image_generate` tasks and then fail almost immediately. Runtime evidence from the prior incident showed the model-authored tool args contained `model=openai/gpt-image-2`. That concrete override bypassed the operator-owned logical image route `openai/amadeus-image`, so the request did not enter the intended 9Router `amadeus-image` Combo (`cx/gpt-image-2.5` -> fallback `ag/gemini-3.1-flash-image`).

Amadeus 1.7.7 attempted to remove the model key in `before_tool_call`, but pinned OpenClaw 2026.9.4 shallow-merges returned hook params over original params, so omission preserved the original override. Amadeus 1.7.8 changed the rewrite to `model: ''`, which is expected to survive the merge and let native image-model resolution fall back to configured `mediaModels.image.primary`.

The owner reports the production symptom remains. Treat this as a routing-boundary bug until a fresh live trace proves otherwise.

## Required outcome

For every native `image_generate` request initiated by the Agent:

```text
Agent decides: generate image
        |
        v
native image_generate
        |
        | concrete model/provider supplied by Agent is non-authoritative
        v
operator configured mediaModels.image.primary
        |
        v
openai/amadeus-image
        |
        v
9Router /v1
        |
        v
Combo: amadeus-image
        |
        +--> cx/gpt-image-2.5
        |
        +--> ag/gemini-3.1-flash-image (fallback)
```

The Agent/LLM must never be able to select `openai/gpt-image-2`, `cx/gpt-image-2.5`, a provider account, or any other concrete image backend. Model selection is operator/runtime policy, not model-authored tool data.

## Architecture decision

Do not fix this with aliases such as `gpt-image-2 -> gpt-image-2.5` and do not teach 9Router to accept the wrong model name. That would preserve the architectural bug and make future model changes fragile.

The authoritative invariant is:

**Agent chooses the capability; OpenClaw operator config chooses the logical route; 9Router chooses the concrete provider/model.**

`plugins/amadeus/src/image-generation-policy.ts` may remain as defense-in-depth, but it must not be the only authority if the real detached execution path can retain/recreate the original model override.

## Phase 0 — fast live truth gate

Before editing, perform one content-safe audit of the most recent failed owner image task and the currently running container.

Record only safe routing facts, timestamps, task/run/session correlation ids and bounded errors. Never record prompt text, image bytes, private message contents, credentials, signed URLs or user media.

Prove all of the following:

1. live container source/image/version actually contains commit `9f2357210a07` or a descendant and runtime `VERSION=1.7.8`;
2. `before_tool_call` for `image_generate` ran;
3. original tool args model value;
4. hook-returned model value;
5. post-hook merged params model value;
6. detached task serialized/enqueued model value;
7. detached worker deserialized model value;
8. final native image provider/model resolution immediately before HTTP transport;
9. outbound logical model sent to 9Router;
10. whether the request reached the `amadeus-image` Combo.

Do not stop at “hook fired”. Trace through the detached job boundary to the final provider request.

### Fast branch

If production is simply stale and is not actually running 1.7.8/commit `9f2357210a07` or later, do not invent another routing patch. Reconcile/deploy the current source first, run the focused acceptance below, and only continue to Phase 1 if the concrete override still survives.

If live 1.7.8 is confirmed and any execution stage after the hook contains `openai/gpt-image-2` or another model-authored concrete image model, proceed immediately to Phase 1.

## Phase 1 — make the native execution boundary authoritative

Inspect the exact pinned OpenClaw `2026.9.4` implementation of native `image_generate`, including:

- tool input/schema parsing;
- media-model selection;
- detached task creation/serialization;
- background worker execution;
- provider/model resolution;
- OpenAI-compatible image request construction.

Choose the earliest stable native boundary that is both:

1. after model-authored tool input has been parsed; and
2. before the detached task/provider request becomes authoritative.

At that boundary, force image generation to resolve from configured `mediaModels.image.primary` and ignore any concrete `model` value originating in Agent tool args.

Equivalent policy:

```ts
if (toolName === 'image_generate') {
  // model-authored override is never authoritative
  requestedModel = undefined;
  effectiveModel = resolveConfiguredImageModel(runtimeConfig);
}
```

The exact code must follow OpenClaw's real types and functions; do not add pseudo abstractions merely to match this document.

### Preferred implementation order

1. If pinned OpenClaw exposes a supported typed hook/API that can replace, not shallow-merge, final tool args before enqueue/provider resolution, use it.
2. Otherwise add one narrow version-pinned OpenClaw source overlay/patch at the native `image_generate` model-selection boundary.
3. Keep the existing Amadeus `before_tool_call` blank-sentinel rewrite as defense-in-depth unless it becomes provably redundant and its removal is covered by tests.

Do not create a second image-generation tool, wrapper Agent, text parser or duplicate provider stack.

## Phase 2 — prevent regression at both boundaries

Add focused tests reproducing the real failure.

### Test A — Agent supplies wrong concrete model

Input equivalent to:

```json
{
  "prompt": "<redacted fixture>",
  "model": "openai/gpt-image-2"
}
```

Assert final effective model is the configured logical route:

```text
openai/amadeus-image
```

and never `openai/gpt-image-2`.

### Test B — OpenClaw shallow merge behavior

Reproduce pinned 2026.9.4 hook merge semantics and assert the Amadeus blank sentinel still survives as expected.

### Test C — detached serialization/deserialization

Pass the request through the same task serialization/deserialization shape used by background `image_generate`.

Assert no model-authored concrete image model becomes authoritative after the queue boundary.

### Test D — provider transport

At the final OpenAI-compatible transport boundary, assert the logical model routed outward is `amadeus-image` (with provider namespace handling matching the actual client implementation) and not `gpt-image-2`.

### Test E — 9Router Combo smoke

Verify live 9Router canonical state before deployment:

```text
amadeus-image
strategy = fallback
models = [cx/gpt-image-2.5, ag/gemini-3.1-flash-image]
```

Do not mutate provider accounts or credentials as part of this hotfix unless live state is proven non-canonical.

### Test F — no explicit model

Normal Agent `image_generate` with no model field must continue to use the configured route.

### Test G — non-image tools unaffected

Model overrides/selection behavior for unrelated native tools must be unchanged.

## Phase 3 — diagnostics that make the next failure obvious

Add bounded structured routing diagnostics at the authoritative path. Use correlation ids, never user content.

Required events or equivalent:

```text
image_route_tool_override_observed
image_route_operator_model_selected
image_route_task_enqueued
image_route_worker_model_resolved
image_route_transport_model_resolved
```

Useful fields:

```text
taskId
runId
requesterSessionHash (hashed/bounded if already used)
overridePresent: boolean
overrideIgnored: boolean
configuredLogicalModel
transportLogicalModel
providerStatus
```

Do not log prompt, full message, image payload, credentials or private endpoint secrets.

If final transport model is not the configured logical image model, fail closed with a specific bounded error such as:

```text
image_route_invariant_violation
```

Do not silently fall back to a model-authored concrete model.

## Phase 4 — cleanup

Search active production source for image-generation model ownership. There must be one operator-owned route.

The following must not own routing:

- Agent prompt/Skill selecting `gpt-image-*`;
- aliases created solely to tolerate `gpt-image-2`;
- style/prompt-based model selection;
- completion lifecycle text;
- WhatsApp/Telegram channel adapters;
- image asset/upscale code.

Retain historical checkpoints as evidence; do not rewrite history.

## Fast verification gate

Run the minimum high-signal suite first so this remains a hotfix:

```bash
pnpm test:amadeus
pnpm test:delivery
pnpm typecheck:amadeus
pnpm build:amadeus
git diff --check
pnpm check:secrets
```

Also run every new focused test covering the pinned OpenClaw image route/queue/transport boundary.

If a pinned OpenClaw overlay is changed, run its exact patch/anchor test and fail build when the 2026.9.4 anchor does not match.

Do not run unrelated long suites unless a touched dependency or existing repository gate requires them.

## Version and commit

If source/runtime behavior changes, bump patch version from `1.7.8` to `1.7.9` using the repository version tooling and add concise release notes describing an authoritative native image-route repair.

Commit reviewed source before apply. Suggested source commit message:

```text
fix(amadeus): enforce operator image route at native boundary
```

Then add a content-safe checkpoint documenting trace evidence, automated gates, deploy image identity and acceptance result.

## Production deployment — authorized

The operator has authorized immediate production deployment for this P0 repair after automated gates pass. Do not stop for another approval prompt.

Use the repository deployment path so only affected images rebuild:

```bash
./scripts/deploy-openclaw.sh --dry-run --build-auto
./scripts/deploy-openclaw.sh --apply --build-auto
```

The deployment script must verify the canonical 9Router image Combo before switch. Preserve its rollback checkpoint and existing single-runtime invariant.

If Phase 0 proves the only problem was a stale live container and no source/runtime change is required, reconcile using the safest existing deployment mode consistent with the repository script's freshness/version rules; do not create a meaningless routing patch merely to force a release.

## Post-deploy acceptance

Immediately after apply, perform all acceptance that can be automated without waiting for the owner:

1. OpenClaw healthy;
2. Amadeus plugin registered;
3. runtime version/source identity matches deployed commit;
4. canonical 9Router `amadeus-image` Combo verified;
5. focused route fixture/smoke shows wrong Agent override cannot escape to transport;
6. no new `image_route_invariant_violation` during the smoke;
7. task/lifecycle/delivery regression tests remain green.

If a real owner WhatsApp request is already available during execution, trace it content-safely and require:

```text
image_generate accepted
-> operator logical model openai/amadeus-image
-> 9Router Combo amadeus-image
-> concrete cx/gpt-image-2.5 or fallback ag/gemini-3.1-flash-image
-> generated image completion/delivery
```

If no new owner inbound request arrives while Codex is executing, do not block deployment waiting for one. Mark only the real-channel manual acceptance as pending and report the exact one-line retry the owner should send. Automated transport/route proof is still mandatory.

## Rollback

Rollback immediately if any of the following occur after switch:

- OpenClaw health fails;
- non-image Agent tools regress;
- image route no longer reaches 9Router;
- image requests use a concrete model not selected by 9Router;
- detached task execution breaks before provider invocation;
- DeliveryEnvelope/image completion regression is detected.

Use the deploy script's protected rollback checkpoint and restore the previously live image/config as one coherent unit. Do not partially restore only the policy hook.

## Definition of done

This Goal is complete only when Codex reports:

- exact root-cause stage where `gpt-image-2` survived or reappeared, or proof that production was stale;
- exact authoritative native boundary used for the fix;
- source commit SHA;
- patch/release version if changed;
- focused test results;
- 9Router canonical Combo proof;
- deployed image identity;
- OpenClaw health after apply;
- final effective logical model observed at transport;
- whether real WhatsApp acceptance was completed or is the only pending manual item.

The success criterion is not merely “the hook rewrote the args”. The success criterion is:

**a model-authored concrete image model cannot reach the detached worker/provider transport, and every ordinary image request resolves through `openai/amadeus-image` into the 9Router `amadeus-image` fallback Combo.**
