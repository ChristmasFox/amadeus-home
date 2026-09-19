# VPS subscription live apply completed

Status: `COMPLETE`

The existing subscription URLs now return the original bodies with a unified
`amadeus-gateway` filename and VPS-wide KiwiVM usage headers. Live evidence is
recorded in `.agent/checkpoints/2026-09-19-vps-subscription-live-applied.md`.

Applied steps:

1. Backed up the VPS Caddyfile, subscription directory metadata, and existing service state outside Git.
2. Placed the external KiwiVM credentials at `/etc/amadeus-gateway/kiwivm-credentials.json` with
   `root:caddy` ownership and `0640` permissions; do not print or commit it.
3. Installed the responder, `subscription.env`, and `amadeus-gateway-subscription.service`; created the
   caddy-owned state directory.
4. Replaced the Caddy static subscription handler with the local `127.0.0.1:8787` reverse proxy, ran
   `caddy validate`, enable the unit, and reload Caddy.
5. Verified each existing subscription URL returns the original format, `Content-Disposition` filename
   `amadeus-gateway`, `Subscription-Userinfo`, and fresh/stale behavior without exposing the token.
6. Recorded the live checkpoint and updated `docs/CURRENT_TASK.md` and `docs/PROJECT_STATE.md`.
