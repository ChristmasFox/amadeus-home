# M204 non-Avalon service restore — phase 2

Date: 2026-09-23
Status: partial restore; six services running in local-only staging, no cutover.

## Scope and source of truth

- User authorized restoring services independent of Avalon first and confirmed all future consumers will retain the exact mount name `/Volumes/Avalon`.
- M204 OrbStack guest `nyannyan` is running after the OS auto-update. CasaOS and Docker are usable. `/Volumes/Avalon` is not mounted in the guest.
- The old source CasaOS remains authoritative; the M204 services are staging only. No public/LAN ingress changed and no source service was stopped.
- Latest full backup remains `/Volumes/Avalon/backups/operation-skuld/full-homelab-backup-20260923T045305Z`; its 16/16 MIGRATE entries and checksums passed. See phase 1 for backup and data-integrity evidence.

## Services and runtime verification

Six services are running on M204 with restart count 0:

| Service | Target binding | Verification | Boundary |
| --- | --- | --- | --- |
| Changedetection | no host-published port | healthy | Still polls beside source; staging only |
| 9Router | `127.0.0.1:20128` | no-auth `/v1/models` returns expected 401 | No external ingress |
| Filebrowser | `127.0.0.1:10180` | healthy; HTTP 200 | Writable `/DATA`; loopback only |
| Xiaoya | `127.0.0.1:5678`, `2345-2347` | main UI and `/api/public/settings` on 5678 return 200; SQLite integrity was verified in phase 1 | Remote storage not fully accepted; `/` on 2345 returned HTTP 500 and is unclassified |
| AriaNG | `127.0.0.1:6880` | HTTP 200 | UI only; aria2 backend remains gated on Avalon downloads |
| Dashdot | `127.0.0.1:3001` | HTTP 200 | Guest `/` is mounted read-only at `/mnt/host` |

All host-published bindings are `127.0.0.1`; no LAN/public listener was added. The currently running containers all report `restarts=0`.

## AriaNG/Dashdot artifacts

- Source templates are tracked at `infra/docker/homelab/ariang/docker-compose.example.yml` and `infra/docker/homelab/dashdot/docker-compose.example.yml`, commit `32be0ec`.
- The M204 clone fast-forwarded to `32be0ec` and was clean before this checkpoint was written.
- Supplemental source archives live under `/Volumes/Avalon/backups/operation-skuld/full-homelab-backup-20260923T045305Z/runtime-preparation/rebuild-images-20260923T052324Z`.
- AriaNG archive SHA-256: `0b821e30f5e532794a81b99ccd23e168641b3984fbe2f2b0f584a5a5cee75f5b`.
- Dashdot archive SHA-256: `5e69e15a9e71707b1f9db7f9cc1b7e885cff606fa65e89d6c156e65dc25c3143`.
- Both transfer hashes matched on M204 staging. Docker 28.2.2 to 29.8.1 changed normalized image IDs, but source and destination platform, created timestamp, complete Config, and every RootFS layer digest match for both images.
- The guest cannot reliably pull Docker Hub images (registry TLS timeout), so these exact images were imported offline. No proxy/network policy was changed.

## Deferred services and gates

- Homarr and xiaoyakeeper are not started. Both request a read-write Docker socket; socket access is deferred pending scope review. Homarr additionally references `AUTH_SECRET` and `SECRET_ENCRYPTION_KEY`, which are not yet covered by the protected secret bundle. Inventory marks Homarr `MANUAL_BLOCKER`.
- Direct Avalon consumers remain stopped: Immich, media-organizer-adapter, Emby, qBittorrent, aria2, Jellyfin, and Alist. Keep definitions on `/Volumes/Avalon`; start only after actual disk attachment and UUID/sentinel/storage preflight.
- OpenClaw/Product Radar remain behind the unique-runtime/cutover gate; frpc/Nginx Proxy Manager remain behind ingress verification; v2raya remains behind host-network review.
- Keep source services and rollback artifacts intact until explicit cutover and real acceptance.
