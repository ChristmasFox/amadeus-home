# VPS subscription live apply pending

After explicit live-apply authorization:

1. Back up the VPS Caddyfile, subscription directory metadata, and existing service state outside Git.
2. Place the external KiwiVM credentials at `/etc/amadeus-gateway/kiwivm-credentials.json` with
   `root:caddy` ownership and `0640` permissions; do not print or commit it.
3. Install the responder, `subscription.env`, and `amadeus-gateway-subscription.service`; create the
   caddy-owned state directory.
4. Replace the Caddy static subscription handler with the local `127.0.0.1:8787` reverse proxy, run
   `caddy validate`, enable the unit, and reload Caddy.
5. Verify each existing subscription URL returns the original format, `Content-Disposition` filename
   `amadeus-gateway`, `Subscription-Userinfo`, and fresh/stale behavior without exposing the token.
6. Record the live checkpoint and update `docs/CURRENT_TASK.md` and `docs/PROJECT_STATE.md`.
