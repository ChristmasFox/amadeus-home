#!/usr/bin/env bash
# Generate a PRIVATE, offline cutover candidate. NEVER update remote Git refs.
# Requires a *fresh* verified Git bundle containing the current Draft PR #3.
set -Eeuo pipefail
if (( $# != 2 )); then
  echo 'Usage: prepare-private-git-cutover.sh <fresh.bundle> <private-exact-replacements.txt>' >&2
  exit 2
fi
BUNDLE="$(cd "$(dirname "$1")" && pwd -P)/$(basename "$1")"
RULES="$(cd "$(dirname "$2")" && pwd -P)/$(basename "$2")"
for f in "$BUNDLE" "$RULES"; do
  [[ -f "$f" && -r "$f" && ! -L "$f" ]] || { echo 'Input must be a regular readable private file.' >&2; exit 2; }
done
[[ "$BUNDLE" != "$RULES" && -s "$RULES" ]] || { echo 'Invalid private inputs.' >&2; exit 2; }
git filter-repo --version >/dev/null 2>&1 || { echo 'Install git-filter-repo first.' >&2; exit 2; }
python3 - "$RULES" <<'PY'
from pathlib import Path
import sys
rules=[line for line in Path(sys.argv[1]).read_bytes().splitlines() if line.strip() and not line.startswith(b'#')]
if not (1<=len(rules)<=128):raise SystemExit('Invalid private literal-rule count')
for line in rules:
    if not line.startswith(b'literal:') or line.count(b'==>')!=1:raise SystemExit('Only exact literal replacements are allowed')
    old,new=line[8:].split(b'==>',1)
    if not (5<=len(old)<=512 and 1<=len(new)<=512 and old!=new):
        raise SystemExit('Invalid literal replacement lengths')
PY
SOURCE="${AMADEUS_CUTOVER_SOURCE_REPO:-$HOME/agent-monorepo}"
[[ -d "$SOURCE/.git" ]] || { echo 'Local source checkout not found.' >&2; exit 2; }
git -C "$SOURCE" bundle verify "$BUNDLE" >/dev/null 2>&1 || {
  echo 'Private bundle verification failed.' >&2; exit 2
}
REF='refs/remotes/origin/security/vps-public-info-redaction-20261010'
PR_SHA="$(git -C "$SOURCE" rev-parse --verify "$REF^{commit}")"
[[ "$PR_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'PR head SHA unavailable.' >&2; exit 2; }

umask 077
OUT="${AMADEUS_CUTOVER_OUTPUT_DIR:-$HOME/Amadeus-private-backups/history-cutover-candidate-$(date +%Y%m%d-%H%M%S)}"
[[ ! -e "$OUT" ]] || { echo 'Refusing to overwrite an existing private directory.' >&2; exit 2; }
mkdir -p -m 700 "$OUT"
cp "$RULES" "$OUT/exact-replacements.private.txt"
chmod 600 "$OUT/exact-replacements.private.txt"
MIRROR="$OUT/candidate.git"
git clone --quiet --mirror "$BUNDLE" "$MIRROR"
git --git-dir="$MIRROR" remote remove origin >/dev/null 2>&1 || true
[[ -z "$(git --git-dir="$MIRROR" remote)" ]] || { echo 'Unexpected mirror remote.' >&2; exit 2; }
git --git-dir="$MIRROR" cat-file -e "$PR_SHA^{commit}" || {
  echo 'Stale bundle: latest fetched PR commit not included. Recreate private bundle.' >&2; exit 2
}
git --git-dir="$MIRROR" rev-parse --verify refs/heads/main >/dev/null
git --git-dir="$MIRROR" rev-parse --verify refs/tags/v1.10.4 >/dev/null
git --git-dir="$MIRROR" for-each-ref --format='%(refname)' | LC_ALL=C sort > "$OUT/refs-before.txt"
git --git-dir="$MIRROR" show-ref > "$OUT/sha-before.txt"
# Advance main to PR #3 *only in this throwaway bare Git mirror*.
git --git-dir="$MIRROR" update-ref refs/heads/main "$PR_SHA"

# Preserve a manifest of runnable source blobs from the reviewed PR tip.
# Historical commits may change, but the current runtime should not silently
# change. Known scanner source files contain deliberate private-pattern tests.
protected_tree() {
  git --git-dir="$MIRROR" ls-tree -r refs/heads/main |
    awk -F '\t' 'NF==2 {
      p=$2;
      if (p=="infra/9router/runtime-policy.json") next;
      if (p ~ /\.(md|markdown|txt)$/) next;
      if (p ~ /^\.agent\/(checkpoints|tasks)\//) next;
      if (p ~ /^infra\/(vps|cloudflare)\// && p ~ /\.example(\.|$)/) next;
      if (p=="infra/host-profile.env.example") next;
      if (p=="scripts/audit-public-infrastructure.mjs" || p=="scripts/audit-git-history-blobs.mjs") next;
      print
    }' | LC_ALL=C sort
}
protected_tree > "$OUT/source-before.tsv"
(
  cd "$MIRROR"
  git filter-repo --force \
    --path infra/9router/runtime-policy.json --invert-paths \
    --replace-text "$OUT/exact-replacements.private.txt" \
    --replace-message "$OUT/exact-replacements.private.txt" \
    > "$OUT/filter-repo.private.log" 2>&1
)
git --git-dir="$MIRROR" fsck --full --strict --no-reflogs > "$OUT/fsck.private.log" 2>&1 || {
  echo 'CUTOVER_CANDIDATE=failed_fsck'; exit 1
}
[[ -z "$(git --git-dir="$MIRROR" remote)" ]] || { echo 'CUTOVER_CANDIDATE=failed_unexpected_remote'; exit 1; }
git --git-dir="$MIRROR" for-each-ref --format='%(refname)' | LC_ALL=C sort > "$OUT/refs-after.txt"
git --git-dir="$MIRROR" show-ref > "$OUT/sha-after.txt"
cmp -s "$OUT/refs-before.txt" "$OUT/refs-after.txt" || { echo 'CUTOVER_CANDIDATE=failed_ref_set'; exit 1; }
git --git-dir="$MIRROR" rev-parse --verify refs/tags/v1.10.4 >/dev/null
protected_tree > "$OUT/source-after.tsv"
if ! cmp -s "$OUT/source-before.tsv" "$OUT/source-after.tsv"; then
  echo 'CUTOVER_CANDIDATE=blocked_runtime_source_change'
  echo 'CUTOVER_PRIVATE_REPORT=source-before.tsv/source-after.tsv'
  echo 'CUTOVER_REMOTE_PUSH=never'
  exit 1
fi
if git --git-dir="$MIRROR" rev-list --objects --all | grep -F ' infra/9router/runtime-policy.json' >/dev/null; then
  echo 'CUTOVER_CANDIDATE=failed_historical_policy_remains'; exit 1
fi
# Never display private patterns; validate all reachable text blobs in batches.
python3 - "$MIRROR" "$OUT/exact-replacements.private.txt" <<'PY'
from pathlib import Path
import subprocess,sys
mirror,path=sys.argv[1:]
needles=[v[8:].split(b'==>',1)[0] for v in Path(path).read_bytes().splitlines() if v.startswith(b'literal:')]
git=['git','--git-dir='+mirror]
objects=subprocess.check_output(git+['rev-list','--objects','--all'],text=True).splitlines()
shas=list(dict.fromkeys(x.split(' ',1)[0] for x in objects))
p=subprocess.run(git+['cat-file','--batch-check=%(objectname) %(objecttype) %(objectsize)'],
  input='\n'.join(shas)+'\n',text=True,capture_output=True,check=True)
to_scan=[]
oversize=0
for row in p.stdout.splitlines():
  sha,kind,length=row.split(' ')
  if kind!='blob':continue
  if int(length)>2_000_000:oversize+=1
  else:to_scan.append(sha)
found=0
for i in range(0,len(to_scan),32):
  batch=to_scan[i:i+32]
  x=subprocess.run(git+['cat-file','--batch'],input=('\n'.join(batch)+'\n').encode(),
    capture_output=True,check=True).stdout
  pos=0
  for _ in batch:
    end=x.index(b'\n',pos)
    hdr=x[pos:end].split(b' ')
    n=int(hdr[2])
    data=x[end+1:end+1+n]
    if any(needle in data for needle in needles):found+=1
    pos=end+1+n+1
print('CUTOVER_EXACT_MATCH_REMAINING_BLOBS='+str(found))
print('CUTOVER_BLOBS_SCANNED='+str(len(to_scan)))
print('CUTOVER_OVERSIZED_BLOBS_UNSCANNED='+str(oversize))
if found or oversize:sys.exit(1)
PY
echo 'CUTOVER_CANDIDATE=prepared'
echo 'CUTOVER_SOURCE_RUNTIME_BLOBS=preserved'
echo 'CUTOVER_HISTORIC_9ROUTER_POLICY=removed'
echo 'CUTOVER_REMOTE_PUSH=never'
echo "CUTOVER_PRIVATE_DIR=$OUT"
echo 'DO_NOT_FORCE_PUSH_UNTIL_SEPARATELY_APPROVED=true'
