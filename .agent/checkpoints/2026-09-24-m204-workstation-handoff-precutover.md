# 2026-09-24 M204 workstation handoff pre-cutover evidence

## Host and repository

- Hostname: `Amadeus-M204`
- User: `nyannyan`
- Canonical repository: `/Users/nyannyan/agent-monorepo`
- Branch/worktree: `main`, clean
- Origin: `git@github.com:ChristmasFox/amadeus-home.git`
- Local HEAD, `origin/main`, and remote `git ls-remote refs/heads/main` all resolve to `05df9d6`

## Toolchain and destination

- Node `v24.21.0`
- pnpm `11.19.0`
- Python `3.11.16`
- Git `2.54.0`, tmux `3.7c`, cloudflared `2026.9.1`
- OrbStack canonical machine `nyannyan`, guest Ubuntu noble arm64
- Guest Docker `29.8.1`, Compose `v5.5.1`, CasaOS active
- `./scripts/bootstrap.sh --check` passed without changes
- Loaded local profile: `ORBSTACK_MACHINE=nyannyan`, `MAC_CONTROL_USER=nyannyan`,
  `EXTERNAL_STORAGE_ROOT=/Volumes/Avalon`

## Boundary scan and current gates

The executable/config source scan found old paths only in the intentional Xiaoya source migration
mapping, test fixtures, and prohibition/legacy text. No active destination workflow dependency on
`/Users/blacksidev`, `/home/blacksidev`, or `xu-mac` was found.

The canonical M204 OpenClaw container is healthy with `restart=unless-stopped` on the repaired image.
Owner acceptance is still pending a post-fix WhatsApp marker; the final cutover token has not been
supplied or executed.

```text
WHATSAPP_ACCEPTANCE=pending_post_fix_resend
TELEGRAM_ACCEPTANCE=pending
DUPLICATE_RUNTIME=not-finalized
DESTINATION_AUTHORITY=NO
WORKSTATION_AUTHORITY=pre-cutover-verified
CODEX_EXECUTION_AUTHORITY=pre-cutover-verified
COMMIT_SKULD_CUTOVER_1_4_8=NOT_SUPPLIED
```

Rollback assets and Immich source remain preserved.
