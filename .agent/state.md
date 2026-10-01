# Agent state — 2026-10-01

Canonical status: `docs/PROJECT_STATE.md`. Current task pointer: `docs/CURRENT_TASK.md`.

Amadeus 1.7.8 is live in immutable OpenClaw 2026.9.4 image
`local/openclaw-amadeus:git-9f2357210a07-20261001112610` from source commit
`9f23572`. Runtime version, OpenClaw/Product Radar health, Amadeus registration,
NAS read-only smoke, owner notification/outbox smoke, and post-deploy maintenance
pass. Protected rollback checkpoint:
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261001112610`; full evidence is
`.agent/checkpoints/2026-10-01-amadeus-1.7.8-image-route-repair.md`.

The image-generation hook writes an empty `model` sentinel because OpenClaw
merges hook params over original params; this reliably removes a model-authored
override so configured `amadeus-image` routing applies. Request language capture
uses non-empty body/content and account-scoped conversation fallback. Automated
gates passed. A new paid image smoke and manual owner DM acceptance were not
performed; the actual user-channel retry remains pending. No cross-restart
exactly-once claim is made.
