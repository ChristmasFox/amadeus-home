# Public Qwen Image Lab — Caddy TLS route staged

Date: 2026-10-08 (Asia/Shanghai)

## Scope and result

Deployed only the exact Caddy site from
`infra/vps/image-lab.example.Caddyfile`:

```caddyfile
image.nyannyan.top {
    encode gzip
    reverse_proxy 127.0.0.1:18798
}
```

The full Caddyfile validated before and after the append. `systemctl reload
caddy` succeeded and Caddy remained active. The existing Cloudflare-proxied DNS
already resolved, so no DNS record was changed. Caddy obtained a valid Let's
Encrypt certificate for `image.nyannyan.top`. Public HTTPS now returns `502`,
which confirms TLS reaches Caddy; the expected upstream refusal occurs because
VPS loopback port `18798` is not listening yet.

## Protected rollback

The original Caddyfile is outside Git at:

```text
/var/backups/amadeus-image-lab/20261008T073835Z/caddy/Caddyfile.pre
```

The checkpoint directory is root-owned mode `0700`; the file is root-owned
mode `0600`. Original SHA-256:

```text
006dd3c3c9bceb3c1263f9f1cfe30c7e958fa711c93d1fd7682ceb657f871e88
```

To roll back this exact stage:

```sh
sudo cp --preserve=mode,ownership /var/backups/amadeus-image-lab/20261008T073835Z/caddy/Caddyfile.pre /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
```

## Subsequent frps preparation

After this Caddy checkpoint, the VPS `frps.toml` was updated to add only
`18798` to `allowPorts` and increase `maxPortsPerClient` from 10 to 11. The
candidate passed the pinned frps 0.69.0 verify command; frps restarted
successfully; the complete listener-port set before and after matched, with no
listener on `18798`. Its protected pre-change config and rollback instructions
are in `.agent/checkpoints/2026-10-08-qwen-image-public-lab-frps-port.md`.

## Not yet completed

- HomeLab frpc and DNS remain unchanged. The frps allowlist update does not
  create a listener until the corresponding HomeLab frpc mapping is added.
- No public raw TCP `18798` mapping has been created yet. VPS INPUT originally
  defaulted to ACCEPT, so the originally specified FRP TCP remote port would
  have been reachable over plaintext HTTP outside Caddy. At the operator's
  explicit `Apply` instruction, a persistent v4/v6 guard was added; see the
  firewall checkpoint before starting the frpc mapping.
- The runtime verifier at
  `~/Library/Application Support/Amadeus/secrets/qwen-image-lab-auth.json` is
  absent, and the operator password value is not present in the current task
  input/environment. No password or verifier was fabricated.
- The Mac bridge and UI remain on their pre-rollout versions. No model request
  was in flight at the last check; bridge health was `idle`.
- Focused source suites passed (30 tests), Python compile, shell syntax, plist
  lint, `pnpm check:secrets`, and `git diff --check` passed. Production
  `AMADEUS_QWEN_IMAGE_LOCAL_ONLY=0` and
  `AMADEUS_QWEN_IMAGE_FALLBACK_ENABLED=0` were confirmed live.
