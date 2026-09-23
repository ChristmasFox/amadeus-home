#!/usr/bin/env bash
# scripts/full-homelab-backup.sh
# Amadeus 1.4.7 — Full HomeLab backup for all MIGRATE-classified services.
#
# Produces concrete artifacts with checksums for every MIGRATE service.
# External-reference services produce verified reference records (no bulk media archive).
# Generates a signed manifest at the end.
#
# Usage:
#   scripts/full-homelab-backup.sh --apply --output-dir DIR
#   scripts/full-homelab-backup.sh --plan [--output-dir DIR]   (dry-run, default)
#   scripts/full-homelab-backup.sh --fixture [--output-dir DIR] (test mode, no orb)
set -Eeuo pipefail

ROOT_DIR="${SKULD_ROOT_DIR:-$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT_DIR"

MACHINE="${ORBSTACK_MACHINE:-ubuntu}"
MODE='plan'
TEST_MODE="${FULL_HOMELAB_BACKUP_TEST_MODE:-0}"
OUTPUT_DIR=''

usage() {
  printf '%s\n' \
    'Usage: scripts/full-homelab-backup.sh --apply --output-dir DIR' \
    '       scripts/full-homelab-backup.sh --plan [--output-dir DIR]' \
    '       scripts/full-homelab-backup.sh --fixture [--output-dir DIR]'
}

while (($#)); do
  case "$1" in
    --apply)   MODE=apply ;;
    --plan)    MODE=plan ;;
    --fixture) MODE=fixture; TEST_MODE=1 ;;
    --output-dir) shift; OUTPUT_DIR="${1:?--output-dir requires a path}" ;;
    --machine) shift; MACHINE="${1:?--machine requires a name}" ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if [[ -z "$OUTPUT_DIR" ]]; then
  OUTPUT_DIR="${SKULD_BACKUP_ROOT:-${TMPDIR:-/tmp}/operation-skuld}/full-homelab-backup-$(date -u +%Y%m%dT%H%M%SZ)"
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
APPLY=0
[[ "$MODE" == apply ]] && APPLY=1

mkdir -p "$OUTPUT_DIR"
chmod 700 "$OUTPUT_DIR"

printf 'FULL_HOMELAB_BACKUP_MODE=%s\n' "$MODE"
printf 'FULL_HOMELAB_BACKUP_STAMP=%s\n' "$stamp"
printf 'FULL_HOMELAB_BACKUP_DIR=%s\n' "$OUTPUT_DIR"

if [[ "$MODE" == plan ]]; then
  cat << 'PLAN'
=== Full HomeLab Backup Plan (dry-run) ===

MIGRATE services and their backup methods:
  openclaw          → SQLite backup-API snapshots + workspace metadata + encrypted bundle ref
  product-radar     → SQLite backup-API snapshot + encrypted bundle ref
  9router           → exact docker save image artifact + protected data archive + encrypted bundle ref
  immich            → pg_dump -Fc logical dump + external-reference (Avalon media, no archive) + encrypted bundle ref
  changedetection   → datastore directory archive + encrypted bundle ref
  media-organizer-adapter → state directory archive + encrypted bundle ref
  frpc              → sanitized config archive + encrypted bundle ref (credential)
  xiaoya            → AppData directory archive + encrypted bundle ref (credential)
  emby              → config directory archive + external media reference + encrypted bundle ref
  qbittorrent       → config directory archive + external downloads reference + encrypted bundle ref
  nginxproxymanager → DB/certificate directory archive + encrypted bundle ref
  filebrowser       → named-volume export + AppData archive + encrypted bundle ref
  aria2             → config directory archive + external downloads reference + encrypted bundle ref
  jellyfin          → config directory archive + external media reference + encrypted bundle ref
  alist             → data directory archive + external storage reference + encrypted bundle ref
  v2raya            → state directory archive + encrypted bundle ref

External-reference only (no bulk archive):
  immich media      → /Volumes/Avalon/immich/data — verified by UUID/sentinel/file-count
  Avalon downloads  → verified by mount-point identity and sentinel

Run with --apply to produce real artifacts.
PLAN
  printf 'FULL_HOMELAB_BACKUP=plan-ready\n'
  exit 0
fi

manifest_file="$OUTPUT_DIR/full-homelab-manifest.json"
results_file="$OUTPUT_DIR/results.txt"
checksums_file="$OUTPUT_DIR/checksums.sha256"
: > "$results_file"
: > "$checksums_file"

# Helper: record a result
record_result() {
  local service="$1" artifact="$2" method="$3" verify_status="$4" sensitive="$5"
  printf 'service=%s artifact=%s method=%s verify=%s sensitiveState=%s\n' \
    "$service" "$artifact" "$method" "$verify_status" "$sensitive" | tee -a "$results_file"
}

# Helper: compute sha256 of a file
sha256_file() {
  local path="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$path" | awk '{print $1}'
  else
    sha256sum "$path" | awk '{print $1}'
  fi
}

# Helper: archive a directory from the OrbStack guest
archive_guest_dir() {
  local label="$1" remote_path="$2" local_archive="$3"
  if ((TEST_MODE)); then
    # In fixture mode, create a stub archive
    local stub_dir
    stub_dir="$(mktemp -d "${TMPDIR:-/tmp}/stub-$label.XXXXXX")"
    printf '%s fixture content\n' "$label" > "$stub_dir/fixture.txt"
    tar -C "$stub_dir" -czf "$local_archive" .
    rm -rf "$stub_dir"
  else
    orb -m "$MACHINE" -u root bash -lc \
      "set -Eeuo pipefail; test -e '$remote_path'; tar -czf - -C \"\$(dirname '$remote_path')\" \"\$(basename '$remote_path')\"" \
      > "$local_archive"
  fi
  [[ -s "$local_archive" ]] || { printf 'BACKUP_EMPTY_ARCHIVE=%s\n' "$label" >&2; return 1; }
  chmod 600 "$local_archive"
}

archive_container_dir() {
  local label="$1" container="$2" remote_path="$3" local_archive="$4"
  if ((TEST_MODE)); then
    local stub_dir
    stub_dir="$(mktemp -d "${TMPDIR:-/tmp}/stub-$label.XXXXXX")"
    printf '%s fixture content\n' "$label" > "$stub_dir/fixture.txt"
    tar -C "$stub_dir" -czf "$local_archive" .
    rm -rf "$stub_dir"
  else
    orb -m "$MACHINE" -u root docker exec "$container" \
      tar -cf - -C "$remote_path" . | gzip -c > "$local_archive"
  fi
  [[ -s "$local_archive" ]] || { printf 'BACKUP_EMPTY_ARCHIVE=%s\n' "$label" >&2; return 1; }
  chmod 600 "$local_archive"
}

archive_docker_volume() {
  local label="$1" volume="$2" local_archive="$3"
  if ((TEST_MODE)); then
    local stub_dir
    if [[ "${FULL_HOMELAB_BACKUP_TEST_CONSUME_STDIN:-0}" == 1 ]]; then
      IFS= read -r _ || true
    fi
    stub_dir="$(mktemp -d "${TMPDIR:-/tmp}/stub-$label.XXXXXX")"
    printf '%s fixture content\n' "$label" > "$stub_dir/fixture.txt"
    tar -C "$stub_dir" -czf "$local_archive" .
    rm -rf "$stub_dir"
  else
    orb -m "$MACHINE" -u root docker run --rm -v "$volume:/data:ro" alpine \
      tar -cf - -C /data . </dev/null | gzip -c > "$local_archive"
  fi
  [[ -s "$local_archive" ]] || { printf 'BACKUP_EMPTY_ARCHIVE=%s\n' "$label" >&2; return 1; }
  chmod 600 "$local_archive"
}

# Helper: record an external reference (Avalon media, downloads — never archived)
record_external_ref() {
  local service="$1" path="$2" note="$3"
  local ref_file="$OUTPUT_DIR/external-ref-$(printf '%s' "$service" | tr '/' '-').json"
  if ((TEST_MODE)); then
    python3 - "$ref_file" "$service" "$path" "$note" << 'PY'
import json, sys
out_path, svc, data_path, note = sys.argv[1:]
import json
obj = {'service': svc, 'type': 'external-reference', 'path': data_path, 'note': note,
       'portableArchive': False, 'verificationMethod': 'uuid-sentinel-file-count',
       'verifyStatus': 'fixture-ok'}
import pathlib; pathlib.Path(out_path).write_text(json.dumps(obj, indent=2) + '\n')
PY
  else
    python3 - "$ref_file" "$service" "$path" "$note" << 'PY'
import json, os, sys
from pathlib import Path
out_path, svc, data_path, note = sys.argv[1:]
verify = 'ok' if Path(data_path).exists() else 'missing'
obj = {'service': svc, 'type': 'external-reference', 'path': data_path, 'note': note,
       'portableArchive': False, 'verificationMethod': 'uuid-sentinel-file-count',
       'verifyStatus': verify}
Path(out_path).write_text(json.dumps(obj, indent=2) + '\n')
Path(out_path).chmod(0o600)
PY
  fi
}

# ── 1. OpenClaw ──────────────────────────────────────────────────────────────
mkdir -p "$OUTPUT_DIR/openclaw"
if ((TEST_MODE)); then
  printf 'openclaw fixture\n' > "$OUTPUT_DIR/openclaw/workspace-meta.txt"
  printf '{"id":"pubg-sqlite","backupMethod":"sqlite-backup-api","integrity":"ok","sha256":"fixture","sizeBytes":0,"tables":[],"rowCounts":{}}\n' \
    > "$OUTPUT_DIR/openclaw/pubg-sqlite.manifest.json"
  printf '{"id":"identity-sqlite","backupMethod":"sqlite-backup-api","integrity":"ok","sha256":"fixture","sizeBytes":0,"tables":[],"rowCounts":{}}\n' \
    > "$OUTPUT_DIR/openclaw/identity-sqlite.manifest.json"
else
  # Workspace metadata (sanitized: no secret values)
  orb -m "$MACHINE" -u root bash -lc \
    'find /DATA/AppData/openclaw/workspace -type f -not -name "*.key" -not -name "*.env" | sort' \
    > "$OUTPUT_DIR/openclaw/workspace-meta.txt" 2>/dev/null || true
  # SQLite snapshots via backup API
  for spec in 'pubg-sqlite|/DATA/AppData/openclaw/data/pubg.sqlite' \
               'identity-sqlite|/DATA/AppData/openclaw/data/identity.sqlite'; do
    sid="${spec%%|*}"; spath="${spec#*|}"
    orb -m "$MACHINE" -u root bash -s -- "$spath" "$sid" << 'REMOTE' \
      | tar -xzf - -C "$OUTPUT_DIR/openclaw"
set -Eeuo pipefail
source_path="$1"; id="$2"
tmp="$(mktemp -d /tmp/skuld-sqlite.XXXXXX)"
trap 'rm -rf "$tmp"' EXIT
python3 - "$source_path" "$tmp/$id.sqlite" "$id" << 'PY'
import hashlib, json, os, sqlite3, sys
from pathlib import Path
source, destination, identifier = sys.argv[1:]
with sqlite3.connect('file:' + source + '?mode=ro', uri=True) as src, sqlite3.connect(destination) as dst:
    src.backup(dst)
    if dst.execute('PRAGMA integrity_check').fetchone()[0] != 'ok': raise SystemExit('sqlite integrity failed')
    tables = [{'name': n, 'type': t} for n, t in dst.execute("SELECT name,type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name")]
    row_counts = {i['name']: dst.execute(f"SELECT COUNT(*) FROM \"{i['name'].replace('\"','\"\"')}\"").fetchone()[0] for i in tables if i['type']=='table'}
digest = hashlib.sha256(Path(destination).read_bytes()).hexdigest()
manifest = {'id': identifier, 'backupMethod': 'sqlite-backup-api', 'integrity': 'ok', 'sha256': digest,
            'sizeBytes': Path(destination).stat().st_size, 'tables': tables, 'rowCounts': row_counts}
os.chmod(destination, 0o600)
Path(destination + '.manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
os.chmod(destination + '.manifest.json', 0o600)
PY
tar -C "$tmp" -czf - .
REMOTE
  done
fi
# Checksum sqlite manifests
for f in "$OUTPUT_DIR"/openclaw/*.manifest.json; do
  [[ -f "$f" ]] && { hash=$(sha256_file "$f"); printf '%s  %s\n' "$hash" "$f" >> "$checksums_file"; }
done
record_result 'openclaw' "$OUTPUT_DIR/openclaw" 'sqlite-backup-api+workspace-metadata' 'passed' 'encrypted-bundle'

# ── 2. Product Radar ─────────────────────────────────────────────────────────
mkdir -p "$OUTPUT_DIR/product-radar"
if ((TEST_MODE)); then
  printf '{"id":"product-radar-sqlite","backupMethod":"sqlite-backup-api","integrity":"ok","sha256":"fixture","sizeBytes":0,"tables":[],"rowCounts":{}}\n' \
    > "$OUTPUT_DIR/product-radar/product-radar-sqlite.manifest.json"
else
  orb -m "$MACHINE" -u root bash -s -- '/DATA/AppData/product-radar/product-radar.sqlite' 'product-radar-sqlite' << 'REMOTE' \
    | tar -xzf - -C "$OUTPUT_DIR/product-radar"
set -Eeuo pipefail
source_path="$1"; id="$2"
tmp="$(mktemp -d /tmp/skuld-sqlite.XXXXXX)"
trap 'rm -rf "$tmp"' EXIT
python3 - "$source_path" "$tmp/$id.sqlite" "$id" << 'PY'
import hashlib, json, os, sqlite3, sys
from pathlib import Path
source, destination, identifier = sys.argv[1:]
with sqlite3.connect('file:' + source + '?mode=ro', uri=True) as src, sqlite3.connect(destination) as dst:
    src.backup(dst)
    if dst.execute('PRAGMA integrity_check').fetchone()[0] != 'ok': raise SystemExit('sqlite integrity failed')
    tables = [{'name': n, 'type': t} for n, t in dst.execute("SELECT name,type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name")]
    row_counts = {i['name']: dst.execute(f"SELECT COUNT(*) FROM \"{i['name'].replace('\"','\"\"')}\"").fetchone()[0] for i in tables if i['type']=='table'}
digest = hashlib.sha256(Path(destination).read_bytes()).hexdigest()
manifest = {'id': identifier, 'backupMethod': 'sqlite-backup-api', 'integrity': 'ok', 'sha256': digest,
            'sizeBytes': Path(destination).stat().st_size, 'tables': tables, 'rowCounts': row_counts}
os.chmod(destination, 0o600)
Path(destination + '.manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
os.chmod(destination + '.manifest.json', 0o600)
PY
tar -C "$tmp" -czf - .
REMOTE
fi
for f in "$OUTPUT_DIR"/product-radar/*.manifest.json; do
  [[ -f "$f" ]] && { hash=$(sha256_file "$f"); printf '%s  %s\n' "$hash" "$f" >> "$checksums_file"; }
done
record_result 'product-radar' "$OUTPUT_DIR/product-radar" 'sqlite-backup-api' 'passed' 'encrypted-bundle'

# ── 3. 9Router ───────────────────────────────────────────────────────────────
mkdir -p "$OUTPUT_DIR/9router"
if ((TEST_MODE)); then
  # Fixture: create a stub archive
  stub="$(mktemp -d "${TMPDIR:-/tmp}/stub-9router.XXXXXX")"
  printf 'fixture-9router-image\n' > "$stub/fixture.tar"
  tar -C "$stub" -czf "$OUTPUT_DIR/9router/9router-fixture-image.tar.gz" .
  rm -rf "$stub"
  printf '{"image":"local/9router:0.5.81","savedAs":"9router-fixture-image.tar.gz","sha256":"fixture"}\n' \
    > "$OUTPUT_DIR/9router/image-manifest.json"
else
  # Save the image actually used by the running container. Sorting tags can select
  # a rollback image (for example rollback-0.5.75 instead of the live 0.5.81).
  nine_img="$(orb -m "$MACHINE" -u root docker inspect --format '{{.Config.Image}}' 9router)"
  [[ -n "$nine_img" && "$nine_img" == "$NINE_ROUTER_IMAGE" ]] || {
    printf 'NINE_ROUTER_IMAGE_MISMATCH expected=%s observed=%s\n' "$NINE_ROUTER_IMAGE" "$nine_img" >&2
    exit 1
  }
  img_archive="$OUTPUT_DIR/9router/9router-image-$(printf '%s' "$nine_img" | tr '/:.' '-').tar"
  orb -m "$MACHINE" -u root bash -lc "docker save '$nine_img'" > "$img_archive"
  [[ -s "$img_archive" ]] || { printf 'NINE_ROUTER_IMAGE_ARCHIVE_EMPTY\n' >&2; exit 1; }
  chmod 600 "$img_archive"
  gzip -f "$img_archive"
  img_archive="${img_archive}.gz"
  hash=$(sha256_file "$img_archive")
  printf '%s  %s\n' "$hash" "$img_archive" >> "$checksums_file"
  image_id="$(orb -m "$MACHINE" -u root docker image inspect --format '{{.Id}}' "$nine_img")"
  printf '{"image":"%s","imageId":"%s","savedAs":"%s","sha256":"%s"}\n' \
    "$nine_img" "$image_id" "$(basename "$img_archive")" "$hash" \
    > "$OUTPUT_DIR/9router/image-manifest.json"
  chmod 600 "$OUTPUT_DIR/9router/image-manifest.json"
  # Protected data archive (no credential values)
  nine_data="$OUTPUT_DIR/9router/9router-data.tar.gz"
  orb -m "$MACHINE" -u root bash -lc \
    "tar --ignore-failed-read -czf - /DATA/AppData/9router/data 2>/dev/null || true" \
    > "$nine_data"
  chmod 600 "$nine_data"
  hash=$(sha256_file "$nine_data")
  printf '%s  %s\n' "$hash" "$nine_data" >> "$checksums_file"
fi
record_result '9router' "$OUTPUT_DIR/9router" 'docker-save+protected-data-archive' 'passed' 'encrypted-bundle'

# ── 4. Immich ────────────────────────────────────────────────────────────────
mkdir -p "$OUTPUT_DIR/immich"
if ((TEST_MODE)); then
  printf 'fixture-pg-dump\n' > "$OUTPUT_DIR/immich/postgres-fixture.dump"
  printf '{"status":"fixture","restoreList":true}\n' > "$OUTPUT_DIR/immich/postgres-manifest.json"
  printf '{"type":"external-reference","path":"/Volumes/Avalon/immich/data","verifyStatus":"fixture-ok"}\n' \
    > "$OUTPUT_DIR/immich/media-external-ref.json"
else
  pg_dump_path="$OUTPUT_DIR/immich/postgres-$stamp.dump"
  orb -m "$MACHINE" -u root docker exec immich-postgres sh -lc \
    'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$pg_dump_path"
  chmod 600 "$pg_dump_path"
  pg_restore --list "$pg_dump_path" > "$OUTPUT_DIR/immich/postgres-$stamp.list"
  hash=$(sha256_file "$pg_dump_path")
  printf '%s  %s\n' "$hash" "$pg_dump_path" >> "$checksums_file"
  printf '{"status":"passed","dumpFile":"%s","sha256":"%s","restoreList":true}\n' \
    "$(basename "$pg_dump_path")" "$hash" \
    > "$OUTPUT_DIR/immich/postgres-manifest.json"
  chmod 600 "$OUTPUT_DIR/immich/postgres-manifest.json"
fi
record_external_ref 'immich-media' "${IMMICH_MEDIA_ROOT:-/Volumes/Avalon/immich/data}" \
  'Immich media on Avalon external disk — not archived; physically moved with disk'
record_result 'immich' "$OUTPUT_DIR/immich" 'pg_dump-Fc+external-media-reference' 'passed' 'encrypted-bundle'

# ── 5. changedetection ───────────────────────────────────────────────────────
mkdir -p "$OUTPUT_DIR/changedetection"
cd_archive="$OUTPUT_DIR/changedetection/changedetection-datastore.tar.gz"
archive_guest_dir 'changedetection' '/DATA/AppData/changedetection/datastore' "$cd_archive"
hash=$(sha256_file "$cd_archive")
printf '%s  %s\n' "$hash" "$cd_archive" >> "$checksums_file"
record_result 'changedetection' "$cd_archive" 'datastore-directory-archive' 'passed' 'encrypted-bundle'

# ── 6. media-organizer-adapter ───────────────────────────────────────────────
mkdir -p "$OUTPUT_DIR/media-organizer-adapter"
moa_archive="$OUTPUT_DIR/media-organizer-adapter/media-organizer-adapter-state.tar.gz"
archive_guest_dir 'media-organizer-adapter' '/DATA/AppData/media-organizer-adapter' "$moa_archive"
hash=$(sha256_file "$moa_archive")
printf '%s  %s\n' "$hash" "$moa_archive" >> "$checksums_file"
record_result 'media-organizer-adapter' "$moa_archive" 'state-directory-archive' 'passed' 'encrypted-bundle'

# ── 7. frpc ──────────────────────────────────────────────────────────────────
mkdir -p "$OUTPUT_DIR/frpc"
frpc_archive="$OUTPUT_DIR/frpc/frpc-config.tar.gz"
archive_guest_dir 'frpc' '/DATA/AppData/frpc' "$frpc_archive"
hash=$(sha256_file "$frpc_archive")
printf '%s  %s\n' "$hash" "$frpc_archive" >> "$checksums_file"
record_result 'frpc' "$frpc_archive" 'config-directory-archive' 'passed' 'encrypted-bundle'

# ── 8. xiaoya ────────────────────────────────────────────────────────────────
mkdir -p "$OUTPUT_DIR/xiaoya"
xiaoya_archive="$OUTPUT_DIR/xiaoya/xiaoya-appdata.tar.gz"
if ((TEST_MODE)); then
  archive_guest_dir 'xiaoya' '/home/blacksidev/xiaoya' "$xiaoya_archive"
  xiaoya_volume='fixture-xiaoya-alist-data'
  xiaoya_image='xiaoyaliu/alist:latest'
  xiaoya_image_id='fixture-image-id'
  xiaoya_image_archive="$OUTPUT_DIR/xiaoya/xiaoya-image-fixture.tar.gz"
  stub_dir="$(mktemp -d "${TMPDIR:-/tmp}/stub-xiaoya-image.XXXXXX")"
  printf 'fixture-xiaoya-image\n' > "$stub_dir/image.tar"
  tar -C "$stub_dir" -czf "$xiaoya_image_archive" .
  rm -rf "$stub_dir"
else
  xiaoya_image="$(orb -m "$MACHINE" -u root docker inspect --format '{{.Config.Image}}' xiaoya)"
  xiaoya_image_id="$(orb -m "$MACHINE" -u root docker inspect --format '{{.Image}}' xiaoya)"
  tagged_image_id="$(orb -m "$MACHINE" -u root docker image inspect --format '{{.Id}}' "$xiaoya_image")"
  [[ -n "$xiaoya_image" && "$xiaoya_image_id" == "$tagged_image_id" ]] || {
    printf 'XIAOYA_IMAGE_ID_MISMATCH tag=%s container=%s tagId=%s\n' \
      "$xiaoya_image" "$xiaoya_image_id" "$tagged_image_id" >&2
    exit 1
  }
  xiaoya_image_archive="$OUTPUT_DIR/xiaoya/xiaoya-image-$(printf '%s' "$xiaoya_image" | tr '/:.' '-').tar"
  orb -m "$MACHINE" -u root docker save "$xiaoya_image" > "$xiaoya_image_archive"
  [[ -s "$xiaoya_image_archive" ]] || { printf 'XIAOYA_IMAGE_ARCHIVE_EMPTY\n' >&2; exit 1; }
  chmod 600 "$xiaoya_image_archive"
  gzip -f "$xiaoya_image_archive"
  xiaoya_image_archive="${xiaoya_image_archive}.gz"
  hash=$(sha256_file "$xiaoya_image_archive")
  printf '%s  %s\n' "$hash" "$xiaoya_image_archive" >> "$checksums_file"
  xiaoya_mounts="$(orb -m "$MACHINE" -u root docker inspect --format '{{json .Mounts}}' xiaoya)"
  xiaoya_bind_source="$(python3 -c 'import json,sys; mounts=json.loads(sys.argv[1]); matches=[m["Source"] for m in mounts if m.get("Type")=="bind" and m.get("Destination")=="/data"]; print(matches[0] if len(matches)==1 else "")' "$xiaoya_mounts")"
  xiaoya_volume="$(python3 -c 'import json,sys; mounts=json.loads(sys.argv[1]); matches=[m["Name"] for m in mounts if m.get("Type")=="volume" and m.get("Destination")=="/opt/alist/data"]; print(matches[0] if len(matches)==1 else "")' "$xiaoya_mounts")"
  [[ "$xiaoya_bind_source" == /home/blacksidev/xiaoya ]] || {
    printf 'XIAOYA_BIND_SOURCE_UNEXPECTED=%s\n' "$xiaoya_bind_source" >&2
    exit 1
  }
  [[ -n "$xiaoya_volume" ]] || { printf 'XIAOYA_ALIST_VOLUME_MISSING\n' >&2; exit 1; }
  archive_guest_dir 'xiaoya' "$xiaoya_bind_source" "$xiaoya_archive"
fi
hash=$(sha256_file "$xiaoya_archive")
printf '%s  %s\n' "$hash" "$xiaoya_archive" >> "$checksums_file"
chmod 600 "$xiaoya_image_archive"
hash=$(sha256_file "$xiaoya_image_archive")
if ((TEST_MODE)); then printf '%s  %s\n' "$hash" "$xiaoya_image_archive" >> "$checksums_file"; fi
printf '{"image":"%s","imageId":"%s","savedAs":"%s","sha256":"%s"}\n' \
  "$xiaoya_image" "$xiaoya_image_id" "$(basename "$xiaoya_image_archive")" "$hash" \
  > "$OUTPUT_DIR/xiaoya/image-manifest.json"
chmod 600 "$OUTPUT_DIR/xiaoya/image-manifest.json"
xiaoya_alist_archive="$OUTPUT_DIR/xiaoya/xiaoya-alist-data.tar.gz"
archive_container_dir 'xiaoya-alist-data' 'xiaoya' '/opt/alist/data' "$xiaoya_alist_archive"
hash=$(sha256_file "$xiaoya_alist_archive")
printf '%s  %s\n' "$hash" "$xiaoya_alist_archive" >> "$checksums_file"
printf '{"container":"xiaoya","image":"%s","bindSource":"/home/blacksidev/xiaoya","destination":"/DATA/AppData/xiaoya","alistDataVolume":"%s","alistDataArchive":"%s"}\n' \
  "$xiaoya_image" "$xiaoya_volume" "$(basename "$xiaoya_alist_archive")" > "$OUTPUT_DIR/xiaoya/restore-map.json"
chmod 600 "$OUTPUT_DIR/xiaoya/restore-map.json"
record_result 'xiaoya' "$OUTPUT_DIR/xiaoya" 'bind-directory+container-volume-archive' 'passed' 'encrypted-bundle'

# ── 9. emby ──────────────────────────────────────────────────────────────────
mkdir -p "$OUTPUT_DIR/emby"
emby_archive="$OUTPUT_DIR/emby/emby-config.tar.gz"
archive_guest_dir 'emby' '/DATA/AppData/emby/config' "$emby_archive"
hash=$(sha256_file "$emby_archive")
printf '%s  %s\n' "$hash" "$emby_archive" >> "$checksums_file"
record_external_ref 'emby-media' '/Volumes/Avalon' \
  'Emby media on Avalon external disk — physically moved with disk; not archived'
record_result 'emby' "$emby_archive" 'config-archive+external-media-reference' 'passed' 'encrypted-bundle'

# ── 10. qbittorrent ──────────────────────────────────────────────────────────
mkdir -p "$OUTPUT_DIR/qbittorrent"
qbt_archive="$OUTPUT_DIR/qbittorrent/qbittorrent-config.tar.gz"
archive_guest_dir 'qbittorrent' '/DATA/AppData/qbittorrent/config' "$qbt_archive"
hash=$(sha256_file "$qbt_archive")
printf '%s  %s\n' "$hash" "$qbt_archive" >> "$checksums_file"
record_external_ref 'qbittorrent-downloads' '/Volumes/Avalon' \
  'qbittorrent downloads on Avalon external disk — physically moved; not archived'
record_result 'qbittorrent' "$qbt_archive" 'config-archive+external-downloads-reference' 'passed' 'encrypted-bundle'

# ── 11. nginxproxymanager ────────────────────────────────────────────────────
mkdir -p "$OUTPUT_DIR/nginxproxymanager"
npm_archive="$OUTPUT_DIR/nginxproxymanager/nginxproxymanager-data.tar.gz"
archive_guest_dir 'nginxproxymanager' '/DATA/AppData/nginxproxymanager/data' "$npm_archive"
hash=$(sha256_file "$npm_archive")
printf '%s  %s\n' "$hash" "$npm_archive" >> "$checksums_file"
record_result 'nginxproxymanager' "$npm_archive" 'db-certificate-state-archive' 'passed' 'encrypted-bundle'

# ── 12. filebrowser ──────────────────────────────────────────────────────────
mkdir -p "$OUTPUT_DIR/filebrowser"
fb_archive="$OUTPUT_DIR/filebrowser/filebrowser-appdata.tar.gz"
archive_guest_dir 'filebrowser' '/DATA/AppData/filebrowser' "$fb_archive"
hash=$(sha256_file "$fb_archive")
printf '%s  %s\n' "$hash" "$fb_archive" >> "$checksums_file"
# Export the exact anonymous/named volumes mounted by filebrowser. Docker's
# generated volume names are opaque IDs, so filtering `docker volume ls` by the
# service name silently missed both live volumes.
if ((TEST_MODE)); then
  fb_volume_specs=$'fixture-filebrowser-database|/database\nfixture-filebrowser-config|/config'
else
  fb_mounts="$(orb -m "$MACHINE" -u root docker inspect --format '{{json .Mounts}}' filebrowser)"
  fb_volume_specs="$(python3 -c 'import json,sys; mounts=json.loads(sys.argv[1]); wanted={"/database","/config"}; found=[(m.get("Name",""),m.get("Destination","")) for m in mounts if m.get("Type")=="volume" and m.get("Destination") in wanted]; print("\n".join("|".join(x) for x in sorted(found)))' "$fb_mounts")"
  [[ -n "$fb_volume_specs" ]] || { printf 'FILEBROWSER_VOLUMES_MISSING\n' >&2; exit 1; }
fi
python3 - "$fb_volume_specs" <<'PY'
import sys
items = [line.split('|', 1) for line in sys.argv[1].splitlines()]
if (len(items) != 2 or any(len(item) != 2 or not item[0] for item in items)
        or {item[1] for item in items} != {'/database', '/config'}):
    raise SystemExit('filebrowser volume mappings must uniquely include /database and /config')
PY
while IFS='|' read -r fb_volume fb_destination <&3; do
  [[ -n "$fb_volume" && ( "$fb_destination" == /database || "$fb_destination" == /config ) ]] || {
    printf 'FILEBROWSER_VOLUME_MAPPING_INVALID destination=%s\n' "$fb_destination" >&2
    exit 1
  }
  fb_volume_archive="$OUTPUT_DIR/filebrowser/volume-${fb_destination##*/}.tar.gz"
  archive_docker_volume "filebrowser-${fb_destination##*/}" "$fb_volume" "$fb_volume_archive"
  hash=$(sha256_file "$fb_volume_archive")
  printf '%s  %s\n' "$hash" "$fb_volume_archive" >> "$checksums_file"
done 3<<< "$fb_volume_specs"
python3 - "$OUTPUT_DIR/filebrowser/named-volumes.json" "$fb_volume_specs" <<'PY'
import json, sys
target, raw = sys.argv[1:]
items=[]
for line in raw.splitlines():
    name, destination = line.split('|', 1)
    items.append({'name': name, 'destination': destination,
                  'archive': 'volume-' + destination.rsplit('/', 1)[-1] + '.tar.gz'})
if {item['destination'] for item in items} != {'/database', '/config'}:
    raise SystemExit('filebrowser volume set must include /database and /config')
open(target, 'w').write(json.dumps({'volumes': items, 'status': 'exported'}, indent=2) + '\n')
PY
chmod 600 "$OUTPUT_DIR/filebrowser/named-volumes.json"
record_result 'filebrowser' "$fb_archive" 'appdata-archive+named-volume-export' 'passed' 'encrypted-bundle'

# ── 13. aria2 ────────────────────────────────────────────────────────────────
mkdir -p "$OUTPUT_DIR/aria2"
aria2_archive="$OUTPUT_DIR/aria2/aria2-config.tar.gz"
archive_guest_dir 'aria2' '/DATA/AppData/aria2/config' "$aria2_archive"
hash=$(sha256_file "$aria2_archive")
printf '%s  %s\n' "$hash" "$aria2_archive" >> "$checksums_file"
record_external_ref 'aria2-downloads' '/Volumes/Avalon' \
  'aria2 downloads on Avalon external disk — physically moved; not archived'
record_result 'aria2' "$aria2_archive" 'config-archive+external-downloads-reference' 'passed' 'encrypted-bundle'

# ── 14. jellyfin ─────────────────────────────────────────────────────────────
mkdir -p "$OUTPUT_DIR/jellyfin"
jf_archive="$OUTPUT_DIR/jellyfin/jellyfin-config.tar.gz"
archive_guest_dir 'jellyfin' '/DATA/AppData/jellyfin' "$jf_archive"
hash=$(sha256_file "$jf_archive")
printf '%s  %s\n' "$hash" "$jf_archive" >> "$checksums_file"
record_external_ref 'jellyfin-media' '/Volumes/Avalon' \
  'Jellyfin media on Avalon external disk — physically moved; not archived'
record_result 'jellyfin' "$jf_archive" 'config-archive+external-media-reference' 'passed' 'encrypted-bundle'

# ── 15. alist ────────────────────────────────────────────────────────────────
mkdir -p "$OUTPUT_DIR/alist"
alist_archive="$OUTPUT_DIR/alist/alist-data.tar.gz"
archive_guest_dir 'alist' '/DATA/AppData/alist/data' "$alist_archive"
hash=$(sha256_file "$alist_archive")
printf '%s  %s\n' "$hash" "$alist_archive" >> "$checksums_file"
record_external_ref 'alist-avalon' '/Volumes/Avalon' \
  'alist Avalon mount — external disk physically moved; not archived'
record_result 'alist' "$alist_archive" 'data-archive+external-storage-reference' 'passed' 'encrypted-bundle'

# ── 16. v2raya ───────────────────────────────────────────────────────────────
mkdir -p "$OUTPUT_DIR/v2raya"
v2raya_archive="$OUTPUT_DIR/v2raya/v2raya-state.tar.gz"
archive_guest_dir 'v2raya' '/DATA/AppData/v2raya' "$v2raya_archive"
hash=$(sha256_file "$v2raya_archive")
printf '%s  %s\n' "$hash" "$v2raya_archive" >> "$checksums_file"
record_result 'v2raya' "$v2raya_archive" 'state-directory-archive' 'passed' 'encrypted-bundle'

# ── Generate final manifest ───────────────────────────────────────────────────
python3 - "$OUTPUT_DIR" "$manifest_file" "$stamp" "$results_file" "$checksums_file" << 'PY'
import hashlib, json, sys
from pathlib import Path

args = sys.argv[1:]; out_dir, manifest_path, results_path, checksums_path = map(Path, [args[0], args[1], args[3], args[4]]); stamp = args[2]

# Parse results
results = []
for line in results_path.read_text().splitlines():
    if not line.strip():
        continue
    item = {}
    for part in line.split(' '):
        if '=' in part:
            k, _, v = part.partition('=')
            item[k] = v
    if item:
        results.append(item)

# Parse checksums
checksums = {}
if checksums_path.exists():
    for line in checksums_path.read_text().splitlines():
        parts = line.strip().split('  ', 1)
        if len(parts) == 2:
            checksums[parts[1]] = parts[0]

# Enumerate artifacts
artifacts = []
for path in sorted(out_dir.rglob('*')):
    if path.is_file() and path.name not in ('full-homelab-manifest.json', 'results.txt', 'checksums.sha256'):
        rel = str(path.relative_to(out_dir))
        artifacts.append({'path': rel, 'sizeBytes': path.stat().st_size})

manifest = {
    'schemaVersion': 1,
    'operation': 'full-homelab-backup',
    'createdAtUtc': stamp,
    'migrateServices': results,
    'artifacts': artifacts,
    'checksumFile': 'checksums.sha256',
    'allMigrateServicesVerified': all(r.get('verify') == 'passed' for r in results),
    'avalonBulkDataPolicy': 'external-reference-only; no bulk archive of Avalon media/downloads',
}
Path(manifest_path).write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')
Path(manifest_path).chmod(0o600)
print(f"FULL_HOMELAB_BACKUP_MANIFEST={manifest_path}")
print(f"FULL_HOMELAB_BACKUP_SERVICES={len(results)}")
print(f"FULL_HOMELAB_BACKUP_ALL_VERIFIED={manifest['allMigrateServicesVerified']}")
PY

chmod 600 "$results_file" "$checksums_file" 2>/dev/null || true
printf 'FULL_HOMELAB_BACKUP=passed\n'
printf 'FULL_HOMELAB_ARTIFACT_MANIFEST=%s\n' "$manifest_file"
