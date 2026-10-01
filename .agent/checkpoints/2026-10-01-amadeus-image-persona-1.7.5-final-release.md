# Amadeus image lifecycle natural persona messaging 1.7.5 — final release

Date: 2026-10-01 (Asia/Shanghai)
Status: `COMPLETE_AUTOMATED_GATES_PASSED_MANUAL_OWNER_ACCEPTANCE_WAIVED`

## Final source and runtime identity

- Canonical Amadeus `VERSION`: `1.7.5`; current release notes validate.
- Final source/deployment commit: `5444b3a94a8225fc8aec62a4d5abf307a0f8e6d5` (includes implementation commits `2e60797` and `d8442d6`).
- Immutable OpenClaw 2026.9.4 image: `local/openclaw-amadeus:git-5444b3a94a82-20261001073247`.
- Image ID/manifest list: `sha256:9cf73623e0a2a496c82cf7de2641cd693868205e4114b0da4a3e0f621b3076db`.
- Live container runs that exact tag with Docker health `healthy`; `/opt/amadeus/VERSION` reports `1.7.5`; `/healthz` passes.
- Real Gateway logs confirm `amadeus native capability plugin registered` after restart. Product Radar health passes.

## Protected rollback checkpoint

- `/DATA/AppData/openclaw/backups/amadeus-openclaw-20261001073247`.
- Checkpoint directory mode 0700; `backup-manifest.json` mode 0600.
- Deployment evidence directory: `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261001073247/`.
- The earlier 1.7.5 application and rollback incidents are retained in `.agent/checkpoints/2026-10-01-amadeus-image-persona-1.7.5-postapply-symptom-rollback.md` and `.agent/checkpoints/2026-10-01-amadeus-image-persona-1.7.5-original-request-context-rollback.md`.

## Final source gates

Before candidate construction, the canonical release workflow passed dependency builds, typecheck, all package tests (Amadeus 116 tests), pinned OpenClaw integration contract, architecture, version consistency and secret scans. Candidate node readability and product-version preflight passed. The corrected commit contains the Dockerfile/version-tool permission fix, so `/opt/amadeus/VERSION` is readable by the runtime `node` user.

## Post-deploy automated acceptance

All required automated gates passed:

- `pnpm test:delivery`: 82 tests plus `DELIVERY_BOUNDARY_PINNED_AST_AND_PROVIDER_CONTRACT=passed`.
- `pnpm test:amadeus`: 116 tests passed.
- `pnpm typecheck:amadeus`, `pnpm check:architecture`, `pnpm check:secrets`, and `git diff --check` passed after apply.
- Runtime Amadeus version identity, OpenClaw health, Gateway registration and Product Radar health passed.
- Direct actual-image smoke ran the current `createImageCaptionEnricher` against a ready generated Asset Registry image, using Chinese original request context and a separate English model image prompt. It returned a valid bounded caption in 6,683 ms; only status, character count and latency were retained (no image or caption text).
- Controlled lifecycle tests prove original inbound body is captured at `before_dispatch`, combined separately with the model-generated image prompt, and a runtime-derived `requestLanguage` reaches accepted/failed semantic generation and caption enrichment. Chinese original text remains authoritative when the image prompt is English.
- Fake-timer tests prove >2-second lifecycle and >8-second caption success, retries on language mismatch/transient caption error share one ~30-second deadline, lifecycle timeout never cancels/retries image generation, and caption omission never prevents image delivery.
- Failure/invalid/timeout tests prove no canned success text, image-without-caption delivery, one native same-bubble image send for valid caption, and preservation of WhatsApp/Telegram, document/upscale, 2x/4x, text/voice/TTS contracts.

## Operator acceptance boundary

Manual owner WhatsApp/image-experience acceptance was **operator-waived and not performed**. An earlier real user report of English accepted text/image-only delivery was treated as hard failure evidence and caused rollback before the source correction. The later corrected release is supported by the automated evidence above; no manual owner acceptance is claimed. Deployment notification/outbox smoke is separate from that waived gate.

Non-blocking deployment advisory: the host-wide Docker default log policy reported `/etc/docker/daemon.json` absent; managed Compose services retain bounded log options, and unknown owners remain report-only. The optional media-organizer-adapter network smoke was skipped because that external service was absent; both are outside this Goal's hard gates. The bounded process-local lifecycle/delivery state does not claim cross-restart exactly-once durability.
