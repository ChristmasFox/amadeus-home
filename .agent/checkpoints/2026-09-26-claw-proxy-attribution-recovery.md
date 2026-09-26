# Claw public ingress proxy-attribution recovery — 2026-09-26

## Symptom and diagnosis

- `https://claw.nyannyan.top/` returned HTTP 403 with OpenClaw `proxy_attribution_required`; `/healthz` was HTTP 200. DNS, TLS, Cloudflare, Caddy/frp forwarding and OpenClaw health were not wholly down.
- OpenClaw logged `observed unattributable proxy-shaped traffic from 172.20.0.1`. The container's `9router_default` network gateway was `172.20.0.1` and published port `18789/tcp` forwarded through that bridge. Live `gateway.trustedProxies` still contained the old `172.24.0.1` bridge.
- The local Mac's `~/.ssh/config` currently has no `amadeus-gateway` host alias, so direct VPS inspection was unavailable. No VPS, firewall, frps or Caddy changes were made.

## Reversible repair

- Source of truth: changed only `integrations/openclaw/openclaw.json.example` to trust `127.0.0.1` and the observed `172.20.0.1`; did not trust a broad CIDR or disable gateway token auth.
- Before live write, saved the full original config outside Git at `/DATA/AppData/openclaw/backups/proxy-attribution-20260926-224239/openclaw.json.before`. Atomically replaced the one old bridge address in `/DATA/AppData/openclaw/config/openclaw.json`; the gateway detected the change and restarted in-process. A transient 502 occurred during this restart, then resolved.
- Rollback if necessary: copy that protected backup over `/DATA/AppData/openclaw/config/openclaw.json` while retaining its owner/mode, then check automatic gateway reload, config validation and public status. **That rollback restores the original 403 when the current bridge remains `172.20.0.1`; do not use it as a functional fix.**

## Verification

- Container remained healthy; `openclaw config validate --json` reported `valid=true`, zero issues. Live trusted-proxy list exactly `127.0.0.1`, `172.20.0.1`.
- Three subsequent public root requests returned HTTP 200; follow-up public root and `/healthz` both HTTP 200, TLS verification 0. The Control UI still requires its existing gateway token for authenticated use.
- `pnpm check:secrets` and `git diff --check` passed for the source edit. No token, live config, credential or private audio was committed.
