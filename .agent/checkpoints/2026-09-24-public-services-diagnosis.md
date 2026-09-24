# 2026-09-24 Public services diagnosis

## Observed state

Public DNS/Caddy frontends are reachable, but the following HTTPS hosts return `502`: `claw`,
`immich`, `emby`, `jellyfin`, `qb`, `aria`, and `monitor` under `nyannyan.top`. This indicates
the VPS front end is responding while the frps backends have no live HomeLab tunnel. The
`sub.nyannyan.top` root returns `404`, which is expected for the tokenized subscription paths.
`9router.nyannyan.top` currently has no DNS answer.

M204 has no `frpc` process, container, or CasaOS app. Its user-facing services are healthy and
reachable on the LAN after the binding fix, but that alone does not establish the VPS tunnel.

## Recoverable source

The prior frpc configuration is preserved outside Git at:

```text
/Volumes/Avalon/backups/operation-skuld/full-homelab-backup-source-freeze-20260923T111228Z/frpc/frpc-config.tar.gz
```

Its non-secret mapping inventory includes the existing frps endpoint `sub.nyannyan.top:7000` and
the declared TCP mappings for Emby, Immich, AriaNG, aria2 RPC, qBittorrent, Jellyfin, Homarr,
Glances, and OpenClaw. Credential values were not copied into this checkpoint.

The old Mac is discoverable as `xu-mac.local`, but the M204 SSH key is not authorized there, so no
old-Mac runtime mutation was performed. Restoring frpc on M204 requires a separate explicit ingress
restore action using the protected configuration/credential bundle.

## Superseded

The diagnostic state above was resolved later on 2026-09-24. See
`.agent/checkpoints/2026-09-24-frpc-public-restore.md` for the active runtime state and public
probe evidence. The restored configuration deliberately excludes 9Router and Homarr mappings.
