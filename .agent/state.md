# Agent state — 2026-10-01

Canonical status: `docs/PROJECT_STATE.md`. Current task pointer: `docs/CURRENT_TASK.md`.

Amadeus 1.7.7 is live in immutable OpenClaw 2026.9.4 image
`local/openclaw-amadeus:git-79577cc27dfc-20261001110629` from release source
commit `79577cc`. Runtime version, OpenClaw/Product Radar health, Amadeus plugin
registration, NAS read-only smoke, owner notification/outbox smoke, and post-deploy
maintenance pass. Protected rollback checkpoint:
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261001110629`; full evidence is
`.agent/checkpoints/2026-10-01-amadeus-1.7.7-image-route-repair.md`.

The image-generation tool boundary strips model-authored provider/model overrides
so native OpenClaw resolves the configured image capability; lifecycle original
request lookup also falls back to account-scoped conversation identity. Focused
automated gates passed. Manual post-deploy owner DM acceptance and a new paid
image-generation transport smoke remain pending. The incident record omits
private prompt/message/image contents. No cross-restart exactly-once claim is made.
