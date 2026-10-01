# Current Task — Amadeus 1.8.0 reference-image route completion

Date: 2026-10-01 (Asia/Shanghai).

Active Goal: `docs/AMADEUS_IMAGE_ROUTE_AUTHORITATIVE_FIX_GOAL.md`.
Current live release: **Amadeus 1.8.0** (`VERSION=1.8.0`).
Deployment: source commit `2244f98` is live; release notes validated.
Status: `DEPLOYED_AUTOMATED_GATES_PASSED_MANUAL_OWNER_REFERENCE_IMAGE_ACCEPTANCE_PENDING`.

The 1.8.0 immutable image is live:
`local/openclaw-amadeus:git-2244f98140e0-20261001145719` (image ID
`sha256:c418bc6397c713c401ed9bc060542d3464318c4c1f6cb9c6b1b38f14ce8c4e35`).
OpenClaw is healthy, Gateway registration is present, and the post-deploy live
reference fixture passed. The prior 1.7.9 reference-image failures (21:37 and
21:43 +08) returned HTTP 500; prompt-only requests succeeded.

Root cause is now established: a reference image makes the pinned OpenClaw
OpenAI adapter POST multipart to `/v1/images/edits`, but the live 9Router
0.5.91 route manifest has only `/api/v1/images/generations`. A content-free
empty multipart probe to `/v1/images/edits` reproduced HTTP 500 and the supplied
Next.js `Failed to find Server Action` log. This is a missing edit endpoint,
not a surviving model override or stale-browser issue. The existing 9Router
`/images/generations` adapter already carries one `image` through Codex
`input_image` and Gemini `inlineData` within the unchanged Combo.

Released 1.8.0 adapts one PNG/JPEG/WebP reference (bounded to 10 MiB) into the
existing logical `openai/amadeus-image` JSON generation request, preserving the
reference bytes through both Combo attempts. The existing primary/fallback
order, provider accounts, credentials and 9Router source remain unchanged.
Multiple references fail closed before task admission instead of being dropped.
Focused native request-body, MIME/size, non-target multipart, and exact live
9Router byte-preservation fixtures pass. No paid reference-image transport request was sent during deployment. The live
post-deploy route fixture preserves bytes and blocks multi-reference input
without HTTP. The release image is live; real owner reference-image acceptance
remains pending.

Deployment checkpoint/evidence:
`.agent/checkpoints/2026-10-01-amadeus-1.8.0-reference-route-deploy.md`.

Protected rollback checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20261001145719`.
