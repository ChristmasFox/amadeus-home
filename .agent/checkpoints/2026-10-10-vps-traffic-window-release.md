# VPS traffic window release — 2026-10-10

## Scope

The VPS accounting collector now records successful KiwiVM provider deltas in
SQLite every 60 seconds and retains bounded provider/account detail for three
days. The sanitized snapshot exposes a default 12-hour `reportWindow` with:

- `providerBytes` and `providerComplete` for the whole-VPS provider window;
- `subscriptionBytes` and `subscriptionComplete` for the six active accounts;
- `legacyBytes` only when the retired account's window is complete;
- `otherServiceBytes` only as the explicitly `uncalibrated` residual
  `providerBytes - subscriptionBytes`.

The provider window is kept unknown until its stored sample intervals cover the
full requested window. This prevents the first report after rollout from
presenting a few minutes of samples as a 12-hour whole-VPS total. Exact Caddy,
frps, SSH, and system-service attribution remains out of scope until those
services have independent counters and calibration evidence.

## Source and verification

- Source commits: `665eb17` and `e1a862c`.
- `python3 -m unittest infra/vps/subscription/test_accounting.py`: 42 passed.
- Amadeus plugin typecheck and tests: 137 passed.
- `pnpm check:secrets`, shell/Python syntax checks, and `git diff --check`: passed.

## VPS apply evidence

`./scripts/deploy-vps-accounting.sh --apply` created the root-only checkpoint:

```text
/root/example-vps-backups/vps-accounting-window-20261010022302
```

The service is active, the SQLite schema is version 5, and the fixed probe was
updated. A real probe read at `2026-10-10T02:27:06Z` reported five provider
delta rows, `subscriptionBytes=5518957198`, and `providerComplete=false` with
`providerBytes=null`; this is the expected warm-up state until the first full
12-hour coverage completes. No proxy credential, SSH setting, firewall rule,
or proxy service was changed.

## OpenClaw apply evidence

Amadeus 1.10.3 is live as:

```text
local/openclaw-amadeus:git-e1a862c1ca96-20261010022421
```

The release checkpoint is
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261010022421`; post-deploy
evidence is under
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261010022421`.
The 09:30 and 21:30 Asia/Shanghai VPS cron jobs remain enabled and their live
prompts require separate cumulative-quota and 12-hour window lines, including
the uncalibrated residual wording.

## Rollback

For the VPS collector, restore the three backed-up source/probe files from the
root-only VPS checkpoint and restart only
`example-vps-accounting.service`. For OpenClaw, use the protected release
checkpoint and the existing deployment rollback procedure to restore the prior
1.10.2 immutable image. Do not restore credentials or alter SSH/firewall state.
