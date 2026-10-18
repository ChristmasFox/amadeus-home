#!/usr/bin/env bash
# Downloads the official no-text map images used as the route-map background in the PUBG Intelligence Lab.
# The images are PUBG's own artwork (published in github.com/pubg/api-assets), so they are kept in a runtime directory
# outside Git instead of being committed. Each map is fetched from the 8192 px high-resolution asset (Git LFS, about
# 95 MB) and shrunk to a 3072 px JPEG (a few MB); if that fails the 819 px low-resolution PNG is kept as a fallback.
# Dry-run by default; pass --apply to download missing files.
set -euo pipefail

DIR="${PUBG_INTELLIGENCE_MAP_DIR:-$HOME/.local/share/amadeus/pubg-intelligence-lab/maps}"
BASE='https://raw.githubusercontent.com/pubg/api-assets/master/Assets/Maps'
LFS_BASE='https://media.githubusercontent.com/media/pubg/api-assets/master/Assets/Maps'
# telemetry map name -> official asset name
MAPS=(
  'Baltic_Main:Erangel_Main' 'Desert_Main:Miramar_Main' 'Tiger_Main:Taego_Main' 'Neon_Main:Rondo_Main'
  'DihorOtok_Main:Vikendi_Main' 'Savage_Main:Sanhok_Main' 'Kiki_Main:Deston_Main' 'Chimera_Main:Paramo_Main'
  'Summerland_Main:Karakin_Main' 'Heaven_Main:Haven_Main'
)
ONLY=()
APPLY=0
for argument in "$@"; do
  case "$argument" in
    --apply) APPLY=1 ;;
    --dry-run) APPLY=0 ;;
    --only=*) IFS=',' read -r -a ONLY <<< "${argument#--only=}" ;;
    *) echo "unknown argument: $argument" >&2; exit 2 ;;
  esac
done

wanted() {
  (( ${#ONLY[@]} == 0 )) && return 0
  local item
  for item in "${ONLY[@]}"; do [[ "$item" == "$1" ]] && return 0; done
  return 1
}

echo "PUBG_MAP_IMAGE_DIR=$DIR"
(( APPLY == 1 )) && mkdir -p "$DIR" && chmod 700 "$DIR"
for pair in "${MAPS[@]}"; do
  name="${pair%%:*}"
  asset="${pair##*:}"
  wanted "$name" || continue
  detail="$DIR/$name.jpg"
  low="$DIR/$name.png"
  if [[ -s "$detail" ]]; then echo "PUBG_MAP_IMAGE $name=present (detailed)"; continue; fi
  if (( APPLY == 0 )); then echo "PUBG_MAP_IMAGE $name=missing (would download ${asset}_No_Text_High_Res.png and shrink it to 3072 px)"; continue; fi
  tmp="$(mktemp "$DIR/.download.XXXXXX")"
  if curl -fsSL --max-time 600 -o "$tmp" "$LFS_BASE/${asset}_No_Text_High_Res.png" \
    && [[ "$(head -c 8 "$tmp" | xxd -p)" == 89504e470d0a1a0a ]] && (( $(stat -f %z "$tmp") > 5000000 )) \
    && sips -Z 3072 -s format jpeg -s formatOptions 70 "$tmp" --out "$tmp.jpg" >/dev/null 2>&1; then
    chmod 600 "$tmp.jpg"
    mv "$tmp.jpg" "$detail"
    rm -f "$tmp"
    echo "PUBG_MAP_IMAGE $name=downloaded (detailed)"
    continue
  fi
  rm -f "$tmp" "$tmp.jpg"
  echo "PUBG_MAP_IMAGE $name: detailed image unavailable, falling back to the low-resolution image" >&2
  if [[ -s "$low" ]]; then echo "PUBG_MAP_IMAGE $name=present (low resolution)"; continue; fi
  tmp="$(mktemp "$DIR/.download.XXXXXX")"
  if curl -fsSL --max-time 120 -o "$tmp" "$BASE/${asset}_No_Text_Low_Res.png" \
    && [[ "$(head -c 8 "$tmp" | xxd -p)" == 89504e470d0a1a0a ]] && (( $(stat -f %z "$tmp") > 200000 )); then
    chmod 600 "$tmp"
    mv "$tmp" "$low"
    echo "PUBG_MAP_IMAGE $name=downloaded (low resolution)"
  else
    rm -f "$tmp"
    echo "PUBG_MAP_IMAGE $name=failed" >&2
  fi
done
(( APPLY == 1 )) || echo 'Dry run only. Pass --apply to download the missing images.'
