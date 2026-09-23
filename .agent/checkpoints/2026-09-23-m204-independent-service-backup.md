# M204 independent-service restore preparation checkpoint

Date: 2026-09-23 (Asia/Shanghai)
Status: source backup complete; destination service restore not started

## Authorization and boundaries

- User authorized restoring services that do not depend on Avalon and confirmed that the disk will retain the mount name `/Volumes/Avalon`.
- The old Mac/CasaOS remains the only authoritative runtime. No second OpenClaw/Product Radar runtime, duplicate sender, or ingress cutover was started.
- M204 is SSH reachable, but its OrbStack `nyannyan` guest is stopped/unresponsive through the CLI. `/Volumes/Avalon` is not mounted on M204. No business app/data/secret was restored there.
- Compose/config preparation may preserve `/Volumes/Avalon`; starting a disk consumer still requires the disk to be attached and its identity/sentinel verified.

## Source backup and validation

- Full HomeLab backup: `/Volumes/Avalon/backups/operation-skuld/full-homelab-backup-20260923T025614Z`.
- The corrected backup includes 16 MIGRATE services; all recorded checksums verified. It includes the exact live 9Router image `local/9router:0.5.81` and Xiaoya's actual `/home/blacksidev/xiaoya` bind data plus the separate Alist `/opt/alist/data` named-volume archive and restore map.
- Backup script now fails on missing or empty source archives instead of silently emitting empty artifacts. Its fixture test and `bash -n` passed.
- Runtime-preparation backup: `/Volumes/Avalon/backups/operation-skuld/full-homelab-backup-20260923T025614Z/runtime-preparation/20260923T030136Z`.
- The three service-aware SQLite snapshots (`identity`, `PUBG`, `Product Radar`) each passed SQLite integrity and SHA-256/manifest comparison. Immich PostgreSQL dump passed `pg_restore --list`.
- 9Router archive `data.sqlite` and captured WAL were extracted into a temporary verification directory; `PRAGMA integrity_check` returned `ok` (12 tables). Do not treat the broad raw AppData tar as a canonical DB backup: it reported the nonstandard `9router/.../data.sqlite` changing while read. Prefer the service-aware snapshots for supported databases and the verified dedicated 9Router archive for its state.
- Fresh encrypted secret bundle: `/Volumes/Avalon/backups/operation-skuld/full-homelab-backup-20260923T025614Z/runtime-preparation/secrets-20260923T030829Z/secrets.tar.enc`. Import rehearsal and `restore-skuld-secrets.sh --dry-run` passed; no plaintext values were logged.

## Dependency classification from source live container mounts

Direct Avalon binds observed: Immich (`/Volumes/Avalon/immich/data`), media-organizer-adapter (media/download/backup paths), Emby, qBittorrent, aria2, Jellyfin, and Alist. Preserve `/Volumes/Avalon` in their destination definitions, but defer starting them until mount identity/sentinel checks pass.

OpenClaw and Product Radar have no direct Avalon bind, but remain gated by single-runtime/cutover and duplicate-notification rules. frpc and Nginx Proxy Manager remain gated by ingress cutover. A service having no direct Avalon bind is not, by itself, sufficient authorization to duplicate an externally active runtime.

## Next step

User action needed: start the canonical `nyannyan` guest in OrbStack UI on M204. Then continue with a service-by-service restore of the non-Avalon, non-ingress, non-duplicate-runtime set, verifying each service before proceeding. Keep the old CasaOS source intact until explicit cutover verification.
