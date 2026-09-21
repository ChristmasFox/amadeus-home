# Operation Skuld service inventory

This is the tracked, sanitized inventory contract. Run
`scripts/service-inventory.sh --write docs/OPERATION_SKULD_SERVICE_INVENTORY.md`
against the current CasaOS host before a release evidence commit to refresh
the observed container table. It must never contain environment values,
passwords, tokens, API keys, or private-key content.

| Service | Persistent state / restore boundary | Secret metadata | Classification |
| --- | --- | --- | --- |
| OpenClaw | `/DATA/AppData/openclaw` including SQLite, workspace, config and owner outbox | external env, channel tokens, owner target, PUBG/VPS/NAS/KOOK credentials | ACTIVE / protected |
| Product Radar | `/DATA/AppData/product-radar` and shared owner outbox | runtime env and changedetection API key metadata | ACTIVE / protected |
| 9Router | `/DATA/AppData/9router/data`, exact image export plus rebuild source | API key secret, JWT secret, initial password, machine salt | ACTIVE / protected |
| Immich | external `IMMICH_MEDIA_ROOT`; PostgreSQL `/DATA/AppData/immich/pgdata`; Redis/model cache classified separately | DB credential metadata and external compose/env source | ACTIVE / media external, DB internal |
| changedetection | `/DATA/AppData/changedetection/datastore` | API key metadata | COMPATIBILITY / protected |
| media-organizer-adapter | `/DATA/AppData/media-organizer-adapter` and external media mounts | adapter/runtime metadata | ACTIVE / registered state |
| aria2 / Jellyfin / qBittorrent / Emby / alist / other active CasaOS apps | observed bind mounts and named volumes from live inventory | service-specific metadata only | ACTIVE external service / manual restore path |

The live-generated table below is replaced by the inventory command during the
1.4.4 evidence phase. The absence of a service from the repository does not
make it safe for generic GC; it remains an external service until an explicit
restore path is documented.

Secret values are intentionally absent from this document.
