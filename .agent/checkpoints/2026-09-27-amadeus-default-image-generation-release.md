# Amadeus 1.6.4 — Default Image Generation Release Checkpoint (2026-09-27)

## Scope and authorization

- Goal: `docs/AMADEUS_DEFAULT_IMAGE_GENERATION_GOAL.md`.
- The owner explicitly approved `browser.ssrfPolicy.dangerouslyAllowPrivateNetwork=true` for the shared private-network path required by the pinned OpenClaw image provider to reach the existing internal 9Router service.
- Source branch: `codex/amadeus-default-image-generation-2026-09`; implementation commits `ac021ae` (1.6.3) and `b389e86` (1.6.4). The branch is committed locally; remote push/merge is separate.
- Release version: `1.6.4`, advanced by `scripts/amadeus-version.sh bump patch` with a single-release Chinese `RELEASE_NOTES.md`.

## Canonical implementation

- Existing `models.providers.openai` remains pointed at the internal 9Router endpoint and reuses the `OPENCLAW_9ROUTER_API_KEY` SecretRef/env source.
- `models.providers.openai.models` declares `ag/gemini-3.1-flash-image`; `agents.defaults.mediaModels.image.primary` is `openai/ag/gemini-3.1-flash-image`; `timeoutMs` is `180000`.
- `browser.ssrfPolicy.dangerouslyAllowPrivateNetwork=true` is required by the pinned OpenClaw 2026.9.4 image provider for this private endpoint. No Google credential/path, custom provider, duplicate tool, keyword router, model ID in Skills, or SOUL/global AGENTS workflow was introduced.
- The native tool is `image_generate`; the scoped `plugins/amadeus/skills/image-generation/SKILL.md` guides semantic new-image intent without fixed trigger phrases. Global `tts` and generic `message` denies remain unchanged.

## Validation and transport evidence

- Passed: `python3 scripts/test-openclaw-speech-config.py`, `pnpm build`, `pnpm typecheck`, full `pnpm test` (Python 3.11.16 shim because the system Python 3.9.6 lacks an API used by an existing test), `pnpm check:secrets`, `git diff --check`, and `scripts/amadeus-version.sh check`.
- Pinned OpenClaw 2026.9.4 config validation passed. Runtime plugin inspection shows the bundled `openai` image-generation provider loaded; the scoped Skill is eligible. The runtime tool factory plus owner-specific policy reproduction includes `image_generate` while keeping `tts`/`message` denied.
- Direct authenticated transport smoke from the OpenClaw container submitted `ag/gemini-3.1-flash-image`; 9Router returned HTTP 200 and one valid JPEG (569,192 bytes). The image bytes/base64 were processed only in memory and were not logged or persisted. This transport test is not Agent/channel acceptance.

## Production apply and rollback

- 1.6.3 image/config apply: `local/openclaw-amadeus:git-ac021ae81ac4-20260927082000`; pre-change checkpoint `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260927082000`; post-deploy evidence `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260927082000`.
- 1.6.4 image: `local/openclaw-amadeus:git-b389e869d6a2-20260927084301`; Product Radar reused `local/product-radar:git-d988000e1c5d-20260924130631`. OpenClaw and Product Radar health passed. Pre-1.6.4 checkpoint `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260927084301` contains `openclaw-config.before.json` mode 0600; checkpoint directory was tightened to mode 0700. Post-deploy evidence: `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260927084301` (mode 0700). The deploy reported the pre-existing `LOG_POLICY=warning`; post-deploy maintenance passed.
- Roll back the 1.6.4 skill release by restoring the 1.6.4 checkpoint’s `openclaw-config.before.json` to `/DATA/AppData/openclaw/config/openclaw.json`, restore the recorded 1.6.3 image in `/var/lib/casaos/apps/openclaw/docker-compose.yml`, then run only `docker compose up -d --no-build openclaw` and verify health. Keep the separate 1.6.3 checkpoint if a full removal of image-generation config is ever needed. Do not restart 9Router or TTS.

## Acceptance

- On 2026-09-27 the owner confirmed: “已验收 一切正常可以收尾” after the request for real owner-channel acceptance. This is the content-safe owner attestation for generated image delivery, ordinary typed-text isolation, and inbound voice/TTS behavior; no generated image or prompt artifact is retained in Git.
- Additional read-only check: host TTS `/healthz` returned HTTP 200/ready and LaunchAgent PID 50062, last exit 0. The separate TTS matrix PID 79839 is no longer present; neither release restarted TTS.
- CLI-driven agent diagnostics were not counted as owner-inbound acceptance: their fresh session compiled only `web_fetch`/`web_search` under the CLI sender context. No claim is made that those CLI turns demonstrated `image_generate`; the owner’s explicit real-channel acceptance is the final channel evidence.
