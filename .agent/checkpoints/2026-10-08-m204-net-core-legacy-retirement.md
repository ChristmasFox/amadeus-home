# M204-Net-Core provisioning and Legacy retirement — 2026-10-08

## Outcome

The operator authorized formally retiring Legacy and replacing it with a
Mac mini-only account named `M204-Net-Core`. The change is active on VPS
`amadeus-gateway`. No credential values or subscription URLs are stored here.

- Active subscription accounts: `Labmem001`–`Labmem005` and `M204-Net-Core`.
- Legacy is disabled. Its live subscription token, HY2 secret, and VLESS UUID
  were replaced with fresh random values; its subscription directory was
  removed, and the disabled account remains only for historical traffic.
- The active Xray configuration contains no Legacy UUID. Xray and Hysteria
  were restarted to end established sessions.
- The public usage snapshot includes M204 and disabled Legacy history, and
  contains no subscription token, HY2 secret, or VLESS UUID fields.

## Protected pre-change recovery point

The checkpoint is stored on the VPS at
`/root/amadeus-checkpoints/2026-10-08-m204-net-core-retirement-prechange`,
owned by `root:root`, mode `0700`. The SQLite backup passed `PRAGMA quick_check`.
Original Caddy, Hysteria, and Xray files, subscription files, and accounting
source were captured there. Three older key-bearing `/etc` backups were moved
into its `legacy-pre-accounting` directory with mode `0600`; they are no longer
loose under `/etc`.

This recovery point contains the original Legacy credentials. Restoring it
would re-enable those credentials; any recovery must reapply the retirement
and repeat the rejection checks before opening service to clients.

## Verification

- Python accounting and migration suite: 35 passed.
- Amadeus plugin typecheck and tests: passed (136 tests).
- `pnpm check:secrets`, shell syntax checks, and `git diff --check`: passed
  before the runtime switch; the final source commit is `509639e`.
- Candidate Xray config passed `xray run -test`; Caddy candidate and active
  configuration passed `caddy validate`.
- `xray.service`, `hysteria-server.service`, `caddy.service`, and
  `amadeus-gateway-accounting.service` are active.
- All four old Legacy HTTPS subscription formats returned `404` on both ports
  443 and 8443. All four formats for each of the six active accounts returned
  `200` on 443 and contained the expected account label (24 checks); M204's
  four formats also returned `200` on 8443.
- Old Legacy HY2 auth returned `403`; the M204 HY2 auth returned `200`.
- A VLESS Reality tunnel using the old Legacy UUID failed to fetch external
  HTTPS. The M204 VLESS Reality tunnel fetched external HTTPS successfully.
- The M204 HY2 tunnel fetched external HTTPS successfully through the local
  VPS listener.
- OpenClaw candidate image
  `local/openclaw-amadeus:git-509639ee3a5e-20261008112407` passed OpenClaw and
  Product Radar health, Amadeus registration, NAS read-only smoke, and owner
  outbox smoke. It is a candidate, not a release; source `VERSION=1.9.9` is
  unchanged.

## Source and reporting state

Source commit: `509639e feat(vps): add M204 account and retire legacy credentials`.
The accounting model preserves Legacy historical usage but excludes disabled
Legacy from active totals. M204 reporting starts at the account creation time.
The owner report jobs remain scheduled at 09:30 and 21:30 Asia/Shanghai.
Traffic reconciliation remains `uncalibrated`; no gap or anomaly is claimed.
