# Amadeus image persona 1.7.5 — original request context source audit and rollback

Date: 2026-10-01 (Asia/Shanghai)
Status: `ROLLED_BACK_CONTEXT_SOURCE_INCOMPLETE`

## Evidence and cause

The applied candidate `local/openclaw-amadeus:git-4e514a361bec-20261001064552` was insufficient to guarantee the user's language. Inspection of the exact pinned OpenClaw 2026.9.4 source showed the lifecycle handle's `taskLabel` is populated from `request.prompt` (the image-generation prompt), not guaranteed original inbound user text. A Chinese user request paired with an English image prompt could therefore still be classified as English. The output language guard cannot reliably correct this when its language hint comes from model-produced prompt data.

The source correction now being implemented captures actual inbound `before_dispatch` body/content for WhatsApp and Telegram as a bounded, short-lived process-local session context. At accepted admission it snapshots a bounded combination of original user text plus the image prompt under runtime-owned taskId and separately derives `requestLanguage` only from the captured inbound text. Both fields remain untrusted context only; they do not affect task identity, channel/session routing, asset identity, or delivery ownership. Captured text is not logged or persisted.

## Rollback

The `4e514a3` candidate was rolled back again using protected checkpoint `/DATA/AppData/openclaw/backups/amadeus-openclaw-20261001064552`. The failed Compose was saved as `openclaw-compose.failed-original-language-context.yml` mode 0600; the pre-apply Compose was restored. The prior image tag was locally available, so no image rebuild was required for this rollback.

Post-rollback verification:

- running image: `local/openclaw-amadeus:git-628703c803e7-20260930184906`;
- source `VERSION=1.7.4`;
- OpenClaw health is healthy and `/healthz` passes;
- Gateway Amadeus registration is present after restart.

## Current work boundary

The request-source correction is now pushed as commits `2e60797` and `d8442d6`, but is not deployed. Do not claim Amadeus 1.7.5 is currently running, and do not reuse candidate `4e514a3`. The active Goal remains incomplete. The correction must pass focused proof that the typed context carries actual inbound request and language separately from a translated image prompt, then all source hard gates, a distinct immutable candidate, a protected checkpoint, apply, runtime identity/health/registration, actual-image caption smoke, and controlled delivery/lifecycle regressions. Manual owner acceptance remains operator-waived and must not be represented as performed.

## Current focused remediation evidence (not a release gate sign-off)

The correction now snapshots `before_dispatch` original text by channel/session and taskId, carries a distinct `requestLanguage`, and combines it with bounded `taskLabel` only as context. It is committed and pushed in `2e60797` and `d8442d6`. Full validation passes: delivery 82 plus pinned integration, Amadeus 116, typecheck/build, architecture, version/candidate fixtures, secrets and diff checks. A new distinct candidate and deployment gates remain pending; current 1.7.4 rollback is unchanged.


## Full source validation after original-text capture

The current boundary test injects Chinese original user text at `before_dispatch` plus a distinct English model image prompt and asserts both the bounded combined `requestContext` and `requestLanguage=chinese` reach accepted, failed and caption enrichment. Latest full gates on commits `2e60797`/`d8442d6` pass: `pnpm test:delivery` (82 tests plus pinned integration), `pnpm test:amadeus` (116 tests), `pnpm typecheck:amadeus`, `pnpm build:amadeus`, architecture, version/candidate fixtures, secrets and diff checks. Production remains 1.7.4; no corrected candidate is yet deployed.
