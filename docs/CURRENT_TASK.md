# Current Task — Amadeus 1.8.0 reference-image route completion

Date: 2026-10-01 (Asia/Shanghai).

Active Goal: `docs/AMADEUS_IMAGE_ROUTE_AUTHORITATIVE_FIX_GOAL.md`.
Current live release: **Amadeus 1.7.9**.
Candidate: **Amadeus 1.8.0** (`VERSION=1.8.0`; release notes validated).
Status: `REFERENCE_ADAPTER_IMPLEMENTED_FOCUSED_FIXTURES_PASSED_READY_FOR_RELEASE_GATES`.

The 1.7.9 native route-authority change is live in
`local/openclaw-amadeus:git-0868fb2b1c81-20261001133405` (image ID
`sha256:02fcbce4df5914174924ac683994467b6ab6452851d16343396cc27b7e6d8`).
Its safe route logs show the Agent supplied no model override, native resolution
selected `openai/amadeus-image`, and 9Router was reached. Two post-deploy
reference-image tasks (21:37 and 21:43 +08) returned HTTP 500; prompt-only
requests succeeded.

Root cause is now established: a reference image makes the pinned OpenClaw
OpenAI adapter POST multipart to `/v1/images/edits`, but the live 9Router
0.5.91 route manifest has only `/api/v1/images/generations`. A content-free
empty multipart probe to `/v1/images/edits` reproduced HTTP 500 and the supplied
Next.js `Failed to find Server Action` log. This is a missing edit endpoint,
not a surviving model override or stale-browser issue. The existing 9Router
`/images/generations` adapter already carries one `image` through Codex
`input_image` and Gemini `inlineData` within the unchanged Combo.

Candidate 1.8.0 adapts one PNG/JPEG/WebP reference (bounded to 10 MiB) into the
existing logical `openai/amadeus-image` JSON generation request, preserving the
reference bytes through both Combo attempts. The existing primary/fallback
order, provider accounts, credentials and 9Router source remain unchanged.
Multiple references fail closed before task admission instead of being dropped.
Focused native request-body, MIME/size, non-target multipart, and exact live
9Router byte-preservation fixtures pass. No paid transport request has been
sent for the candidate. Repository release gates and deployment still need to
run; do not treat the candidate as live.

Prior 1.7.9 deployment checkpoint/evidence:
`.agent/checkpoints/2026-10-01-amadeus-1.7.9-image-route-authoritative-fix.md`.
