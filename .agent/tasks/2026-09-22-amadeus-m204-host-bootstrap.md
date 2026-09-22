# Amadeus-M204 clean-host bootstrap

Date: 2026-09-22
Status: PENDING — target access and terminal proxy are verified; no runtime migration is authorized by this task itself.

## Current target baseline

- SSH alias `amadeus-m204` works as `nyannyan`; a dedicated migration key is used.
- macOS 27.0 / arm64 Apple M6 / 24 GiB RAM; root volume has about 386 GiB free.
- Terminal mixed proxy is default-on in interactive zsh at `127.0.0.1:7897`; `proxy_off` is available.
- Git is present. OrbStack CLI is at `/usr/local/bin/orb`; the running `nyannyan` guest is canonical and verified as Ubuntu 24.04.5/noble arm64, with `nyannyan` user/home and guest-root access. The dedicated target-only GitHub identity is authorized as the user-approved account Authentication key; standard `github.com` and repository-local `core.sshCommand` use that identity, and `/Users/nyannyan/agent-monorepo` is a clean clone. Host Homebrew/Node 24.21.0/pnpm 11.19.0/Python 3.11.16/tmux/cloudflared are installed; host profile and bootstrap check pass. Guest Docker 29.8.1/Compose 5.5.1/CasaOS 0.4.15, `/DATA/AppData`, `/var/lib/casaos/apps`, and `amadeus_network` are ready. Avalon remains unattached; no business runtime or restore has started.
- Source destination-capacity calculation is `FIT`.

## Ordered next actions

1. COMPLETE: Homebrew is installed. Do not share passwords in chat or store them in files.
2. Install Node 24, pnpm and Python 3.11+; verify architecture remains arm64.
3. COMPLETE: user-authorized account-level SSH Authentication key passed `git ls-remote`, and a clean clone exists at `/Users/nyannyan/agent-monorepo` with origin `git@github.com:ChristmasFox/amadeus-home.git`.
4. Restore only non-secret host profile declaration in the clean clone and run `./scripts/bootstrap.sh --check`.
5. COMPLETE: Docker/CasaOS were installed in the clean `nyannyan` guest; Docker, Compose, CasaOS core services, gateway HTTP 200, `/DATA/AppData`, `/var/lib/casaos/apps`, and `amadeus_network` pass. A static OrbStack-LXC `polkit.service` failure is recorded as non-blocking; do not paper over it without evidence of CasaOS impact.
6. Attach and verify Avalon using its identity/capacity preflight. Do not copy, move, or delete media merely because the disk is attached.
7. COMPLETE: OrbStack Ubuntu 24.04 machine `nyannyan` is running and its user/root identity probes pass. Do not restore data or start production services merely because this guest is ready; those remain separate apply-gated phases.
8. Secret/data restore, external-channel routing, and cutover each require their separate tracked preflight/checkpoint and explicit apply boundary.

## Prohibitions

- Do not stop or freeze the source CasaOS runtime.
- Do not start a second OpenClaw runtime or restore any retired LangBot/n8n path.
- Do not expose the dedicated SSH private key, proxy credentials, secret bundle contents, or user passwords.
- Do not move Avalon or reclaim the retained Immich source during host bootstrap.
