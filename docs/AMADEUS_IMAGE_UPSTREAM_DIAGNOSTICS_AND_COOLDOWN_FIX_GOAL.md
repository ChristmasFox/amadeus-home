# Amadeus Cloud Image Upstream Diagnostics and False-30s-Lock Fix — Goal

Date: 2026-10-09 (Asia/Shanghai)
Baseline: Amadeus 1.10.0 commit `a1983e9b637d29b0f731d9ad1b9ee023a35967d9`; 9Router npm `0.5.95`
Status: COMPLETE; deployed and accepted on 2026-10-09 after the final compiled-runtime fix.

## User-visible result

On a WhatsApp reference-image edit or normal cloud image generation failure, the operator must be able to determine why the request failed, not see an invented Plus/Pro entitlement diagnosis. A request-specific Codex image failure must not make an otherwise healthy account/model unavailable for a blanket 30 seconds. The native 9Router fallback order remains **sunburst → flare → gpt-image-2.5**, and the existing terminal safety-refusal rule stays terminal.

Do not modify the separate public/LAN Qwen Image Lab. Do not enable local Qwen for normal WhatsApp generation.

## Baseline facts and root-cause hypothesis

- Current production target: `openai/amadeus-image` → 9Router `/v1/images/generations` JSON with optional exact one-image data URI. The JSON reference must be replayed *unchanged* to each model.
- Upstream 9Router `v0.5.95` `open-sse/handlers/imageProviders/codex.js` extracts base64 only from `response.output_item.done` / `image_generation_call.result`; if none, it throws `Codex did not return an image. Account may not be entitled (Plus/Pro required).` The string is **not evidence of account entitlement**.
- `open-sse/handlers/imageGenerationCore.js` converts a parse exception to HTTP 502.
- `src/sse/handlers/imageGeneration.js` calls `markAccountUnavailable` for failed image calls; unmatched 502 goes through `TRANSIENT_COOLDOWN_MS=30_000` in `open-sse/config/errorConfig.js` / `accountFallback.js`, persisting `modelLock_*` and then `all accounts locked ... reset after 30s`.
- Amadeus `classifyImageGenerationFailure` currently matches the misleading entitlement text before it inspects actual status 502, hiding the provider failure.
- The repo's 9Router container starts `/usr/local/lib/node_modules/9router/app/custom-server.js` from npm `0.5.95`. The pinned upstream Docker base also has an older standalone `/app`. Never claim tests against `/app/.next/server` prove production behavior.

## Hard invariants

1. **No generated image, reference bytes, base64, data URL, prompt text, auth headers, bearer credentials, cookies, account email, original unredacted upstream body or whole SSE event in logs.** No logging of response JSON or `input`/`tools` payloads. Never log `image_generation_call.result` or `partial_image_b64`. Protect against error-message echo of private prompts; log type/code/status and a bounded allowlisted error summary only.
2. Keep existing Codex 401/403 refresh, 429/quota/exact upstream `resets_at` backoff and actual account-scoped failures untouched. No global cooldown reset to zero; do not disable fallback protections for text/chat, ASR, TTS, or other providers.
3. Do not automatically retry another model to bypass a **confirmed provider safety/policy refusal**. Stop Combo immediately, including if the original upstream failure arrived as HTTP 200 + SSE `response.failed`; preserve the original safety guard for both new and old shapes.
4. Keep strict 0.5.95 runtime pin, model/order/account allowlist, 20 MB server body limit, reference byte+MIME fidelity, single WhatsApp image+caption lifecycle, and output model attribution.
5. No live service/container/database mutation, model request, or deploy without explicit apply. Do not install npm packages inside the running container; use immutable build and existing rollback script.

## Implementation A — truthful Codex image SSE terminal-state handling (P0)

Inspect the **exact npm 0.5.95 compiled adapter**, not just upstream source. Implement a source-controlled, idempotent, shape/version-guarded patch applied in `infra/docker/casaos/9router/Dockerfile` to the effective npm server bundle. Fail build on 0/2+ matches or drift, and test install + verify modes. Keep the upstream source links documented alongside the patch.

Parse SSE with chunk boundaries, CRLF delimiters, `TextDecoder` streaming flush, and trailing final event. Preserve these semantic outcomes without saving any image bytes:

- `response.output_item.done` with valid `image_generation_call.result` → image success.
- `response.failed` / `response.error` / structured terminal error → typed `upstream_failed` with safe upstream `error.type`, `error.code`, HTTP status if known and optional recognized reason (e.g. `server_overloaded`, `rate_limit_exceeded`, `content_policy_violation`).
- `response.completed` without a valid image result → typed `image_result_missing`, **not** "Plus/Pro required".
- Clean end-of-stream without a terminal event → `sse_incomplete`; premature socket abort → `transport_interrupted`.
- Known explicit refusal / safety event → `safety_refusal` (terminal).
- Never infer entitlement solely from missing image; only an explicit upstream auth/permission response can be classified account-scoped.

Do not treat progress-only or partial-image SSE as completion. In streaming mode, do not send an HTTP-200 false completion: downstream must observe a terminal typed error if the image is missing. Do not add an automatic unconditional replay after response consumption.

## Implementation B — scoped 30-second false-lock repair (P0)

In the actual *image-specific* 9Router credential failure path, distinguish **request-scoped** `image_result_missing`, `sse_incomplete`, `transport_interrupted`, confirmed `safety_refusal`, and request validation errors from **account-scoped** errors.

- Those request-scoped failures must **not write** `modelLock_${model}`, `rateLimitedUntil`, `testStatus=unavailable` or `backoffLevel`, and must not change locks on any other model; 502 may still be used as an HTTP envelope for operational errors.
- A request-scoped failure may continue to the next Combo model only when retryable; confirmed safety refusal and invalid request terminate as above.
- A genuine provider 429, exhausted quota, invalid credentials, and explicit `resets_at` must retain existing configured backoff/lock semantics. Genuine provider-wide overload should retain bounded protection with reason-coded scope rather than be misreported as entitlement.
- The three image model IDs share the configured **one specified account**; a failure of one model must not accidentally select any other Codex account.
- Do **not** solve by changing global `TRANSIENT_COOLDOWN_MS`, editing the running SQLite DB or suppressing errors in the UI.

Prefer a typed failure object/code propagated by the Codex adapter through imageGenerationCore and imageGeneration route. If the compiled npm bundle precludes clean typed propagation, use only a narrowly-scoped, separately tested shape-guarded build patch; no broad regex replacing arbitrary 502s.

## Implementation C — correlated bounded diagnostics (P0)

Use one non-secret image trace ID per original OpenClaw image job, carried through 9Router Combo and all 3 model attempts; include the existing task ID in Amadeus logs when available, but never leak session/message IDs to public clients. Each attempt should generate one structured summary on termination:

```json
{
  "event": "amadeus_cloud_image_attempt",
  "traceId": "short-opaque-id",
  "model": "cx/gpt-image-2.5-flare",
  "operation": "edit",
  "attempt": 2,
  "outcome": "upstream_failed",
  "upstreamStatus": 200,
  "upstreamErrorType": "server_error",
  "upstreamErrorCode": "server_overloaded",
  "lastSseEvent": "response.failed",
  "terminalEventSeen": true,
  "imageResultSeen": false,
  "cooldownDecision": "none",
  "elapsedMs": 1846
}
```

Example is synthetic; never claim a live error was observed. Allowlist all string fields, bound lengths, and never interpolate unknown provider message, prompt, URL, token, SSE data or image into logs. Preserve enough detail to distinguish `server_overloaded`, explicit moderation refusal, account quota, missing image result, SSE truncated, transport error, and parser mismatch. Correlate 9Router summaries with Amadeus `image_route_*` lifecycle; log one terminal aggregate per job with attempted models and final reason, no image payload.

Use the router's `x-amadeus-image-model` success header already in Amadeus 1.10.0. If adding an internal correlation header, sanitize its format, length, logging and propagation; do not change other provider request headers.

## Implementation D — Amadeus classification fix (P1)

In `integrations/openclaw/delivery-boundary/image-route-authority.mjs` correct the failure classification priority:

- confirmed safety refusal > explicit account auth/quota statuses/codes > invalid request > explicit transient HTTP 5xx/timeout > unknown;
- the legacy string `Account may not be entitled (Plus/Pro required)` alone must not be an authoritative entitlement determination; paired with status 502 it is a provider/parse failure;
- recognize new typed codes; do not feed raw upstream error messages into WhatsApp text;
- no second replay of the entire three-model cloud Combo, preserve `AMADEUS_QWEN_IMAGE_FALLBACK_ENABLED=0`.

Update unit tests for both structured and legacy failures.

## Acceptance tests (must execute against the effective npm 0.5.95 runtime)

1. Synthetic valid image result → one model, valid output.
2. `response.failed` carrying `server_overloaded` → exact typed diagnostic, no bogus "Plus/Pro required", bounded Combo continuation per policy, no *false account-level* 30-second lock.
3. HTTP 200 + `response.completed` with no image, and clean EOF without terminal → distinguish `image_result_missing` vs `sse_incomplete`, no 30-second credential lock; both can try next model where eligible.
4. Real HTTP 429/quota + `resets_at` → lock preserved, no unauthorized account switch.
5. Explicit SSE safety refusal → terminal, **only first model** attempted, no cross-model bypass.
6. 502 → 502 → success → order `sunburst,flare,2.5`, same unchanged reference image data-URI/MIME in every request, success model header equals `cx/gpt-image-2.5`; no duplicate whole-Combo retry.
7. All three operational failures → one structured terminal error and one WhatsApp failure message; no false model-success attribution.
8. Streaming partial image + terminal fail is **not** considered success.
9. Secret/prompt/cookie/JWT/email/base64 sentinel audit: absent from logs and diagnostic payloads even for malicious/error-echo inputs; log caps and rate limiting.
10. Test the **actual** `/usr/local/lib/node_modules/9router/app/.next-cli-build/server` runtime bundle. Update `scripts/verify-9router-image-fallback.py` so it no longer tests only the obsolete base `/app/.next/server`. Keep the reference contract fixture `http_requests=0` separate from a manually authorized real edit smoke.

Never update expected test strings without executing and observing the actual assertions. Run pinned source tests, image policy and authorization tests, security/secrets scan, isolated new-image smoke; a **real one-image edit smoke** is still required before calling the incident resolved. Log only bounded evidence and a private rollback checkpoint.

## End-state evidence — 2026-10-09

- Runtime source commit: `ed872b3f3978` (the follow-up verification-fixture correction is
  `f74a4fc`). The operator explicitly approved `--apply`; only 9Router was rebuilt and
  restarted. OpenClaw remained on `local/openclaw-amadeus:git-a1983e9b637d-20261009090331`.
- Deployed image: `local/9router:git-ed872b3f3978-20261009T130134Z`, manifest digest
  `sha256:1a068329307c0a46f7699bfe05034f7375891113adddd3efb44ce7b23aa97045`, build
  The pre-switch old-image export was recorded with SHA-256
  `3aae42b3a0b333e1df7b46b08e56fbbae4a4b6357e59f20fcd21e30ac4399ed9`.
  Protected rollback checkpoint:
  `/DATA/AppData/9router/backups/router-upgrade-20261009T130134Z`.
- The effective npm 0.5.95 CLI bundle, not the obsolete `/app` bundle, reports
  `9ROUTER_IMAGE_UPSTREAM_DIAGNOSTICS=verified` and `9ROUTER_POLICY=verified`.
  The effective route SHA-256 is
  `46a9032286fdd5688db1b668785f2f3dda6f6dcbc19c378b970ce5ab7f9bf356`.
- Focused source tests, `pnpm test:amadeus` (137/137), secrets scan, runtime policy,
  Combo safety, reference preservation and fallback checks passed. The live diagnostic
  fixture passed for valid results, `image_result_missing`, `sse_incomplete`,
  `upstream_failed`, `safety_refusal`, `account_unavailable`, partial-image terminal
  failure, `transport_interrupted`, and boolean diagnostic types.
- The exact compiled account selector proved request-scoped 502 (`amadeus_image_image_result_missing`)
  returned `{shouldFallback:true,cooldownMs:0}` with zero provider-state updates. A
  genuine 429 fixture retained `cooldownMs:420000` and performed one native state update.
  The live active Codex row remained `testStatus=active`, `errorCode=null`,
  `backoffLevel=0`, no `lastError`, and all three image model locks null after the
  failed edit trace.
- The unchanged-reference fixture passed the required `502 → 502 → success` order:
  `cx/gpt-image-2.5-sunburst → cx/gpt-image-2.5-flare → cx/gpt-image-2.5`; it also
  verified byte/MIME preservation and the success `x-amadeus-image-model` header.
- Real one-image edit smoke reached the live path. A successful trace used
  `cx/gpt-image-2.5-sunburst` with `imageResultSeen:true` and no cooldown. A later
  naturally occurring provider failure produced one bounded terminal trace with exactly
  the three configured attempts, all `502/upstream_failed/cooldownDecision:none`, and
  returned the typed `amadeus_image_upstream_failed` envelope. Neither trace emitted
  the legacy Plus/Pro entitlement text.
- Rollback is the compose-only path in `scripts/deploy-9router.sh`: restore
  `docker-compose.yml` from the checkpoint above and run
  `cd /var/lib/casaos/apps/9router && docker compose up -d --no-build 9router`.
  The checkpointed SQLite copy is retained for investigation; it is not blindly copied
  over the live database.

## Workflow / deploy boundary

- Start by reading `docs/CONTEXT.md`, `docs/CURRENT_TASK.md` and the 1.10.0 diff; inspect the actual built 0.5.95 runtime before writing compiled patch anchors.
- Submit source + tests to a scoped commit, with readable status showing which synthetic tests actually ran.
- Run `scripts/deploy-9router.sh --dry-run` before any apply. The repository has an immutable image build/isolated fixture/checkpoint/rollback flow; preserve that path.
- Deploy/restart only after the operator explicitly asks. Until then, no claim that the 30-second mislock is fixed in production.
- Once deployed, collect one naturally occurring failed reference-edit trace with redacted structured output; identify the **actual** upstream code/reason or state `image_result_missing` if provider emitted no reason. Do not guess a policy refusal or entitlement issue from a generic 502.

## End-state report format

Provide: source commit, 9Router image digest, whether deploy occurred, 0.5.95 compiled patch verification, tests run/results, no-lock-on-request-failure proof, genuine-429-preserved proof, three-model reference-preservation proof, first safe diagnostic trace + interpretation, and exact rollback location if deployed.
