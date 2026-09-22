# Amadeus-M204 clean-host bootstrap

Date: 2026-09-22
Status: PENDING — target access and terminal proxy are verified; no runtime migration is authorized by this task itself.

## Current target baseline

- SSH alias `amadeus-m204` works as `nyannyan`; a dedicated migration key is used.
- macOS 27.0 / arm64 Apple M6 / 24 GiB RAM; root volume has about 386 GiB free.
- Terminal mixed proxy is default-on in interactive zsh at `127.0.0.1:7897`; `proxy_off` is available.
- Git is present. OrbStack CLI is at `/usr/local/bin/orb`; it currently has a running `ubuntu` noble/arm64 guest, but that name violates the target contract (`nyannyan`) and must not be used as a migration runtime or fallback. Homebrew, Node, pnpm, clean monorepo and Avalon mount remain absent; Python is 3.9.6.
- Source destination-capacity calculation is `FIT`.

## Ordered next actions

1. With the owner present for any macOS administrator prompt, install Homebrew. Do not share passwords in chat or store them in files.
2. Install Node 24, pnpm and Python 3.11+; verify architecture remains arm64.
3. Clone a clean copy of this repository to `/Users/nyannyan/agent-monorepo`, restore only non-secret host profile declaration, and run `./scripts/bootstrap.sh --check`.
4. Attach and verify Avalon using its identity/capacity preflight. Do not copy, move, or delete media merely because the disk is attached.
5. Only after the above succeed, follow the tracked clean-guest plan to create OrbStack Ubuntu 24.04 machine `nyannyan`. The observed `ubuntu` guest must remain non-production and cannot be reused, imported, or treated as a compatibility fallback; any removal is a later explicit apply decision.
6. Secret/data restore, CasaOS startup, external-channel routing, and cutover each require their separate tracked preflight/checkpoint and explicit apply boundary.

## Prohibitions

- Do not stop or freeze the source CasaOS runtime.
- Do not start a second OpenClaw runtime or restore any retired LangBot/n8n path.
- Do not expose the dedicated SSH private key, proxy credentials, secret bundle contents, or user passwords.
- Do not move Avalon or reclaim the retained Immich source during host bootstrap.
