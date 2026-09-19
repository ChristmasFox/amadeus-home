# 2026-09-19 VPS subscription source ready

## Scope

- Preserve the existing `/<token>/<format>` subscription URLs.
- Return the existing QX/Clash/Shadowrocket bodies with VPS-wide KiwiVM usage headers.
- Set the inline/download filename to `amadeus-gateway` for every supported format.
- Do not distinguish users, protocols, or nodes.

## Source changes

- `infra/vps/subscription/amadeus_gateway_subscription.py`
- `infra/vps/subscription/test_amadeus_gateway_subscription.py`
- `infra/vps/subscription/subscription.env.example`
- `infra/vps/systemd/amadeus-gateway-subscription.service.example`
- `infra/vps/subscription/Caddyfile.example`
- `infra/vps/subscription/README.md`
- `infra/vps/README.md`
- `docs/CURRENT_TASK.md`
- `docs/PROJECT_STATE.md`

## Verification

- `python3 -m unittest discover -s infra/vps/subscription -p 'test_*.py' -v`: 4/4 passed.
- `python3 -m py_compile infra/vps/subscription/amadeus_gateway_subscription.py infra/vps/subscription/test_amadeus_gateway_subscription.py`: passed.
- `git diff --check`: passed.
- `pnpm check:secrets`: passed.

## Live boundary

- No VPS files, services, Caddy configuration, credentials, or subscription token were changed.
- Live apply remains pending. It requires the external `/etc/amadeus-gateway/kiwivm-credentials.json`,
  installation of the responder/unit, Caddy validation/reload, and verification through the existing
  subscription URLs.
- Rollback is the backed-up VPS Caddyfile/static handler and disabling the new unit; no source rollback
  was performed in this checkpoint.
