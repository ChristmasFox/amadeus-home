# VPS subscription old URL revoked

Date: 2026-10-07 (Asia/Shanghai)

## Request and scope

- The operator explicitly requested revocation of the previous shared VPS
  subscription URL token after the new token had been staged and verified.
- Scope was limited to subscription-fetch authorization for Clash/Mihomo,
  Shadowrocket, and Quantumult X.
- Token values and complete subscription URLs are intentionally excluded from
  this repository.

## Applied state

- Removed the previous token's four exact paths from both the standard HTTPS
  and compatibility `8443` Caddy subscription matchers.
- Validated `/etc/caddy/Caddyfile` and smoothly reloaded `caddy.service`.
- Deleted only the previous token's directory under
  `/var/lib/caddy/subscription/`; the current token directory remains.
- `caddy.service` and `amadeus-gateway-subscription.service` are active.
- Xray/HY2 client credentials and proxy UUIDs were not changed. Previously
  imported configurations can still connect with those credentials.

## Verification and recovery

- The previous and current token directories plus pre-revoke Caddyfile were
  copied into the root-only checkpoint:
  `/root/amadeus-gateway-checkpoints/subscription-old-url-revocation-20261007T003714`.
- Caddy validation and reload succeeded.
- All 16 local endpoint checks passed across 443 and 8443: the four previous
  paths return `404`; the four current paths return `200` with non-empty bodies.
- Public HTTPS checks from the VPS passed for all four formats: previous links
  return `404` and current links return `200`.
- The staged rotation evidence remains in
  `.agent/checkpoints/2026-10-07-vps-subscription-rotation-staged.md`.
- Do not restore the previous token or its routes. Use the protected checkpoint
  only to recover the current service configuration if needed; keep the revoked
  token disabled.
