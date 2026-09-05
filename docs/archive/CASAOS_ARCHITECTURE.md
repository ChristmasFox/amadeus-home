# CasaOS Architecture

Last updated: 2026-05-17

## Topology

- Host OS: macOS
- VM/runtime: OrbStack
- Primary Linux machine: `ubuntu`
- Home services platform: CasaOS inside `ubuntu`
- Canonical service Docker daemon: Docker inside OrbStack `ubuntu`

Key note:

- `/Volumes` from macOS is mounted into Ubuntu through `virtiofs`
- Persistent Linux-local app data lives under `/DATA/AppData`
- Persistent shared media lives under `/Volumes/Avalon`

## Deployment Policy

- All long-lived home services should be deployed inside OrbStack `ubuntu`
- Prefer CasaOS app definitions at `/var/lib/casaos/apps/<app>/docker-compose.yml`
- Do not use host-side Docker on macOS for these services unless explicitly requested

## Important Paths

- CasaOS app definitions: `/var/lib/casaos/apps`
- Linux app data: `/DATA/AppData`
- Media root: `/Volumes/Avalon/media`
- Downloads: `/Volumes/Avalon/downloads`
- Backups: `/Volumes/Avalon/backups`

Media subpaths:

- `/Volumes/Avalon/media/movies`
- `/Volumes/Avalon/media/tv`
- `/Volumes/Avalon/media/music`
- `/Volumes/Avalon/media/photos`

## Current Runtime

OrbStack machine:

- `ubuntu`
- IP seen during inspection: `192.168.139.26`

Storage:

- Ubuntu root/data device: `/dev/vdb1`, mounted at `/`, about `148G`
- macOS shared mount visible in Ubuntu at `/Volumes`

## Running Containers

Observed running containers inside OrbStack `ubuntu`:

| Container | Image | Ports |
| --- | --- | --- |
| `emby` | `linuxserver/emby:4.9.1` | `8096`, `8920` |
| `nginxproxymanager` | `jc21/nginx-proxy-manager:2.13.5` | `80`, `81`, `443` |
| `filebrowser` | `filebrowser/filebrowser:v2.49.0` | `10180->80` |
| `ariang` | `p3terx/ariang:latest` | `6880` |
| `aria2` | `p3terx/aria2-pro:latest` | `6800`, `6888/tcp`, `6888/udp` |
| `9router` | `decolua/9router:latest` | `20128` |
| `jellyfin` | `lscr.io/linuxserver/jellyfin:latest` | `8097->8096`, `7359/udp`, `1900/udp` |
| `alist` | `xhofe/alist:v3.40.0` | `5244` |
| `xiaoya` | `xiaoyaliu/alist:latest` | `2345-2347`, `5678->80` |
| `v2raya` | `mzz2017/v2raya:v2.2.6.7` | not exposed in `docker ps` output |
| `big-bear-pihole` | `pihole/pihole:2026.02.0` | `53/tcp+udp`, `67/udp`, `8080->80`, `10443->443` |
| `immich-server` | `altran1502/immich-server:v2.5.3` | `2283` |
| `immich-postgres` | `tensorchord/pgvecto-rs:pg14-v0.2.0` | internal `5432` |
| `immich-machine-learning` | `altran1502/immich-machine-learning:v2.5.3` | internal only |
| `immich-redis` | `redis:6.2-alpine` | internal `6379` |
| `homarr` | `ghcr.io/ajnart/homarr:0.16.0` | `7575` |
| `xiaoyakeeper` | `ddsderek/xiaoyakeeper:latest` | internal only |

## CasaOS App Definitions Present

Observed CasaOS app compose files:

- `9router`
- `adoring_rafael`
- `alist`
- `aria2`
- `ariang`
- `big-bear-dashdot`
- `big-bear-homarr`
- `big-bear-openclaw`
- `big-bear-pihole`
- `emby`
- `filebrowser`
- `immich`
- `jellyfin`
- `magical_edwin`
- `nginxproxymanager`
- `resilient_jose`
- `v2raya`

Some CasaOS app IDs are generated names and may not match running container names directly.

## Notable App Mount Patterns

### Emby

Compose path:

- `/var/lib/casaos/apps/emby/docker-compose.yml`

Key mounts:

- `/DATA/AppData/emby/config -> /config`
- `/Volumes/Avalon/media/tv -> /data/tvshows`
- `/Volumes/Avalon/media/movies -> /data/movies`
- `/Volumes/Avalon/media/music -> /data/music`

### Jellyfin

Present and running separately from Emby.

### Alist

Key mounts:

- `/DATA/AppData/alist/data -> /opt/alist/data`
- `/Volumes/Avalon -> /storage/avalon`

### aria2

Key mounts:

- `/DATA/AppData/aria2/config -> /config`
- `/Volumes/Avalon/downloads/complete -> /downloads`
- `/Volumes/Avalon/downloads/incomplete -> /downloads/incomplete`

### Filebrowser

Key mounts:

- `/DATA/AppData/filebrowser/db -> /db`
- `/DATA -> /srv`

## Change Workflow

When modifying a persistent service:

1. Inspect the existing CasaOS compose:
   `orb -m ubuntu -u root sed -n '1,200p' /var/lib/casaos/apps/<app>/docker-compose.yml`
2. Edit the CasaOS compose, not a host-side compose copy.
3. Keep ports/volumes consistent with `x-casaos` metadata when relevant.
4. Recreate only the affected app:
   `orb -m ubuntu -u root bash -lc 'cd /var/lib/casaos/apps/<app> && docker compose up -d'`
5. Verify:
   `orb -m ubuntu -u root docker inspect <container>`
   `orb -m ubuntu -u root docker ps`

## Explicit Rule For Future Agents

- If asked to deploy or modify apps, assume the target is CasaOS inside OrbStack `ubuntu`.
- Do not default to the host Docker daemon on macOS.
- Use host Docker only if the user explicitly overrides this rule.

## Troubleshooting

If an agent says it cannot access OrbStack, Docker, or CasaOS, check these in order:

1. Confirm the target environment.
   - Home services are not on host macOS Docker.
   - They are expected inside OrbStack machine `ubuntu`.

2. Confirm OrbStack machine status.
   - Run: `orb list`
   - Expected: `ubuntu` is `running`

3. Confirm command path is using OrbStack Linux.
   - Use: `orb -m ubuntu ...`
   - For CasaOS/Docker admin tasks use: `orb -m ubuntu -u root ...`

4. Distinguish host Docker from Ubuntu Docker.
   - Host `docker ps` may be empty or irrelevant.
   - Check the real service runtime with:
     `orb -m ubuntu -u root docker ps`

5. Check Docker socket permissions inside Ubuntu.
   - If non-root access fails with docker socket permission denied, retry as root:
     `orb -m ubuntu -u root docker ps`

6. Check whether the app is CasaOS-managed.
   - Inspect:
     `/var/lib/casaos/apps/<app>/docker-compose.yml`
   - Do not assume a host-side compose file is authoritative.

7. Verify effective container mounts instead of trusting compose assumptions.
   - Run:
     `orb -m ubuntu -u root docker inspect <container>`

8. If a service change was made but behavior did not change, recreate from the CasaOS app directory.
   - Run:
     `orb -m ubuntu -u root bash -lc 'cd /var/lib/casaos/apps/<app> && docker compose up -d'`

9. If an HTTP service is up but the app still does not see media/data, check both:
   - container mounts
   - app-level library/index configuration

10. If `sudo` blocks in Ubuntu because it requires a password, prefer root execution through OrbStack flags.
   - Use:
     `orb -m ubuntu -u root ...`
