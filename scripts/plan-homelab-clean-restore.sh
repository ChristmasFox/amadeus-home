#!/usr/bin/env bash
# scripts/plan-homelab-clean-restore.sh
# Amadeus 1.4.6 — HomeLab clean-restore plan for Operation Skuld.
# Prints the service-by-service restore steps using only service-aware backup artifacts.
# This is PLAN-ONLY: does not restore, SSH, or mutate anything.
# Clean-restore path is INDEPENDENT from any old OrbStack guest snapshot.
#
# Usage: scripts/plan-homelab-clean-restore.sh [--fixture] [--output-dir DIR]
set -Eeuo pipefail

ROOT_DIR="${SKULD_ROOT_DIR:-$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT_DIR"

FIXTURE_MODE=0
OUTPUT_DIR=''

while (($#)); do
  case "$1" in
    --fixture) FIXTURE_MODE=1 ;;
    --output-dir) shift; OUTPUT_DIR="${1:?--output-dir requires a path}" ;;
    --help|-h)
      printf '%s\n' 'Usage: scripts/plan-homelab-clean-restore.sh [--fixture] [--output-dir DIR]'
      exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

DEST_MACHINE="nyannyan"

print_plan() {
cat << PLAN
# Operation Skuld — HomeLab Clean-Restore Plan

Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)
Destination machine: ${DEST_MACHINE}

## Restore principles

1. CLEAN-RESTORE means restoring from explicit backup artifacts only.
   No old OrbStack guest snapshot. No host directory copy from source machine.
2. Restore order follows manifest restoreOrder.
3. Each service is verified before starting the next.
4. Secrets are restored from the encrypted bundle, not from source file copies.
5. Avalon (external 8TB) is attached and verified — not copied or archived.
6. All destination paths use nyannyan, not blacksidev.

## Backup artifact location

Operation Skuld backup root: \${SKULD_BACKUP_ROOT} (from host-profile.env)
Default: /Volumes/Avalon/backups/operation-skuld

## Restore order (by manifest restoreOrder)

### Order 10 — openclaw-workspace (OpenClaw metadata)
  Source: service-aware backup / openclaw-workspace.tar (metadata only, no secrets)
  Command: tar -xzf openclaw-workspace.tar -C /DATA/AppData/openclaw/workspace
  Verify: diff (tracked workspace files vs restored)
  Note: actual OpenClaw secrets are restored separately from encrypted bundle.

### Order 15 — 9router-provider-state (9Router runtime data + exact image)
  Source: service-aware backup / 9router/9router-<stamp>.tar.gz
  Image: exact docker save artifact (required for deterministic provider state)
  Command (image): docker load -i 9router-exact-image.tar
  Command (data): tar -xzf 9router-data.tar.gz -C /DATA/AppData/9router/
  Verify: orb -m ${DEST_MACHINE} -u root docker run --rm local/9router:0.5.81 echo ok
  Note: start 9router in isolated mode; verify /dashboard 200, /v1/models 401.

### Order 20 — identity-sqlite (OpenClaw identity database)
  Source: service-aware backup / sqlite/identity-sqlite.sqlite
  Command: cp identity-sqlite.sqlite /DATA/AppData/openclaw/data/identity.sqlite
  Verify: sqlite3 /DATA/AppData/openclaw/data/identity.sqlite 'PRAGMA integrity_check'
  Verify: sha256sum matches manifest

### Order 25 — immich-postgres (Immich database)
  Source: service-aware backup / immich/postgres-<stamp>.dump
  Command: pg_restore -Fc -d immich postgres-<stamp>.dump (inside immich-postgres container)
  Verify: pg_restore --list postgres-<stamp>.dump | grep -c TOC
  Verify: orb -m ${DEST_MACHINE} -u root docker exec immich-postgres psql -U postgres -d immich -c 'select count(*) from assets'
  Note: VectorChord extension must be present before restore.

### Order 26 — immich-external-media (Immich media on Avalon)
  Source: Avalon 8TB external disk (physically moved to destination Mac)
  Command: verify Avalon is mounted at /Volumes/Avalon
  Verify: ls /Volumes/Avalon/immich/data && cat /Volumes/Avalon/.amadeus-storage.json
  Verify: curl http://127.0.0.1:2283/api/server/ping
  Note: NO tar archive, NO rsync from source. Avalon IS the backup.

### Order 30 — pubg-sqlite (PUBG game database)
  Source: service-aware backup / sqlite/pubg-sqlite.sqlite
  Command: cp pubg-sqlite.sqlite /DATA/AppData/openclaw/data/pubg.sqlite
  Verify: sqlite3 PRAGMA integrity_check + sha256 match

### Order 35 — changedetection-datastore (Product change monitoring)
  Source: service-aware backup / changedetection-datastore.tar.gz
  Command: tar -xzf changedetection-datastore.tar.gz -C /DATA/AppData/changedetection/
  Verify: curl http://127.0.0.1:<port>/health

### Order 40 — product-radar-sqlite (Product Radar monitor database)
  Source: service-aware backup / sqlite/product-radar-sqlite.sqlite
  Command: cp product-radar-sqlite.sqlite /DATA/AppData/product-radar/product-radar.sqlite
  Verify: sqlite3 PRAGMA integrity_check + sha256 match

### Order 45 — media-adapter-state (Media organizer state)
  Source: service-aware backup / media-adapter-state.tar.gz
  Command: tar -xzf media-adapter-state.tar.gz -C /DATA/AppData/media-organizer-adapter/
  Verify: curl /healthz on adapter container

### Order 50 — owner-outbox (OpenClaw owner notification queue)
  Source: service-aware backup / owner-outbox/
  Command: cp -r owner-outbox/ /DATA/AppData/openclaw/notifications/
  Verify: validate JSON contract on all .pending.json files (must not send during restore)

### Order 60 — vps-usage-state (VPS traffic baseline)
  Source: service-aware backup / vps-usage-state.json
  Command: cp vps-usage-state.json /DATA/AppData/openclaw/data/vps-usage-state.json
  Verify: python3 -c 'import json; json.load(open("/DATA/AppData/openclaw/data/vps-usage-state.json"))'

### Additional MIGRATE services (restore from explicit config archives)

  frpc: restore /DATA/AppData/frpc/frpc.toml from encrypted bundle; start compose.
        Verify: tunnel status check.
  
  xiaoya: restore to /DATA/AppData/xiaoya/ (NOT /home/nyannyan/xiaoya — legacy path).
          Archive must have been collected from source before cutover.
          Verify: HTTP health + mounted data read.
  
  emby: restore /DATA/AppData/emby/config; attach Avalon media mounts.
        Verify: health endpoint + library boundary.
  
  qbittorrent: restore /DATA/AppData/qbittorrent/config; attach downloads mount.
               Verify: web health + download path read.
  
  nginxproxymanager: restore /DATA/AppData/nginxproxymanager/data + certificates.
                     Verify: proxy health + TLS inventory.
  
  filebrowser: restore named volumes + /DATA/AppData/filebrowser/db.
               Verify: health + authenticated boundary.
  
  aria2: restore /DATA/AppData/aria2/config + encrypted RPC secret.
         Verify: RPC auth boundary + path read.
  
  jellyfin: restore /DATA/AppData/jellyfin/config; attach Avalon media.
            Verify: health + library path.
  
  alist: restore /DATA/AppData/alist/data; attach Avalon.
         Verify: health + storage mount read.
  
  v2raya: restore /DATA/AppData/v2raya.
          Verify: HTTP health + config parse.

### REBUILD services (no restore needed)

  homarr: recreate from compose; optional dashboard data.
  ariang: recreate from image.
  xiaoyakeeper: recreate after Docker socket review.
  dashdot: recreate as read-only host metrics.
  fashion-siglip: install via scripts/install-fashion-siglip-macos.sh --apply; redownload model.

## Critical restore invariants

1. Each SQLite file passes PRAGMA integrity_check before service start.
2. Each database sha256 matches the manifest recorded during backup.
3. Owner outbox events are validated but NOT delivered during restore.
4. Immich PostgreSQL restore uses ONLY the latest pg_dump -Fc logical dump.
5. Avalon UUID matches /Volumes/Avalon/.amadeus-storage.json sentinel.
6. Source Mac remains running throughout; no source data is deleted.
7. SOURCE_FROZEN=NO, DESTINATION_MUTATED=NO until Phase 14 cutover window.

PLAN
}

plan_output="$(print_plan)"

if [[ -n "$OUTPUT_DIR" ]]; then
  mkdir -p "$OUTPUT_DIR"
  printf '%s\n' "$plan_output" > "$OUTPUT_DIR/homelab-clean-restore-plan.md"
  printf 'PLAN_FILE=%s/homelab-clean-restore-plan.md\n' "$OUTPUT_DIR"
else
  printf '%s\n' "$plan_output"
fi

printf 'DESTINATION_MACHINE=%s\n' "$DEST_MACHINE"
printf 'CLEAN_RESTORE_INDEPENDENT_OF_GUEST_SNAPSHOT=yes\n'
printf 'HOMELAB_CLEAN_RESTORE_PLAN=ready\n'
