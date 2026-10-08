# Agent state — 2026-10-08

Canonical status: `docs/PROJECT_STATE.md`. Current task pointer: `docs/CURRENT_TASK.md`.

Amadeus 1.9.9 is live with VPS subscription accounting. Existing owner report
jobs retain their IDs and run at 09:30/21:30 Asia/Shanghai. Five Labmem accounts
passed HY2/VLESS connectivity and accounting acceptance; legacy credentials
remain active. Xray/Hysteria counter-reset behavior passed live restart checks.
Reconciliation remains `uncalibrated`; no anomaly is claimed. See the current
task pointer and `docs/PROJECT_STATE.md` for checkpoints and details.

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
