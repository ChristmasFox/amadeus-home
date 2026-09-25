# 2026-09-25 — WhatsApp voice lifecycle candidate deployed

## Apply

- Source commit: `7198206` (`feat(whatsapp): keep voice typing through final delivery`).
- Candidate image: `local/openclaw-amadeus:git-7198206b9ca5-20260925114919`.
- Product Radar image was reused: `local/product-radar:git-d988000e1c5d-20260924130631`.
- OpenClaw external restore checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260925114919`.
- Deployment evidence: `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260925114919`.
- Apply reported OpenClaw health passed. Read-only inspection reports container running/healthy, restart count 0. Core queue marker and WhatsApp typing-lifecycle marker each occur once. Candidate remains a single runtime; release/version is unchanged at 1.5.2.

## Recovery checkpoint correction

The initial deployment script attempted to back up `$OPENCLAW_DATA_DIR/npm/projects`, but the actual Docker bind mount is `/DATA/AppData/openclaw/config` -> `/home/node/.openclaw`. The checkpoint manifest therefore did **not** contain `/DATA/AppData/openclaw/config/npm/projects` (read-only manifest confirmed `exists=false` for the wrong parent path).

Before apply, the exact WhatsApp monitor module was copied into `/tmp/openclaw-whatsapp-monitor-2026.9.4.js`. After detecting the manifest gap, that pre-lifecycle file was persisted as a checkpoint supplement:

`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260925114919/rollback-whatsapp-monitor/monitor-DaIAK4fT.before-lifecycle.js`

SHA-256: `66ec565a6806e23616202caa96d6b7a3c295b2bb2b22abdbf9fea90a144e95e9`, mode `0644`.

The Git deploy script is corrected to include `$OPENCLAW_DATA_DIR/config/npm/projects` in future pre-apply checkpoints; a regression test rejects the old path. This correction is source-only and does not change the running image. The present deployment evidence contains the exact one runtime file modified by this lifecycle patch, while a later apply will add the full npm project tree to its checkpoint.

## Health caveats and remaining acceptance

- `scripts/doctor.sh`: OpenClaw, Product Radar, 9Router and Immich health probes pass, but it reports two unrelated existing failures: media-organizer-adapter is absent, and external-storage/Immich media-boundary identity verification fails. Do not report global doctor as clean.
- Pinned-runtime source audit: `runChannelInboundEvent` awaits `runChannelTurn`; the turn awaits routed dispatch; the delivery owner awaits the outbound dispatcher and then settles all pending channel-delivery attempts before returning. The WhatsApp monitor `finally` lease boundary therefore remains active through awaited PTT/text delivery; this is source-path evidence, not handset proof.
- No real WhatsApp handset acceptance has occurred after this deployment. Still required: verify the composing dots persist through both Japanese PTT and Chinese text, one reply each, and in a group send a competing same-session message during TTS to confirm it queues and is answered afterward.
- Provider/client presence is best-effort; source/config health is not proof of handset-visible dots.
