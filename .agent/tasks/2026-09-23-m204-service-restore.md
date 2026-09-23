# M204 service restore after OrbStack guest recovery

Status: in progress; destination guest is running and the first two services are staged.

## User-approved intent

Restore services that do not require Avalon first. Preserve `/Volumes/Avalon` as the stable mount name for destination definitions; the user will keep that name when attaching the disk. The old CasaOS runtime remains authoritative until cutover.

## Completed

- Latest complete source backup: `/Volumes/Avalon/backups/operation-skuld/full-homelab-backup-20260923T045305Z`; all 16 service results and checksums pass. It includes Xiaoya's exact image/data and both Filebrowser image-declared volumes (`/database`, `/config`). The earlier `044715Z` attempt omitted `/config` and must not be used for restore.
- The backup fixture now simulates a child process consuming stdin; the Filebrowser volume loop still emits both archives.
- Earlier service-aware SQLite snapshots, Immich logical dump listing, 9Router SQLite+WAL integrity, and encrypted secret restore rehearsal passed; values were never logged.
- Source live mounts identify direct Avalon consumers: Immich, media-organizer-adapter, Emby, qBittorrent, aria2, Jellyfin, and Alist.
- M204 `nyannyan` OrbStack guest is running after the OS auto-update. Only Changedetection (healthy, no host-published port) and 9Router (`127.0.0.1:20128`) are currently running there. Source remains authoritative; Changedetection temporarily polls in parallel.
- 9Router source and destination both return 200 for unauthenticated `/v1/models`, contrary to the historical 401 contract. Keep it loopback-only and do not open ingress until reconciled.
- Filebrowser and Xiaoya Compose templates are source-controlled and loopback-only. Filebrowser has a writable `/DATA` mount; Xiaoya backup has no literal `/Volumes/Avalon` path, but Alist storage behavior is not yet functionally verified.

## Remaining steps

1. Commit/push the source-controlled backup and Compose fixes, then fast-forward the clean target clone before applying app definitions.
2. Restore Filebrowser and Xiaoya from the `045305Z` artifacts into fresh `/DATA/AppData` paths; load the archived Xiaoya image and verify its image ID before start. Keep both loopback-only and do not expose the Filebrowser full-AppData view.
3. Check Xiaoya local UI/API and Alist storage entries; report Avalon-backed functionality separately from container health. Preserve all staging and backup artifacts.
4. Keep OpenClaw/Product Radar behind the single-runtime/cutover gate; frpc/Nginx Proxy Manager behind ingress verification; v2raya behind a host-network review.
5. Preserve `/Volumes/Avalon` in consumer definitions but do not start Avalon bind consumers until the disk is actually mounted and its UUID/sentinel/storage preflight passes.
6. Keep the source runtime and all rollback artifacts until explicit final cutover; update current state and checkpoint after the restore phase.
