# M204 service restore after OrbStack guest recovery

Status: in progress; four Avalon-independent services are running in local-only staging.

## User-approved intent

Restore services that do not require Avalon first. Preserve `/Volumes/Avalon` as the stable mount name for destination definitions; the user will keep that name when attaching the disk. The old CasaOS runtime remains authoritative until cutover.

## Completed

- Latest complete source backup: `/Volumes/Avalon/backups/operation-skuld/full-homelab-backup-20260923T045305Z`; all 16 service results and checksums pass. It includes Xiaoya's exact image/data and both Filebrowser image-declared volumes (`/database`, `/config`). The earlier `044715Z` attempt omitted `/config` and must not be used for restore.
- The backup fixture now simulates a child process consuming stdin; the Filebrowser volume loop still emits both archives.
- Earlier service-aware SQLite snapshots, Immich logical dump listing, 9Router SQLite+WAL integrity, and encrypted secret restore rehearsal passed; values were never logged.
- Source live mounts identify direct Avalon consumers: Immich, media-organizer-adapter, Emby, qBittorrent, aria2, Jellyfin, and Alist.
- M204 `nyannyan` OrbStack guest is running after the OS auto-update. Changedetection is healthy with no host-published port; its source instance remains active, so target polling is temporary parallel staging.
- 9Router, Filebrowser, and Xiaoya are running only on guest loopback. Filebrowser is healthy at `127.0.0.1:10180`; it retains the original writable `/DATA` view. Xiaoya UI and public-settings endpoints return HTTP 200 on loopback.
- Source and target 9Router both return HTTP 401 for unauthenticated `/v1/models`; target binds only `127.0.0.1:20128`.
- Filebrowser/Xiaoya Compose templates are tracked in commit `4bdc605`. Data and image archives were SHA-verified in M204 staging; Docker 28.2.2→29.8.1 import normalized image IDs, while platform, created time, all RootFS layers, and complete image Config match source.
- Xiaoya `data.db` (169 storage rows) and `strm_internal.db` pass SQLite `integrity_check`; no literal `/Volumes/Avalon` path occurs in the storage rows. Xiaoya appdata and Alist directory are `700 root:root`; remote-storage functionality is not yet asserted.

## Remaining steps

1. Preserve local-only staging and obtain focused Alist remote-storage acceptance after its external paths/network are available; distinguish this from the passing container/UI checks.
2. Keep OpenClaw/Product Radar behind the single-runtime/cutover gate; frpc/Nginx Proxy Manager behind ingress verification; v2raya behind host-network review.
3. Preserve `/Volumes/Avalon` in consumer definitions but do not start direct Avalon-bind consumers until the disk is attached and UUID/sentinel/storage preflight passes.
4. Keep the source runtime and rollback artifacts until explicit final cutover; update state and checkpoint after each migration phase.
