# M204 service restore after OrbStack guest recovery

Status: blocked on destination OrbStack guest startup; source backup is complete.

## User-approved intent

Restore services that do not require Avalon first. Preserve `/Volumes/Avalon` as the stable mount name for destination definitions; the user will keep that name when attaching the disk. The old CasaOS runtime remains authoritative until cutover.

## Completed preparation

- Full HomeLab backup and secret bundle are stored under `/Volumes/Avalon/backups/operation-skuld/full-homelab-backup-20260923T025614Z`.
- Archive checksums, service-aware SQLite snapshots, Immich logical dump listing, 9Router SQLite+WAL integrity, and secret restore rehearsal passed.
- Source live mount inspection identified direct Avalon consumers: Immich, media-organizer-adapter, Emby, qBittorrent, aria2, Jellyfin, and Alist.

## Resume steps

1. Ask the user to start the canonical `nyannyan` guest in M204 OrbStack UI; then confirm `orb list`, Docker, CasaOS, and the clean target Git checkout.
2. Restore only non-Avalon services that do not create a second agent runtime or externally duplicate ingress. Use explicit artifacts and secrets; no raw AppData tar for database recovery.
3. Verify each restored service locally before proceeding. Keep OpenClaw and Product Radar behind the single-runtime/cutover gate; keep frpc and Nginx Proxy Manager behind ingress verification.
4. Keep Avalon consumers configured with `/Volumes/Avalon` but stopped until the disk is attached and `diskutil info`, UUID/sentinel, and storage preflight pass.
5. Update this task, project state, and a new dated checkpoint after each restore phase. Preserve the source runtime and all rollback artifacts until final cutover is explicitly complete.
