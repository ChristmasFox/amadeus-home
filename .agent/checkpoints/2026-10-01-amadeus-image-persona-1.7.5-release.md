# Amadeus image lifecycle natural persona messaging 1.7.5 — deployed and automatically verified

Date: 2026-10-01 (Asia/Shanghai)
Status: `COMPLETE_AUTOMATED_GATES_PASSED_MANUAL_OWNER_ACCEPTANCE_WAIVED`

## Source and immutable runtime

- Final source commit: `4e514a361becb9183b9208a5c8b764d5eb70c65d` (`fix(amadeus): enforce request language and retry caption`).
- Canonical Amadeus `VERSION`: `1.7.5`; release notes validated.
- OpenClaw: pinned `2026.9.4`.
- Immutable runtime tag: `local/openclaw-amadeus:git-4e514a361bec-20261001064552`.
- Runtime image ID / manifest: `sha256:cd1ac036a864a40e4c8d0b4ec81a3161ed360b5a2ab9fd47d6be40f39084b225`.
- `/opt/amadeus/VERSION` inside the running container reports `1.7.5`; the image marker is mode 0644 and directly readable by the runtime user.
- Running container reports the immutable candidate tag and Docker health `healthy`; `/healthz` passes.
- Gateway registration log after restart contains `amadeus native capability plugin registered`.
- Product Radar health passes.

## Protected rollback and incident handling

- Protected release checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20261001064552`; directory mode 0700, protected manifest mode 0600.
- Deployment evidence: `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261001064552/`.
- Earlier immutable candidate `e82f04d` was rolled back after the operator reported English accepted text for a Chinese request and image-only success delivery. The telemetry showed caption `model_error`. That incident, rollback, and source correction are recorded in `.agent/checkpoints/2026-10-01-amadeus-image-persona-1.7.5-postapply-symptom-rollback.md`.
- Final candidate is a distinct image built from corrected commit `4e514a3`; it was not the rejected image. Previous production source was rebuilt from immutable 1.7.4 commit `628703c803e7` for rollback, restored and verified healthy before the corrected rollout.

## Automated source and post-apply gates

All passed:

- `pnpm workflow:plan` selected Amadeus runtime scope; explicit authorized release used `scripts/deploy-openclaw.sh --apply --build-auto`.
- Release workflow source build, typecheck, full tests and secrets scan passed before image construction.
- Candidate node readability and runtime version preflight: passed (`OPENCLAW_IMAGE_AMADEUS_VERSION=1.7.5`).
- Protected checkpoint creation, CasaOS Compose apply, restart and post-apply health: passed.
- Real Gateway Amadeus registration and direct runtime product-version identity: passed.
- Post-deploy `pnpm test:delivery`: 80 tests passed, including the exact pinned OpenClaw integration contract; no canned success fallback, same-bubble image caption, caption-omission image delivery, semantic language matching, controlled deadlines/retries, and delivery/idempotency cases passed.
- Post-deploy `pnpm test:amadeus`: 114 tests passed.
- Post-deploy `pnpm typecheck:amadeus`, `pnpm check:architecture`, `pnpm check:secrets`, and `git diff --check`: passed.
- Actual-image caption smoke used a ready generated image from Asset Registry and the production configured OpenClaw multimodal path through the current `CaptionEnricher` source. It returned a valid bounded caption in 5,429 ms; only status, latency and length were retained, not caption text or image data.
- Controlled lifecycle tests prove Chinese/Japanese/English output matching, context propagation, >2-second success, wrong-language retry inside one overall deadline, localized safe fallback, and accepted semantic failure not cancelling generation.
- Controlled caption tests prove >8-second success, one bounded same-operation retry for early transient errors or language mismatch, timeout/error/invalid/unsupported omission, and that omitted caption never prevents the authoritative image send or adds a second text bubble. All retries remain inside one ~30-second wall-clock budget; provider timeout is reduced by elapsed time and fallback margin.
- Adapter tests preserve WhatsApp one-call same-bubble image caption, Telegram native media caption, document/upscale semantics, 2x/4x, and text/voice/TTS regressions.

## Acceptance boundary and remaining notes

- Manual owner WhatsApp/image-experience acceptance was **waived by operator authorization and was not performed**. The earlier operator-reported failure was treated as concrete technical evidence and caused rollback; the later corrected deployment passed required automated gates. No owner-channel acceptance claim is made.
- Deployment notification/outbox smoke is not manual acceptance.
- The deploy workflow emitted a non-blocking host-wide Docker default-log-policy warning (`/etc/docker/daemon.json` absent); managed service Compose log limits remained bounded and unknown owners remained report-only. This is unrelated to the image lifecycle Goal.
- The optional `media-organizer-adapter` network check was skipped because that external service was absent; it is outside this Goal's hard gates.
- Task coordinator and delivery settlement remain bounded process-local state; no cross-restart exactly-once claim is added.


## Superseded after source-truth audit

This release checkpoint records the prior `4e514a3` apply. A later audit of the exact pinned OpenClaw source found that `taskLabel` is model-produced `request.prompt`, not guaranteed original inbound text. The candidate was rolled back again; production is now 1.7.4 pending a source change that captures original inbound context separately. Do not use this checkpoint as evidence that 1.7.5 remains deployed. See `.agent/checkpoints/2026-10-01-amadeus-image-persona-1.7.5-original-request-context-rollback.md`.
