#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
repo="$(mktemp -d)"
defs="$(mktemp)"
cleanup() { rm -rf -- "$repo" "$defs"; }
trap cleanup EXIT

git -C "$repo" init -q
git -C "$repo" config user.email codex@example.invalid
git -C "$repo" config user.name codex
printf '1.9.9\n' > "$repo/VERSION"
git -C "$repo" add VERSION
git -C "$repo" commit -qm old-release
old_sha="$(git -C "$repo" rev-parse HEAD)"
git -C "$repo" checkout -q --orphan rewritten-main
git -C "$repo" rm -q -rf .
printf '1.10.4\n' > "$repo/VERSION"
git -C "$repo" add VERSION
git -C "$repo" commit -qm rewritten-release
# Remove the original branch/ref so the synthetic rewrite has no reachable
# predecessor before reflog expiry and object pruning.
git -C "$repo" for-each-ref --format='%(refname)' refs/heads | while IFS= read -r ref; do
  [[ "$ref" == refs/heads/rewritten-main ]] || git -C "$repo" update-ref -d "$ref"
done
git -C "$repo" reflog expire --expire=now --all
git -C "$repo" gc --prune=now --quiet
if git -C "$repo" cat-file -e "$old_sha^{commit}" 2>/dev/null; then
  echo 'synthetic rewrite retained the old commit unexpectedly' >&2
  exit 1
fi

# Load only the production freshness/version functions; the deployment
# entrypoint is never executed and no image/container is changed.
ROOT_DIR="$repo"
fail() { echo "$*" >&2; return 2; }
sed -n '/^image_source_commit()/,$p' "$SCRIPT_ROOT/scripts/deploy-openclaw.sh" | sed '/^while ((\$#)); do$/,$d' > "$defs"
source "$defs"

openclaw_image="local/openclaw-amadeus:git-${old_sha}-20260101000000"
radar_image="local/product-radar:git-${old_sha}-20260101000000"
[[ "$(image_source_commit "local/openclaw-amadeus:git-${old_sha}-202601010000")" == "$old_sha" ]]
image_needs_rebuild "$openclaw_image" openclaw
image_needs_rebuild "$radar_image" radar

# The bridge reads the protected live OpenClaw VERSION while both images are
# rebuilt. Stub only the read-only image resolver/orb response in this test.
MACHINE=synthetic
LINEAGE_BRIDGE=1
AMADEUS_VERSION=1.10.4
resolve_live_image() { printf '%s\n' "$openclaw_image"; }
orb() { printf '1.9.9\n'; }
release_output="$(assert_release_version_advanced)"
grep -Fxq 'LINEAGE_BRIDGE=validated' <<<"$release_output"
AMADEUS_VERSION=1.9.9
candidate_output="$(assert_candidate_version_unchanged)"
grep -Fxq 'LINEAGE_BRIDGE=validated' <<<"$candidate_output"

source_text="$(cat "$SCRIPT_ROOT/scripts/deploy-openclaw.sh")"
grep -Fq -- '--lineage-bridge requires fresh OpenClaw and Product Radar builds' <<<"$source_text"
grep -Fq 'BUILD_OPENCLAW == 1 && BUILD_RADAR == 1' <<<"$source_text"
printf '%s\n' 'OPENCLAW_DUAL_IMAGE_LINEAGE_TEST=passed'
