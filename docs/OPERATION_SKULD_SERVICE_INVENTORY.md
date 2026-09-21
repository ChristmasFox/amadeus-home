# Operation Skuld service inventory

Generated from the current running CasaOS containers. This document is sanitized: it records paths, image references, and restore classification, never environment values or credential contents.

| Service | Image | Compose directory | Persistent mounts observed | Classification |
| --- | --- | --- | --- | --- |
| changedetection | `ghcr.io/dgtlmoon/changedetection.io:0.60.3` | `/var/lib/casaos/apps/product-radar` | `/DATA/AppData/changedetection/datastore -> /datastore;` | COMPATIBILITY / protected datastore |
| immich-server | `altran1502/immich-server:v3.2.2` | `/var/lib/casaos/apps/immich` | `/var/lib/docker/volumes/aaeab3749bb9a90400f62098c5ee45226ad258db11915a1890b8822bbded0ba0/_data -> /data;/Volumes/Avalon/immich/data -> /usr/src/app/upload;/etc/localtime -> /etc/localtime;` | ACTIVE / protected database or media boundary |
| immich-redis | `docker.io/redis:6.2-alpine@sha256:148bb5411c184abd288d9aaed139c98123eeb8824c5d3fce03cf721db58066d8` | `/var/lib/casaos/apps/immich` | `/DATA/AppData/immich/redis -> /data;` | ACTIVE / protected database or media boundary |
| immich-machine-learning | `altran1502/immich-machine-learning:v3.2.2` | `/var/lib/casaos/apps/immich` | `/DATA/AppData/immich/model-cache -> /cache;` | ACTIVE / protected database or media boundary |
| immich-postgres | `ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0` | `/var/lib/casaos/apps/immich` | `/DATA/AppData/immich/pgdata -> /var/lib/postgresql/data;` | ACTIVE / protected database or media boundary |
| 9router | `local/9router:0.5.81` | `/var/lib/casaos/apps/9router` | `/DATA/AppData/9router/data -> /app/data;` | ACTIVE / exact image + protected data |
| product-radar | `local/product-radar:git-4d11f3e02074-20260920153810` | `/var/lib/casaos/apps/product-radar` | `/DATA/AppData/product-radar -> /data;/DATA/AppData/openclaw/notifications -> /notifications;` | ACTIVE / protected SQLite + outbox |
| openclaw | `local/openclaw-amadeus:git-4c61b1ef2b02-20260920155823` | `/var/lib/casaos/apps/openclaw` | `/DATA/AppData/openclaw/config -> /home/node/.openclaw;/DATA/AppData/openclaw/workspace -> /home/node/.openclaw/workspace;/DATA/AppData/openclaw/secrets/owner-whatsapp-target -> /run/secrets/owner_whatsapp_target;/DATA/AppData/openclaw/data -> /data;/DATA/AppData/openclaw/secrets/telegram-bot-token -> /run/secrets/telegram_bot_token;/DATA/AppData/openclaw/secrets/mac-ssh-key -> /run/secrets/mac_ssh_key;/DATA/AppData/openclaw/secrets/kook-bot-token -> /run/secrets/kook_bot_token;/DATA/AppData/openclaw/secrets/kiwivm-credentials.json -> /run/secrets/kiwivm_credentials.json;/DATA/AppData/openclaw/notifications -> /var/lib/openclaw/notifications;/DATA/AppData/openclaw/secrets/pubg-team.json -> /run/secrets/pubg_team.json;/DATA/AppData/openclaw/secrets/pubg-api-key -> /run/secrets/pubg_api_key;/DATA/AppData/openclaw/secrets/vps-readonly-ssh-key -> /run/secrets/vps_ssh_key;/DATA/AppData/openclaw/secrets/vps-ssh-known-hosts -> /run/secrets/vps_ssh_known_hosts;` | ACTIVE / protected runtime |
| frpc | `snowdreamtech/frpc:latest` | `/var/lib/casaos/apps/frpc` | `/DATA/AppData/frpc/frpc.toml -> /etc/frp/frpc.toml;` | ACTIVE external service / manual restore path |
| xiaoya | `xiaoyaliu/alist:latest` | `not labeled` | `/home/blacksidev/xiaoya -> /data;/var/lib/docker/volumes/8a979910e1aaeb5c9696679a25137d085a1a145abd46780172d7477c789786eb/_data -> /opt/alist/data;/home/blacksidev/xiaoya/data -> /www/data;` | ACTIVE external service / manual restore path |
| media-organizer-adapter | `local/media-organizer-adapter:0.1.0` | `/var/lib/casaos/apps/media-organizer-adapter` | `/DATA/AppData/media-organizer-adapter -> /state;/Volumes/Avalon/backups/media-organizer -> /Volumes/Avalon/backups/media-organizer;/Volumes/Avalon/downloads -> /Volumes/Avalon/downloads;/Volumes/Avalon/media -> /Volumes/Avalon/media;/Users/blacksidev/.codex/skills/organize-emby-media -> /skill;` | ACTIVE / registered state |
| homarr | `ghcr.io/homarr-labs/homarr:latest` | `/var/lib/casaos/apps/big-bear-homarr` | `/DATA/AppData/big-bear-homarr/data -> /app/data;/var/lib/docker/volumes/7d4cae5b25c91a94a20736fc21a54133e2795df39194f6ed14325b755ac4378f/_data -> /appdata;/var/run/docker.sock -> /var/run/docker.sock;` | ACTIVE external service / manual restore path |
| dashdot | `mauricenino/dashdot:latest` | `/var/lib/casaos/apps/dashdot` | `/ -> /mnt/host;` | ACTIVE external service / manual restore path |
| emby | `linuxserver/emby:4.9.1` | `/var/lib/casaos/apps/emby` | `/Volumes/Avalon/media/movies -> /data/movies;/Volumes/Avalon/media/music -> /data/music;/Volumes/Avalon/media/tv -> /data/tvshows;/DATA/AppData/emby/config -> /config;` | ACTIVE external service / manual restore path |
| qbittorrent | `lscr.io/linuxserver/qbittorrent:latest` | `/var/lib/casaos/apps/qbittorrent` | `/DATA/AppData/qbittorrent/config -> /config;/Volumes/Avalon/downloads -> /downloads;` | ACTIVE external service / manual restore path |
| nginxproxymanager | `jc21/nginx-proxy-manager:2.13.5` | `/var/lib/casaos/apps/nginxproxymanager` | `/DATA/AppData/nginxproxymanager/data -> /data;/DATA/AppData/nginxproxymanager/etc/letsencrypt -> /etc/letsencrypt;` | ACTIVE external service / manual restore path |
| filebrowser | `filebrowser/filebrowser:v2.49.0` | `/var/lib/casaos/apps/filebrowser` | `/DATA -> /srv;/var/lib/docker/volumes/d5163a1ed76c55adb0da90f9e8dcb32c1af3ff99554d58950ab36a61e76dab23/_data -> /config;/var/lib/docker/volumes/2ef500be8b10cf00c471119d52f45ae9262436a8ab9cd99cfc6224ba773a29e0/_data -> /database;/DATA/AppData/filebrowser/db -> /db;` | ACTIVE external service / manual restore path |
| ariang | `p3terx/ariang:latest` | `/var/lib/casaos/apps/ariang` | `none reported` | ACTIVE external service / manual restore path |
| aria2 | `p3terx/aria2-pro:latest` | `/var/lib/casaos/apps/aria2` | `/DATA/AppData/aria2/config -> /config;/Volumes/Avalon/downloads/complete -> /downloads;/Volumes/Avalon/downloads/incomplete -> /downloads/incomplete;/DATA/AppData/alist/data/temp -> /opt/alist/data/temp;` | ACTIVE external service / manual restore path |
| jellyfin | `lscr.io/linuxserver/jellyfin:latest` | `/var/lib/casaos/apps/jellyfin` | `/DATA/AppData/jellyfin/cache -> /cache;/DATA/AppData/jellyfin/config -> /config;/Volumes/Avalon/media/movies -> /data/movies;/Volumes/Avalon/media/music -> /data/music;/Volumes/Avalon/media/photos -> /data/photos;/Volumes/Avalon/media/tv -> /data/tvshows;` | ACTIVE external service / manual restore path |
| alist | `xhofe/alist:v3.40.0` | `/var/lib/casaos/apps/alist` | `/DATA/AppData/alist/data -> /opt/alist/data;/Volumes/Avalon -> /storage/avalon;` | ACTIVE external service / manual restore path |
| v2raya | `mzz2017/v2raya:v2.2.6.7` | `/var/lib/casaos/apps/v2raya` | `/etc/resolv.conf -> /etc/resolv.conf;/DATA/AppData/v2raya -> /etc/v2raya;/lib/modules -> /lib/modules;` | ACTIVE external service / manual restore path |
| xiaoyakeeper | `ddsderek/xiaoyakeeper:latest` | `not labeled` | `/var/run/docker.sock -> /var/run/docker.sock;` | ACTIVE external service / manual restore path |

## Protected credential/state coverage

- OpenClaw: external env, channel tokens, owner target, PUBG/VPS/NAS/KOOK credentials and SQLite/outbox.
- Product Radar: runtime env, SQLite and shared owner outbox.
- 9Router: runtime credential names are external; `/DATA/AppData/9router/data` is encrypted protected state; exact image export is retained.
- Immich: database credential source and PostgreSQL AppData are protected; media is a verified external volume; Redis/model cache are classified separately.
- changedetection and media adapter state remain in the migration boundary while active.
- Other running CasaOS services are discovered above and require their own manual or service-specific restore path; generic GC never deletes them.

Secret values are intentionally absent from this inventory.
