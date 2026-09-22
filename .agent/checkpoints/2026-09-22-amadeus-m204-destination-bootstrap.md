# Amadeus-M204 destination bootstrap

Date: 2026-09-22 (Asia/Shanghai)
Status: HOST/GUEST BOOTSTRAP VERIFIED — Avalon attachment pending; no business restore or cutover

## Host bootstrap

- Homebrew 7.0.6 installed.
- Node `v24.21.0` installed and active.
- pnpm `11.19.0` activated through Corepack (the Homebrew pnpm formula remains available but is not the active project version).
- Python `3.11.16` active in interactive zsh through the managed toolchain PATH block.
- tmux 3.7c and cloudflared 2026.9.1 installed.
- `/Users/nyannyan/agent-monorepo` is clean, uses the standard GitHub origin and dedicated target-local SSH identity, and completed `pnpm install --frozen-lockfile`.
- `infra/host-profile.env` is a target-local ignored file with non-secret destination values:
  `ORBSTACK_MACHINE=nyannyan`, `MAC_CONTROL_USER=nyannyan`, `EXTERNAL_STORAGE_ROOT=/Volumes/Avalon`.
- `./scripts/bootstrap.sh --check` passed with all required host dependency checks.

## Guest bootstrap

- Canonical OrbStack guest `nyannyan` is Ubuntu 24.04.5/noble arm64.
- Docker Engine `29.8.1` and Docker Compose `v5.5.1` are installed and running.
- CasaOS `v0.4.15` is installed; all core CasaOS services and `rclone.service` are active; gateway HTTP probe returns 200.
- `/DATA/AppData` and `/var/lib/casaos/apps` exist.
- Docker network `amadeus_network` exists with bridge driver.
- CasaOS installer returned a non-zero exit after completing core services; OrbStack-LXC `polkit.service` is the only observed failed static unit. This is retained as a warning and requires no blind workaround while CasaOS core health passes.

## Remaining gate

`/Volumes/Avalon` is absent from the target Mac. Before any secret/data restore, attach the physical Avalon
volume, run `diskutil info /Volumes/Avalon`, record the real UUID in the target-local host profile, then run
the tracked storage identity/capacity preflight. Never guess the UUID and never copy/tar the media.

## Explicit non-actions

No secret bundle, AppData, database, channel credential, OpenClaw/Product Radar runtime, media move, source
freeze, route switch, or cutover was performed. The old Mac/CasaOS remains the sole authoritative runtime.
