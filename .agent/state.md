# Agent state — 2026-10-01

Canonical status: `docs/PROJECT_STATE.md`. Current task pointer: `docs/CURRENT_TASK.md`.

Amadeus 1.7.6 is live in immutable OpenClaw 2026.9.4 image
`local/openclaw-amadeus:git-092b262332b7-20261001102103` from release source
commit `092b262`. Runtime version, OpenClaw/Product Radar health, Gateway
registration, NAS read-only smoke and owner notification/outbox smoke pass.
Protected rollback checkpoint:
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261001102103`; full evidence is
`.agent/checkpoints/2026-10-01-amadeus-1.7.6-whatsapp-final-delivery-release.md`.

The final WhatsApp delivery callback now re-runs strict typed preparation if
OpenClaw bypasses `preparePayload`; unsettled trusted internal provenance remains
silent. The reported send was not correlated using private message content, so
its exact event route is not claimed as confirmed. Post-deploy manual owner
WhatsApp/image-experience acceptance remains pending. No cross-restart
exactly-once claim is made.
