# Amadeus image persona 1.7.5 — post-apply behavior failure and rollback

Date: 2026-10-01 (Asia/Shanghai)
Status: `ROLLED_BACK_AFTER_USER_REPORTED_HARD_BEHAVIOR_FAILURE`

## Applied candidate

- Source commit: `e82f04d` (contains 1.7.5 implementation plus candidate-version readability fix).
- Canonical product marker in the runtime: `1.7.5`.
- Immutable image tag: `local/openclaw-amadeus:git-e82f04dd03be-20261001060150`.
- Image manifest: `sha256:ea095b46d11ebe7b79c8e030c14ac9c86b311d67db532340e97003972a1d1389`.
- Release script gates passed at apply time: candidate node/version preflight, OpenClaw health, real Gateway Amadeus registration, Product Radar health, NAS read-only smoke, owner outbox smoke. Source tests/typecheck/build/architecture/secrets checks also passed.

## Hard behavior failure observed after apply

The operator reported that the task-start response was English after a Chinese request and successful generation delivered only an image. Treat this report as concrete runtime failure evidence, not as waived manual acceptance.

Content-safe OpenClaw telemetry for the reported WhatsApp task:

- accepted lifecycle semantic call: `semantic_status=generated`, `elapsed_ms=2651`, `request_context_present=true`;
- caption enrichment: `semantic_status=omitted`, `semantic_fallback_reason=model_error`, `elapsed_ms=46`, `request_context_present=true`.

No message text, prompt, image content, credentials or provider payload is retained. A focused direct run of the same Amadeus caption enricher source against a registered generated image subsequently produced a valid result within 9,832 ms; this demonstrates that the configured multimodal path can succeed, but does not erase the failed live task evidence.

The source was immediately corrected to add request-language-specific output constraints plus a language-mismatch validation/retry for lifecycle and caption output, bounded same-operation retries for wrong-language outputs and early transient caption-provider errors within the same overall deadline, and safe error-class/code telemetry without raw provider messages. Focused tests cover the reported English-for-Chinese case and transient caption recovery.

## Automatic rollback evidence

Protected release checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20261001060150` (directory mode 0700; sensitive checkpoint files mode 0600). The failed 1.7.5 Compose was saved as `openclaw-compose.failed-1.7.5.yml` mode 0600; the pre-apply Compose was restored from `openclaw-compose.before.yml`.

The prior image tag was no longer present locally when rollback started. It was rebuilt from immutable source commit `628703c803e7` (`VERSION=1.7.4`) and loaded under the checkpoint's prior image tag `local/openclaw-amadeus:git-628703c803e7-20260930184906` (rebuilt image config ID `sha256:d538ca499b3141220206962f50ab8cd97718c21f26b33160dc0ff738326173e3`; rebuilt manifest list `sha256:960a38653a1ec703073a17108536548287cc8cb92ee8a8ece39403a33897e100`). Compose restoration and OpenClaw restart then succeeded.

Post-rollback verification:

- running image is the `628703c803e7` rollback tag;
- its source commit resolves to `VERSION=1.7.4`;
- OpenClaw Docker health is `healthy` and `/healthz` passes;
- real Gateway log confirms Amadeus registration after restart;
- the failed 1.7.5 image is not running.

The 1.7.5 candidate is rejected and must not be reused. No owner WhatsApp acceptance is claimed; the operator waiver remains in force. The user-provided failure report is kept as a hard technical acceptance failure. The Goal remains incomplete until a distinct corrected 1.7.5 candidate passes all gates and is deployed.


## Current source remediation verification

The uncommitted language-lock/retry correction now passes `pnpm test:delivery` (80 tests plus pinned integration), `pnpm test:amadeus` (114 tests), `pnpm typecheck:amadeus`, `pnpm build:amadeus`, `pnpm check:architecture`, Amadeus version and candidate-deploy fixtures, `pnpm check:secrets`, and `git diff --check`. The correction is not yet committed or deployed; this evidence does not change the rollback state above.


## Resolution

Commit `4e514a361becb9183b9208a5c8b764d5eb70c65d` corrected request-language validation/retries and bounded caption transient recovery. Its distinct immutable candidate is now deployed and automatically verified; current runtime is Amadeus 1.7.5. See `.agent/checkpoints/2026-10-01-amadeus-image-persona-1.7.5-release.md` for final gate evidence and explicit manual acceptance waiver.

## Subsequent original-request source audit and rollback

A final audit of the exact pinned OpenClaw 2026.9.4 module showed `handle.taskLabel` is populated from `request.prompt` (the model-produced image prompt), not guaranteed original inbound user text. That explains why an English translated image prompt could still drive an English accepted reply after the `4e514a3` language guard. The `4e514a3` candidate was rolled back again to the protected pre-apply 1.7.4 Compose from the same checkpoint; the previous image tag was present, so no rebuild was required. Current health and Gateway registration passed on `local/openclaw-amadeus:git-628703c803e7-20260930184906`.

The new source captures bounded `before_dispatch` inbound text in short-lived channel/session context, snapshots it per taskId, carries its derived language separately from the model image prompt, and passes both through lifecycle and caption semantic input. This source is not yet committed or deployed. Detailed evidence and the new rollback's exact Compose snapshot are in `.agent/checkpoints/2026-10-01-amadeus-image-persona-1.7.5-original-request-context-rollback.md`.
