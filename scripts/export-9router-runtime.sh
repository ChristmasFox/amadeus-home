#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${SKULD_ROOT_DIR:-$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT_DIR"
MACHINE="${ORBSTACK_MACHINE:-ubuntu}"
IMAGE="${NINE_ROUTER_IMAGE:-local/9router:0.5.81}"
APPLY=0

while (($#)); do
  case "$1" in
    --apply) APPLY=1 ;;
    --image) shift; IMAGE="${1:?--image requires a value}" ;;
    --help|-h) printf '%s\n' 'Usage: scripts/export-9router-runtime.sh [--apply] [--image IMAGE]'; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

image_id="$(orb -m "$MACHINE" -u root docker image inspect --format '{{.Id}}' "$IMAGE")"
version="${IMAGE##*:}"
target_root="${SKULD_BACKUP_ROOT:-/Volumes/Avalon/backups/operation-skuld}/9router"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
artifact="$target_root/9router-$version-$stamp.tar.gz"
printf 'NINE_ROUTER_IMAGE=%s\nNINE_ROUTER_IMAGE_ID=%s\nARTIFACT=%s\n' "$IMAGE" "$image_id" "$artifact"
if ((APPLY == 0)); then exit 0; fi
mkdir -p "$target_root"
chmod 700 "$target_root"
orb -m "$MACHINE" -u root docker save "$IMAGE" | gzip -c >"$artifact"
chmod 600 "$artifact"
sha256="$(shasum -a 256 "$artifact" | awk '{print $1}')"
python3 - "$target_root/runtime-manifest.json" "$IMAGE" "$image_id" "$version" "$artifact" "$sha256" <<'PY'
import json
import sys
from pathlib import Path

target, image, image_id, version, artifact, sha256 = sys.argv[1:]
Path(target).write_text(json.dumps({
    'schemaVersion': 1,
    'image': image,
    'imageId': image_id,
    'packageVersion': version,
    'artifact': artifact,
    'sha256': sha256,
    'contentsInGit': False,
}, indent=2) + '\n')
Path(target).chmod(0o600)
PY
printf 'NINE_ROUTER_ARTIFACT_SHA256=%s\n' "$sha256"
