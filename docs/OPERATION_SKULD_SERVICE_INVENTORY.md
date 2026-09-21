# Operation Skuld service inventory

Generated/verified against the canonical CasaOS runtime on 2026-09-21. This is a sanitized migration contract: it contains no credential values, only logical secret IDs, persistent paths, restore methods and runtime verification. Classifications are explicit and must be one of `MIGRATE`, `REBUILD`, `EXTERNAL_DATA`, `DROP`, or `MANUAL_BLOCKER`.

| Service | Live image/runtime | Persistent data and external data | Secret refs (logical IDs only) | Classification | Backup method | Restore method | Verification | Cutover dependency |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| openclaw | CasaOS `openclaw` | workspace, SQLite, outbox, VPS state | openclaw-env; openclaw-gateway-token; pubg-api-key; telegram-token; kook-token; mac-ssh-key; vps-readonly-key; vps-known-hosts; kiwivm-credentials | MIGRATE | service-aware SQLite/JSON + workspace metadata + encrypted bundle | restore before compose start | healthz, SQLite integrity, outbox, cron | owner channels |
| product-radar | CasaOS `product-radar` | product-radar.sqlite, runtime env | product-radar-runtime-env | MIGRATE | SQLite consistent snapshot + encrypted env | restore before compose start | health + SQLite + outbox | product monitoring |
| 9router | CasaOS exact image `local/9router:0.5.81` | `/DATA/AppData/9router/data`, exact image | 9router-api-key-secret; 9router-jwt-secret; 9router-initial-password; 9router-machine-id-salt | MIGRATE | protected data archive + exact `docker save` artifact | `docker load`, restore env/data, isolated start | dashboard 200; no-auth models 401; fixture auth boundary | provider routes |
| immich | CasaOS Immich stack | PostgreSQL logical dump; `/Volumes/Avalon/immich/data`; Redis/model rebuildable | immich-db-password | MIGRATE + EXTERNAL_DATA | `pg_dump -Fc`; UUID/sentinel/equivalence reference | logical restore; attach Avalon; health check | `pg_restore --list`, health, media equivalence | media UI |
| changedetection | CasaOS compatibility service | `/DATA/AppData/changedetection/datastore` | changedetection-runtime-env | MIGRATE | protected datastore archive | restore before start | HTTP health + datastore | optional |
| media-organizer-adapter | registered CasaOS service | `/DATA/AppData/media-organizer-adapter`, Avalon media/download mounts | media-adapter-runtime-env | MIGRATE | registered state archive | restore and reconnect mounts | healthz + dry-run organizer contract | media workflow |
| frpc | CasaOS external tunnel | `/DATA/AppData/frpc/frpc.toml` | frpc-token-auth | MIGRATE | sanitized config + encrypted credential bundle | restore config/credential, start compose | tunnel status | public ingress |
| xiaoya | CasaOS external media catalog | `/home/blacksidev/xiaoya`, `/home/blacksidev/xiaoya/data` | xiaoya-credential-config | MIGRATE | explicit host-directory archive | restore exact directories | health + mounted data read | media catalog |
| homarr | CasaOS dashboard | `/DATA/AppData/big-bear-homarr/data` | none observed | REBUILD | compose/config; dashboard data disposable | recreate, optionally restore data | HTTP health | none |
| emby | CasaOS media server | `/DATA/AppData/emby/config`, Avalon media roots | emby-config-credential-state | MIGRATE | config archive + external media reference | restore config and attach media | health + library boundary | media playback |
| qbittorrent | CasaOS downloader | `/DATA/AppData/qbittorrent/config`, Avalon downloads | qbittorrent-credential-state | MIGRATE | config archive + external downloads reference | restore config and attach downloads | web health + download paths | download pipeline |
| nginxproxymanager | CasaOS reverse proxy | `/DATA/AppData/nginxproxymanager/data`, letsencrypt | npm-db-and-certificate-state | MIGRATE | DB/certificate state archive | restore before proxy start | proxy health + TLS inventory | public TLS |
| filebrowser | CasaOS file UI | `/DATA/AppData/filebrowser/db` plus named config/database volumes | filebrowser-credential-db | MIGRATE | explicit named-volume export + AppData archive | restore volumes/data before start | health + authenticated boundary | optional |
| ariang | CasaOS UI | no persistent state observed | none observed | REBUILD | pinned compose | recreate image | HTTP health | none |
| aria2 | CasaOS downloader | `/DATA/AppData/aria2/config`, Avalon downloads | aria2-rpc-secret | MIGRATE | config archive + external downloads | restore config/secret and paths | RPC auth + path read | download pipeline |
| jellyfin | CasaOS media server | config/cache, Avalon media roots | jellyfin-config-credential-state | MIGRATE | config archive + external media reference | restore config and attach media | health + library path | media playback |
| alist | CasaOS storage gateway | `/DATA/AppData/alist/data`, Avalon | alist-credential-config | MIGRATE | data archive + external storage reference | restore data and attach Avalon | health + storage read | storage gateway |
| v2raya | CasaOS network service | `/DATA/AppData/v2raya` | v2raya-state | MIGRATE | state directory archive | restore before start | health + config parse | network compatibility |
| xiaoyakeeper | CasaOS maintenance helper | no persistent state observed; Docker socket only | none observed | REBUILD | pinned compose | recreate after socket review | running + no persistent state | none |
| dashdot | CasaOS host metrics | read-only host mount; no persistent state | none observed | REBUILD | pinned compose | recreate read-only metrics service | HTTP health | none |
| fashion-siglip | macOS LaunchAgent | model cache is redownloadable | none observed | REBUILD | tracked installer/source + cache policy | install LaunchAgent and redownload model | MPS health + launchctl | Product Radar similarity |

## Secret coverage rules

- The table and manifest contain logical IDs only. Secret values are allowed only in the encrypted Skuld bundle and target secret store.
- A `required=false` logical ID means the service is active but live presence must be verified from compose/mount metadata before a future cutover; it is not permission to invent a value or log one.
- Named volumes used by Filebrowser are explicitly classified as service-owned migration data; generic Docker GC must never delete them.
- External media/download/storage paths are references, not portable tar archives. They require volume identity, sentinel and read/health checks.
- Unknown owner paths are `MANUAL_BLOCKER` and report-only; no generic deletion is allowed.

## Runtime discovery

`bash scripts/service-inventory.sh --write docs/OPERATION_SKULD_SERVICE_INVENTORY.md` refreshes sanitized live mount/image observations. It must not overwrite the explicit classification, backup, restore or secret contract without review.
