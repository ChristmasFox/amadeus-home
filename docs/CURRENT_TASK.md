# Current Task — Amadeus 1.8.1 structured reply reliability

Date: 2026-10-02 (Asia/Shanghai).

Active Goal: none; the prior image-route Goal is complete.
Current live release: **Amadeus 1.8.1** (`VERSION=1.8.1`).
Deployment: source commit `2525d38` is live; release notes validated.
Status: `DEPLOYED_AUTOMATED_GATES_PASSED_STRUCTURED_REPLY_FALLBACK_LIVE`.

The 1.8.1 immutable image is live:
`local/openclaw-amadeus:git-2525d3892169-20261002063108` (image ID
`sha256:6d9b88d0f53664e58504ebbce1b8e7fbe647f9bf3f42ac7876d7d20edf447e77`).
OpenClaw is healthy, Gateway registration is present, and the 1.8.0 reference
route remains live under the new image.

Malformed structured Agent JSON now receives a bounded visible Chinese fallback
instead of being silently dropped. Literal control characters inside JSON
strings are repaired safely; other malformed protocol output never reaches a
channel sender. Safe run correlation metadata is logged without raw model text.
External turns use the existing `nine_router/arthur-combo` model route; web search
provider selection remains a separate retrieval configuration.

The release gates passed: 124 Amadeus tests, build/typecheck, secrets scan,
plugin/config preflight, OpenClaw and Product Radar health, Gateway registration,
NAS read-only smoke, owner notification/outbox smoke, and post-deploy maintenance.
The optional media adapter was absent, so its network smoke was skipped.

Deployment checkpoint/evidence:
`.agent/checkpoints/2026-10-02-amadeus-1.8.1-structured-reply-release.md`.

Protected rollback checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20261002063108`.
