# 2026-09-19 VPS subscription live applied

## Deployment

- Source commits: `0aaf85c` and `84c25e0`.
- VPS backup: `/var/lib/caddy/backups/amadeus-gateway-subscription-20260919084939`.
- External credential path: `/etc/amadeus-gateway/kiwivm-credentials.json`, not in Git.
- Responder: `amadeus-gateway-subscription.service`, `enabled/active`.
- Caddy: `enabled/active`; two static subscription handlers replaced by two local
  `reverse_proxy 127.0.0.1:8787` handlers.

## Live verification

- The responder health endpoint returned `ok`.
- The original QX, server snippet, Clash YAML, and Shadowrocket paths returned HTTP 200 on both
  HTTPS 443 and legacy HTTPS 8443.
- Each response body matched its original static file SHA-256.
- Each response returned `Content-Disposition: inline; filename="amadeus-gateway"`.
- Each response returned `Subscription-Userinfo` and `X-Amadeus-Gateway-Usage-Status: fresh`.
- The current aggregate VPS sample was 36,424,460,154 bytes used of 1,073,741,824,000 bytes total,
  with 1,037,317,363,846 bytes remaining; the service persisted state as `caddy:caddy 0600`.
- KiwiVM API required the explicit `AmadeusGatewaySubscription/1` User-Agent; the source and regression
  test were updated in `84c25e0`.

## Rollback

Restore the backed-up Caddyfile, reload `caddy.service`, disable the new responder if needed, and
retain the backup until the user confirms the new subscription behavior.
