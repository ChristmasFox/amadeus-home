# Amadeus-M204 SSH access and terminal proxy baseline

Date: 2026-09-22 (Asia/Shanghai)
Status: PREPARATION IN PROGRESS — no guest/data/runtime cutover

## Authorized target-host access

- The user explicitly authorized migration preparation on the new Mac.
- A dedicated ED25519 migration identity was generated on the control Mac. Its private key remains only in the control-side SSH directory and was not committed, copied to the destination, or logged.
- The user installed the corresponding public key for `nyannyan`; direct noninteractive SSH verification succeeded through the local alias `amadeus-m204`.
- Verified remote identity: `Amadeus-M204`, user `nyannyan`, macOS 27.0, arm64 / Apple M6.

## Terminal proxy write and verification

- Observed `127.0.0.1:7897` listening before configuration.
- Both `curl --proxy http://127.0.0.1:7897` and `curl --proxy socks5h://127.0.0.1:7897` returned HTTP 200 during read-only protocol checks.
- Wrote a reversible, managed block to `/Users/nyannyan/.zshrc` with default interactive-shell values:
  - `http_proxy` / `https_proxy`: `http://127.0.0.1:7897`
  - `all_proxy`: `socks5h://127.0.0.1:7897`
  - loopback, Bonjour, private-LAN and OrbStack-local `NO_PROXY` bypasses
  - `proxy_on`, `proxy_off`, and `proxy_status` functions
- Fresh `zsh -ic` validation displayed the expected values and an HTTPS request through the configured HTTP proxy returned HTTP 200.

## Read-only bootstrap baseline

| Check | Result |
| --- | --- |
| Memory | 24 GiB |
| Root volume | about 4% used; about 386 GiB available |
| Git | installed (`2.54.0`) |
| Homebrew | absent |
| OrbStack / Docker | absent |
| Node / pnpm | absent |
| Python | system Python 3.9.6 |
| Clean monorepo | absent |
| `/Volumes/Avalon` | absent |
| Source capacity model | `DESTINATION_CAPACITY_JUDGMENT=FIT` (190.0 GiB planned need, 290.0 GiB planned headroom) |

## Explicit non-actions

No Homebrew/OrbStack installation, clean Linux guest creation, repository clone, secret or data restoration,
Avalon movement, CasaOS/OpenClaw service start, source freeze, channel reroute, or cutover occurred. The old
Mac CasaOS runtime remains the sole authoritative runtime.

## Recovery / reversal

- A shell can disable the proxy with `proxy_off`; a new shell enables it again with `proxy_on`.
- Removing the marked `Amadeus terminal proxy (managed)` block from `/Users/nyannyan/.zshrc` fully reverses
  the proxy configuration.
- Revoking target access, if ever required, is limited to removal of the dedicated public-key line from
  `~nyannyan/.ssh/authorized_keys`; never copy or expose the control-side private key.
