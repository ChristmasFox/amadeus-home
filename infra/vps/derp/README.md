# Self-hosted Tailscale DERP on amadeus-gateway

Purpose: when two tailnet nodes cannot reach each other directly (e.g. M204
behind CN NAT ↔ a cloud VM with no UDP endpoint), relay through our own VPS
instead of Tailscale's public DERP regions.

```
node A ──TLS 443──▶ Caddy (sub.<domain>) ──/derp──▶ derper 127.0.0.1:3340 ◀── node B
                    UDP 3478 STUN ◀── derper
```

Why DERP rather than Tailscale "peer relay": peer relay is UDP-only, and the
cloud VM has no usable UDP path; DERP runs over TCP/TLS 443, which survives
restrictive NAT and CN networks. Running behind the existing Caddy avoids a new
DNS name/certificate and a second listener on 443.

## Components (all on the VPS)

| Item | Location | Notes |
| --- | --- | --- |
| `derper` binary | `/usr/local/bin/derper` | Built from `tailscale.com/cmd/derper@<tailscaled version>` (static, linux/amd64) |
| systemd unit | `/etc/systemd/system/derper.service` | From `derper.service.example`, replace `sub.example.com` |
| derper key | `/var/lib/private/derper/derper.json` | Generated on first start; never copy into Git |
| Caddy route | `/etc/caddy/Caddyfile`, `sub.<domain>` 443 block | Snippet `derp.example.Caddyfile` |
| Firewall | `/etc/iptables/rules.v4`, `rules.v6` | `derp-public-input.rules`: drop non-loopback TCP 3340 |
| tailscaled | `tailscaled.service` (official apt repo) | Node `amadeus-gateway`, `--accept-dns=false`; required for `-verify-clients` |

Ports: TCP 443 (Caddy, shared), UDP 3478 (STUN). TCP 3340 is loopback-only.
`-verify-clients` makes derper accept only nodes of our own tailnet, so the
VPS is not an open relay; if the VPS tailscaled is logged out, **all** DERP
clients are rejected.

## Install / rebuild

```sh
# on the Mac (any Go toolchain); match the VPS tailscaled version
V=$(ssh amadeus-gateway tailscale version | head -1)
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go install -trimpath -ldflags='-s -w' tailscale.com/cmd/derper@v$V
scp "$(go env GOPATH)/bin/linux_amd64/derper" amadeus-gateway:/tmp/derper
ssh amadeus-gateway 'install -m0755 /tmp/derper /usr/local/bin/derper && rm /tmp/derper && systemctl restart derper'
```

First-time setup additionally: install tailscale (`curl -fsSL https://tailscale.com/install.sh | sh`),
`tailscale up --hostname=amadeus-gateway --accept-dns=false`, install the unit,
add the iptables rule and save with `iptables-save > /etc/iptables/rules.v4`
(same for v6), insert the Caddy snippet, `caddy validate` then `systemctl reload caddy`.

## Tailnet policy

Merge `tailnet-policy-derpmap.example.hujson` (with the real hostname and VPS
IPv4) into the tailnet policy file. Region 900 = `amadeus-lax`.
Rollback: remove the `derpMap` key; nodes return to Tailscale's DERP map
within seconds.

## Operate / verify

```sh
ssh amadeus-gateway 'systemctl status derper caddy tailscaled; journalctl -u derper -n 50'
curl -s -o /dev/null -w '%{http_code}\n' https://sub.<domain>/generate_204   # expect 204
tailscale netcheck                  # expect "amadeus-lax" listed / nearest
tailscale debug derp amadeus-lax    # end-to-end DERP + STUN check
tailscale ping <peer>               # expect "via DERP(amadeus-lax)" or direct
tailscale status                    # peer column shows relay "amadeus-lax"
```

Stop/start: `systemctl stop|start derper`. With `OmitDefaultRegions: true`, stopping
derper leaves non-direct peers unreachable; remove the `derpMap` key first.
