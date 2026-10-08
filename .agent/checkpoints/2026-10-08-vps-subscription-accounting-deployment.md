# Amadeus Gateway subscription accounting — deployment checkpoint

Date: 2026-10-08 (Asia/Shanghai)

## Applied state

- Amadeus 1.9.9 is deployed as
  `local/openclaw-amadeus:git-b80f9a7882cc-20261008052549` on CasaOS machine
  `nyannyan`.
- VPS accounting T0 is `2026-10-08T04:58:07Z`. KiwiVM remains authoritative
  for the plan total; proxy reconciliation is `uncalibrated` and no anomaly is
  claimed.
- The current legacy subscription token, HY2 credential, and VLESS UUID were
  imported unchanged and remained active. No credential values are recorded
  here.
- Five Labmem identities are present. Each passed HY2 and VLESS connectivity
  checks; an updated healthy sample showed nonzero attributed usage for every
  identity on both protocols. Legacy HY2 and VLESS also connected after the
  service restart checks.
- Xray and Hysteria were restarted individually. Both services returned active;
  each source generation changed, the store recorded a reset delta, and the
  previous cumulative totals remained nonnegative and preserved.
- The sanitized snapshot reported provider, Hysteria traffic/online, and Xray
  traffic/online sources as healthy, complete account coverage, and a separate
  legacy record.

## Owner report schedule

The existing OpenClaw Cron jobs were edited in place; both IDs remain unique,
enabled, and use `delivery.mode=none` so the existing owner outbox is the only
delivery path:

- `amadeus-vps-morning`: `0a0bbe0f-43f1-4582-af45-22dbafb6cf5c`, 09:30
  Asia/Shanghai.
- `amadeus-vps-evening`: `bfc071e5-31a1-4ca5-8836-b228e0f8589a`, 21:30
  Asia/Shanghai.

A midday manual acceptance report was delivered to the owner through the
outbox. The deployed 1.9.9 code fixes manual-vs-scheduled event classification
for the actual Cron session context. Because that acceptance run had already
used the normal evening event key for 2026-10-08, the evening prompt has a
date-limited stable recovery key for today's scheduled run. Future days use
their normal morning/evening keys. This checkpoint confirms the scheduled
21:30 job is configured; it does not claim that its future execution has
already happened.

## Validation and release evidence

- Amadeus typecheck/build and 136 tests passed; the accounting Python tests,
  architecture check, shell syntax/version checks, secrets scan, and
  `git diff --check` passed.
- OpenClaw health, Product Radar health, Amadeus registration, NAS read-only
  smoke, owner outbox, and both Cron targets passed after deployment.
- The existing six identities' four subscription formats returned HTTP 200 on
  both subscription ports (48/48); legacy QX output remained byte-identical. A
  later audit repeated the 48/48 checks against the public HTTPS endpoints and
  confirmed each body matched its local subscription file.
- Code commits: `482e736` (accounting), `bfb0b07` (macOS Bash Cron update),
  `b80f9a7` (manual event-key isolation), and `be53156` (one-time evening
  recovery prompt).

Protected rollback material remains outside Git:

- VPS pre-change archive:
  `/Volumes/Avalon/backups/operation-skuld/vps-subscription-accounting/phase2-prechange-20261008T042931Z`.
- OpenClaw pre-switch checkpoint:
  `/DATA/AppData/openclaw/backups/amadeus-openclaw-20261008052549`.
- OpenClaw deployment evidence:
  `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261008052549`.

## Operational note

The deploy reported a Docker logging-policy warning because the OrbStack daemon
has no default logging policy. Managed containers use bounded `local/20m x5`
logging. The daemon was not restarted because global logging configuration is
outside this Goal.

For rollback, follow section 10 of
`docs/AMADEUS_VPS_SUBSCRIPTION_ACCOUNTING_GOAL.md`. Preserve all legacy
credentials and the accounting database.

## Remaining acceptance and audit incident

The Goal remains active. A real owner WhatsApp direct-message query that
exercises whole-plan usage and a Labmem protocol split has not been verified.
A headless CLI attempt did not include actual inbound sender context, so its
response is not evidence about normal owner queries. At the latest audit, the
2026-10-08 21:30 recovery-key run was still scheduled for the future.

During that audit, a protected archive member listing was accidentally emitted
in a tool result and contained the legacy subscription bearer-token path. The
value is intentionally omitted from this file and Git. No runtime credential
was changed. The operator's explicit legacy-preservation instruction remains in
force unless separately revised; assess any rotation only as a separately
authorized operation with its own checkpoint. Do not claim the no-secret-in-log
requirement is satisfied until this exposure is addressed.

## Phase 3 calibration attempt — 2026-10-08

Two sequential known-download trials were run from the VPS through temporary
Labmem001 clients. Each request fetched exactly 33,554,432 bytes from the
fixed-size Cloudflare speed endpoint and returned HTTP 200. Client configs were
derived from the protected account record, written mode `0600` under `/run`,
and removed when each client exited. No credentials were printed.

- HY2: `2026-10-08T05:59:00Z`–`05:59:03Z`; `eth0` RX increased by
  33,754,555 bytes and TX by 96,706 bytes.
- VLESS: `2026-10-08T05:59:22Z`–`05:59:24Z`; `eth0` RX increased by
  33,766,240 bytes and TX by 93,190 bytes.
- At the next accounting snapshot (`05:59:48Z`), Labmem001 HY2 increased from
  1,069,204 to 34,676,822 bytes (+33,607,618); VLESS increased from 1,069,225
  to 34,677,384 bytes (+33,608,159). Each is close to one 32 MiB payload plus
  protocol overhead.
- KiwiVM's direct counter stayed at 980,018,432,726 bytes across both test
  boundaries and collector samples at `05:59:46Z` and `06:00:46Z`. It had
  already advanced by 37,313,790 bytes before the first test relative to the
  earlier snapshot. The 60-second baseline also showed unrelated legacy and
  interface traffic.

This confirms the tested proxy paths and per-protocol account counters, but it
does not isolate KiwiVM's delta for either payload or establish a normal
provider/proxy ratio. Reconciliation therefore remains `uncalibrated`; no gap
or anomaly claim is enabled. A future calibration needs a quiet interval or a
provider sampling window that captures a known transfer without material
background traffic.
