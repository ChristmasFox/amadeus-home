# M204 non-Avalon service restore — phase 1

Date: 2026-09-23 (Asia/Shanghai)
Status: phase 1 verified; source CasaOS remains authoritative; no cutover

## Source backup and tracked definitions

- Source restore root: `/Volumes/Avalon/backups/operation-skuld/full-homelab-backup-20260923T045305Z`.
- Full manifest: 16/16 MIGRATE services `passed`; every checksum verified. Filebrowser includes AppData and both image-declared volumes (`/database`, `/config`). Xiaoya includes its image archive, bind data and Alist data volume.
- Do not use the incomplete `20260923T044715Z` attempt: it omitted Filebrowser `/config`. The stdin-consumption regression is fixed and covered by fixture test.
- Supplementary Filebrowser image checkpoint: `/Volumes/Avalon/backups/operation-skuld/full-homelab-backup-20260923T045305Z/runtime-preparation/filebrowser-image-20260923T051121Z`; SHA-256 `162e521cca8f1834e83f3c185ce7e9230ceff304dbe41900b0bad9b52a31f561`.
- Source commit `4bdc605` is pushed; M204 clone fast-forwarded cleanly to the same commit. CasaOS definitions are installed at `/var/lib/casaos/apps/{9router,filebrowser,xiaoya}/docker-compose.yml`.

## Protected transfer and image identity

- M204 host staging directory is `/Users/nyannyan/Library/Caches/operation-skuld/20260923` with mode `700`; each transferred archive SHA-256 matched the source before extraction.
- M204 guest cannot reach Docker Hub (registry TLS handshake timeout), so Filebrowser's pinned source image was saved and imported offline. No proxy/network policy was changed.
- Source Docker 28.2.2 and destination Docker 29.8.1 report different image IDs after import. For both Filebrowser and Xiaoya, source/target platform and creation time match, all RootFS layer digests match, and complete image `Config` objects compare equal. Target tags remain `filebrowser/filebrowser:v2.49.0` and `xiaoyaliu/alist:latest`; destination-generated IDs are not byte-identical IDs.
- Xiaoya appdata contains service tokens/cookies; `/DATA/AppData/xiaoya` and its `alist-data` subdirectory are `700 root:root`. Secret values were not displayed or committed.

## M204 runtime evidence

The OrbStack `nyannyan` guest runs four migration-stage services:

| Service | Destination state | Local verification |
| --- | --- | --- |
| Changedetection | healthy; no host-published port | Health passes; source instance remains active, so monitoring temporarily runs in parallel |
| 9Router | running; `127.0.0.1:20128` | dashboard redirects (HTTP 307); unauthenticated `/v1/models` returns 401 on source and target |
| Filebrowser | healthy; `127.0.0.1:10180` | HTTP 200; restored AppData and both volumes; `/DATA` remains writable, hence loopback-only |
| Xiaoya/Alist | running; `127.0.0.1:5678` and `127.0.0.1:2345-2347` | UI and `/api/public/settings` return HTTP 200; no restart; no container healthcheck |

- Xiaoya `data.db` and `strm_internal.db` both pass SQLite `PRAGMA integrity_check`. `x_storages` has 169 rows and no literal `/Volumes/Avalon` path in stored text fields. This proves DB/UI restoration, not successful access to every remote storage backend.
- `/Volumes/Avalon` is not mounted in M204. No direct Avalon-bind consumer was started; no public/LAN ingress, OpenClaw runtime, Product Radar runtime, frpc, or Nginx Proxy Manager was started.
- Existing source services remain intact. Changedetection has a temporary duplicate-polling side effect until later cutover or a deliberate source stop.

## Validation and remaining work

- `pnpm test:migration-blockers`: 25/25 pass; focused full-backup fixture, shell syntax, secrets scan, `git diff --check`, and Compose config checks pass.
- `pnpm workflow:verify` reaches architecture checks but reports pre-existing findings in three unmodified scripts: `plan-destination-bootstrap.sh`, `plan-skuld-rollback.sh`, and `test-skuld-preparation-tooling.sh`.
- Keep services local-only. Verify Alist remote-storage behavior when its prerequisites are available. Attach Avalon and pass UUID/sentinel/storage preflight before starting direct Avalon binds. Keep OpenClaw/Product Radar, ingress and host-network services behind their separate gates.
