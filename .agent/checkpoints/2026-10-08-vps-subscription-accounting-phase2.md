# Amadeus Gateway subscription accounting — Phase 2 checkpoint

Date: 2026-10-08 (Asia/Shanghai)

## Protected rollback material

The complete pre-change archive, generated credentials, and pre-change Xray
binary are stored outside Git with restricted permissions at:

`/Volumes/Avalon/backups/operation-skuld/vps-subscription-accounting/phase2-prechange-20261008T042931Z`

The archive is secret-bearing. Do not copy it into the repository, logs, or a
user report. The standalone pre-change Xray binary in the same directory has
SHA-256 `8255dd939c34cf966cc91517b6324dd3c8d0bcf49ffac8beca049a38c46845ed`.

## Applied state

- `amadeus-accounting` owns the runtime collector and private SQLite account
  store; the fixed read-only probe can read only the sanitized snapshot.
- Five Labmem identities exist. Their subscription URLs and protocol
  credentials remain on the VPS and have not been distributed.
- Existing legacy subscription token, HY2 credential, and VLESS UUID remain
  active and unchanged.
- Hysteria HTTP auth and Traffic Stats API, and Xray StatsService, listen only
  on loopback. Xray 26.9.30 was installed after validating the official
  release SHA-256.
- The six identities' four subscription formats returned HTTP 200 through both
  subscription ports. The legacy QX response body remained byte-identical.
- Legacy HY2 and VLESS connectivity checks passed. Controlled Labmem001 HY2
  and VLESS transfers incremented only their matching account/protocol
  counters. HY2 directions are client perspective (`tx` upload, `rx` download).
- Provider T0 is `2026-10-08T04:58:07Z`. At the recorded acceptance snapshot,
  provider, Hysteria traffic/online, and Xray traffic/online sources were
  healthy; account coverage was complete.
- A guarded one-time SQLite migration set the verified legacy VLESS T0
  baseline. Raw counters matched the separately reviewed initial values and
  post-T0 VLESS deltas were zero; monitored legacy VLESS total remains zero.
- Provider/proxy reconciliation remains `uncalibrated`. Do not calculate a
  gap or claim an anomaly until a reliable tolerance is established.

## Restore boundary

If a proxy regression requires rollback, follow Goal section 10 and restore
only the relevant protected Hysteria, Xray, Caddy/subscription, or OpenClaw
state. Validate each candidate before restarting/reloading its service and
verify the existing legacy client immediately afterward. Never delete or
rotate the legacy credentials during rollback. Keep the accounting database
for diagnosis unless a separate, reviewed recovery plan requires otherwise.

OpenClaw integration and scheduled-report acceptance are tracked separately in
`docs/AMADEUS_VPS_SUBSCRIPTION_ACCOUNTING_GOAL.md`.
