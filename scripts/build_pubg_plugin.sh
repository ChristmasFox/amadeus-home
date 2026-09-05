#!/bin/sh
set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
output=${1:-integrations/langbot/build/pubg-stats-v2.lbpkg}
stage=$(mktemp -d "${TMPDIR:-/tmp}/pubg-plugin-v2.XXXXXX")
archive_stage=$(mktemp -d "${TMPDIR:-/tmp}/pubg-plugin-archive-v2.XXXXXX")
case "$output" in
  /*) output_path="$output" ;;
  *) output_path="$root_dir/$output" ;;
esac
output_dir=$(dirname "$output_path")
mkdir -p "$output_dir"
output_file="$output_dir/$(basename "$output")"
cp -R "$root_dir/integrations/langbot/plugins/pubg-stats-v2/." "$stage/"
cp -R "$root_dir/packages/pubg-domain/legacy-v2/pubg_query_engine_v2" "$stage/pubg_query_engine_v2"
find "$stage" -type d -name __pycache__ -prune -exec rm -rf {} +
find "$stage" -type f -name '*.pyc' -delete
(cd "$stage" && zip -qr "$archive_stage/pubg-stats-v2.lbpkg" . -x '*/__pycache__/*' -x '*.pyc')
mv "$archive_stage/pubg-stats-v2.lbpkg" "$output_file"
printf '%s\n' "$output_path"
