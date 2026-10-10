# VPS subscription token rotation — staged

Date: 2026-10-07 (Asia/Shanghai)

## Request and scope

- Rotate the HTTPS subscription URL token for the VPS subscription service.
- Keep the previous token active until the operator explicitly signals revocation.
- One new shared token covers the Clash/Mihomo, Shadowrocket, and Quantumult X
  subscription formats. The token value and complete URLs are intentionally not
  recorded in Git.
- This rotates subscription-fetch authorization only. Existing subscription
  content and Xray/HY2 client credentials were not changed.

## Applied state

- Copied the four existing subscription files into the new token directory;
  preserved the previous token directory and its files.
- Added the new exact paths to both the standard HTTPS and legacy `<SERVICE_PORT>` Caddy
  matchers. The previous paths remain enabled pending the operator's signal.
- Corrected `/etc/caddy/Caddyfile` from mode `0644` to `root:caddy` mode `0640`.
- New links are stored outside Git in
  `~/Library/Application Support/AmadeusGateway/subscription-links-2026-10-07.txt`
  with mode `0600` in a mode `0700` directory.

## Verification and recovery

- Protected pre-change VPS checkpoint:
  `/root/example-vps-checkpoints/subscription-token-staged-20261007T002059`
  (root-only directory and files).
- `caddy validate` passed; `systemctl reload caddy.service` completed and Caddy
  remained active. The subscription responder remained active.
- All 16 local endpoint checks passed: old and new tokens, four formats, on ports
  `443` and `<SERVICE_PORT>`. All four new public HTTPS `443` endpoints also returned
  `200` with non-empty bodies.
- To roll back the staged addition, restore the protected Caddyfile checkpoint,
  remove only the new token directory, validate, and reload Caddy. Do not restore
  or re-enable the old token if the operator has already requested revocation.
- Do not revoke the old token until the operator explicitly asks. Once asked,
  remove its exact routes from both Caddy matchers, validate/reload, then delete
  its subscription directory and verify old URLs return `404` while new URLs
  continue returning `200`.
