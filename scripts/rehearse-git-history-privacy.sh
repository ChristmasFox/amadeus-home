#!/usr/bin/env bash
# Offline Git history rewrite REHEARSAL ONLY. Never updates a remote.
set -Eeuo pipefail
if (( $# != 2 )); then
  echo 'Usage: rehearse-git-history-privacy.sh <verified-private-bundle> <private-exact-rules>' >&2
  exit 2
fi
BUNDLE="$(cd "$(dirname "$1")" && pwd -P)/$(basename "$1")"
RULES="$(cd "$(dirname "$2")" && pwd -P)/$(basename "$2")"
for path in "$BUNDLE" "$RULES"; do
  [[ -f "$path" && -r "$path" && ! -L "$path" ]] || { echo 'Missing/unreadable or symlink input.' >&2; exit 2; }
done
[[ "$BUNDLE" != "$RULES" && -s "$RULES" ]] || { echo 'Invalid or empty private input.' >&2; exit 2; }
command -v git >/dev/null && command -v python3 >/dev/null && git filter-repo --version >/dev/null 2>&1 || {
  echo 'Requires Git, Python3 and git-filter-repo (brew install git-filter-repo).' >&2; exit 2;
}
python3 - "$RULES" <<'PY'
import pathlib,sys
lines=[x for x in pathlib.Path(sys.argv[1]).read_bytes().splitlines() if x.strip() and not x.startswith(b'#')]
if not 1 <= len(lines) <= 100: raise SystemExit('Require 1–100 exact literal rules.')
for line in lines:
    if not line.startswith(b'literal:') or line.count(b'==>') != 1:
        raise SystemExit('Only literal:OLD==>NEW rules are allowed.')
    old,new=line[8:].split(b'==>',1)
    if len(old)<5 or len(old)>512 or not new or len(new)>512 or old==new:
        raise SystemExit('Invalid exact-match rule.')
PY
SOURCE="${AMADEUS_REWRITE_SOURCE_REPO:-$HOME/agent-monorepo}"
[[ -d "$SOURCE/.git" ]] || { echo 'Source Git checkout not found.' >&2; exit 2; }
git -C "$SOURCE" bundle verify "$BUNDLE" >/dev/null 2>&1 || {
  echo 'Bundle verification failed. No rewrite attempted.' >&2; exit 2;
}
umask 077
BASE="${AMADEUS_REWRITE_OUTPUT_DIR:-$HOME/Amadeus-private-backups/history-rewrite-rehearsal-$(date +%Y%m%d-%H%M%S)}"
[[ ! -e "$BASE" ]] || { echo 'Refusing to reuse existing private output directory.' >&2; exit 2; }
mkdir -p -m 700 "$BASE"
cp "$RULES" "$BASE/exact-replacements.private.txt"
chmod 600 "$BASE/exact-replacements.private.txt"
MIRROR="$BASE/rehearsal.git"
git clone --quiet --mirror "$BUNDLE" "$MIRROR"
git --git-dir="$MIRROR" remote remove origin >/dev/null 2>&1 || true
[[ -z "$(git --git-dir="$MIRROR" remote)" ]] || { echo 'Unexpected Git remote; aborting.' >&2; exit 1; }
git --git-dir="$MIRROR" rev-parse --verify refs/heads/main >/dev/null
git --git-dir="$MIRROR" rev-parse --verify refs/tags/v1.10.4 >/dev/null
git --git-dir="$MIRROR" for-each-ref --format='%(refname)' | LC_ALL=C sort > "$BASE/refs-before.txt"
git --git-dir="$MIRROR" show-ref > "$BASE/sha-before.txt"

protected_tree() {
  git --git-dir="$MIRROR" ls-tree -r "$1" |
    awk -F '\t' 'NF == 2 {
      p=$2;
      if (p=="infra/9router/runtime-policy.json") next;
      if (p ~ /\.(md|markdown|txt)$/) next;
      if (p ~ /^\.agent\/(checkpoints|tasks)\//) next;
      if (p ~ /^infra\/(vps|cloudflare)\// && p ~ /\.example(\.|$)/) next;
      if (p=="infra/host-profile.env.example") next;
      print
    }' | LC_ALL=C sort
}
protected_tree refs/heads/main > "$BASE/main-code-before.tsv"
protected_tree refs/tags/v1.10.4 > "$BASE/tag-code-before.tsv"

# git-filter-repo official file-info-callback: apply exact rules only to docs.
# Code, Dockerfiles, scripts, JSON runtime configs and test fixtures remain untouched.
CALLBACK="$(cat <<'PY'
if filename == b'infra/9router/runtime-policy.json':
    return (None, mode, blob_id)
document = (
    filename.endswith((b'.md', b'.markdown', b'.txt')) or
    (filename.startswith((b'infra/vps/', b'infra/cloudflare/')) and b'.example' in filename) or
    filename == b'infra/host-profile.env.example'
)
if not document or mode not in (b'100644', b'100755'):
    return (filename, mode, blob_id)
contents = value.get_contents_by_identifier(blob_id)
if value.is_binary(contents):
    return (filename, mode, blob_id)
new_contents = value.apply_replace_text(contents)
if new_contents == contents:
    return (filename, mode, blob_id)
key = b'doc-replacement-' + blob_id
if key not in value.data:
    value.data[key] = value.insert_file_with_contents(new_contents)
return (filename, mode, value.data[key])
PY
)"
(
  cd "$MIRROR"
  git filter-repo --force \
    --path infra/9router/runtime-policy.json --invert-paths \
    --replace-text "$BASE/exact-replacements.private.txt" \
    --file-info-callback "$CALLBACK" > "$BASE/filter-repo.private.log" 2>&1
)
git --git-dir="$MIRROR" for-each-ref --format='%(refname)' | LC_ALL=C sort > "$BASE/refs-after.txt"
git --git-dir="$MIRROR" show-ref > "$BASE/sha-after.txt"
git --git-dir="$MIRROR" fsck --no-reflogs --full --strict > "$BASE/fsck.private.log" 2>&1
cmp -s "$BASE/refs-before.txt" "$BASE/refs-after.txt" || { echo 'REHEARSAL_FAILED=refs_changed'; exit 1; }
[[ -z "$(git --git-dir="$MIRROR" remote)" ]] || { echo 'REHEARSAL_FAILED=unexpected_remote'; exit 1; }
protected_tree refs/heads/main > "$BASE/main-code-after.tsv"
protected_tree refs/tags/v1.10.4 > "$BASE/tag-code-after.tsv"
cmp -s "$BASE/main-code-before.tsv" "$BASE/main-code-after.tsv" || { echo 'REHEARSAL_FAILED=main_source_changed'; exit 1; }
cmp -s "$BASE/tag-code-before.tsv" "$BASE/tag-code-after.tsv" || { echo 'REHEARSAL_FAILED=tag_source_changed'; exit 1; }
if git --git-dir="$MIRROR" rev-list --objects --all |
   grep -F ' infra/9router/runtime-policy.json' >/dev/null; then
   echo 'REHEARSAL_FAILED=private_account_policy_remains'; exit 1
fi
python3 - "$BASE/sha-before.txt" "$BASE/sha-after.txt" <<'PY'
import pathlib,sys
def read(path):
    return {line.split(' ',1)[1]:line.split(' ',1)[0] for line in pathlib.Path(path).read_text().splitlines()}
b,a=map(read,sys.argv[1:])
print('REHEARSAL_REF_COUNT='+str(len(a)))
print('REHEARSAL_CHANGED_REF_COUNT='+str(sum(b.get(k)!=v for k,v in a.items())))
print('REHEARSAL_V1_10_4_TAG_PRESERVED='+str('refs/tags/v1.10.4' in a).lower())
PY
echo 'REHEARSAL_ORIGINAL_MAIN_CODE_BLOBS=preserved'
echo 'REHEARSAL_ORIGINAL_TAG_CODE_BLOBS=preserved'
echo 'REHEARSAL_HISTORIC_ACCOUNT_POLICY_PATH=removed'
echo 'REHEARSAL_REMOTE_PUSH=never'
echo "REHEARSAL_PRIVATE_OUTPUT_DIR=$BASE"
echo 'BLOCKER: Code and other refs still require a separate privacy-safe runtime migration.'
