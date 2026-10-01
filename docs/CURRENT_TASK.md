# Current Task — Amadeus 1.7.8 image-generation repair

Date: 2026-10-01 (Asia/Shanghai).

Active Goal: none.
Previous live release: **Amadeus 1.7.7** (owner retry reproduced failure).
Target release: **Amadeus 1.7.8**.
Status: `DEPLOYED_AUTOMATED_GATES_PASSED_AWAITING_OWNER_DM_ACCEPTANCE`.

Source commit `9f23572` is pushed to `main`. Immutable OpenClaw 2026.9.4 image
`local/openclaw-amadeus:git-9f2357210a07-20261001112610` (image ID
`sha256:c5c1b2d410e25b98bb71c7bf6212699f35b5a8714141c297d8bd0522143d624e`)
is live on OrbStack `nyannyan`; runtime `/opt/amadeus/VERSION=1.7.8`, OpenClaw
and Product Radar health pass, and Amadeus plugin registration is present.
Protected rollback checkpoint:
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261001112610` (directory
0700, manifest 0600); content-safe evidence is under
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261001112610`.

The 1.7.7 retry showed why its model hook was insufficient: OpenClaw shallow-merges
returned tool params, so omitting the `model` key preserved `openai/gpt-image-2`.
1.7.8 writes a blank sentinel, which native parsing treats as no override, and
uses the configured `openai/amadeus-image` capability/fallback. The same task's
language capture used a blank `body` despite non-empty `content`; 1.7.8 falls back
to the first non-empty field. No rollback was performed.

Pre-apply gates passed: delivery suite 84 plus pinned integration, Amadeus suite
121, typecheck/build, architecture checks/fixtures, version validation, secrets
scan and `git diff --check`. Post-apply OpenClaw/Product Radar health, plugin
registration, NAS read-only smoke, owner notification/outbox smoke, and
post-deploy maintenance passed. The optional media adapter network check was
skipped because the service was absent; the host Docker log-policy advisory is
non-blocking. See
`.agent/checkpoints/2026-10-01-amadeus-1.7.8-image-route-repair.md`.

No new paid transport smoke or manual post-deploy owner DM acceptance was
performed. Owner-channel confirmation remains pending; notification/outbox smoke
is not user acceptance. No cross-restart exactly-once claim is made.
