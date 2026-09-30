# DeliveryEnvelope v2 — real owner Gate A failed; candidate rolled back

Date: 2026-09-30, Asia/Shanghai. This was a **real owner WhatsApp inbound**
request after the candidate apply from source `a1df7b7f9e760f7a3db7b802231faf4d7bcb372e`.
The handset received no reply. The candidate's own protected telemetry window
recorded a repeated TypeError reading `observeMessageSent`; no typed delivery
settlement event was recorded. Full private log evidence (0600 under a 0700
external directory, never Git):
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260930095303/owner-gate-a-failure.log`.

The pinned OpenClaw channel-turn contract reads `replyPipeline.delivery` and
then `delivery.observeMessageSent`. The new plugin had erroneously placed
`preparePayload`, `deliver` and `observeMessageSent`-related behavior under
`dispatcherOptions`, leaving `delivery` undefined. The source fix restores
the native shape: `dispatcherOptions` for lifecycle callbacks, `delivery` for
the **single v2 settlement**. It adds focused runtime and pinned-boundary
contract assertions; no text cleanup/boolean media hint/second sender is
introduced.

Immediate protected rollback used the candidate checkpoint
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930095303` to restore
OpenClaw/Product Radar Compose/env/config and previous WhatsApp module. Only
the SQLite `plugins.installedIndex` row was restored transactionally from its
consistent backup; all intervening sessions and other SQLite rows remained
untouched. The previous immutable image
`local/openclaw-amadeus:git-6311e21b412c-20260930044402` was recreated
with `docker compose up -d --no-build`. It became healthy, registered
Amadeus twice, returned to `tts.auto=tagged`, and WhatsApp was
linked/running/connected. Gate A **failed**, Gates B–F were not attempted,
and no received-file hash equality is claimed.

Before any new candidate, commit the source fix, rerun tests and secrets,
produce a new immutable tag/protected checkpoint, then require a real owner
Gate A before proceeding to media/voice/recreate gates. If it fails, restore
the new checkpoint rather than adding a compatibility path.
