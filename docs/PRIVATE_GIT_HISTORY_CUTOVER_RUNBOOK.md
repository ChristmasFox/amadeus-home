# Private Git history cutover: staged execution runbook

Status: **offline candidate ready to test, remote update NOT AUTHORIZED**.
The owner must explicitly approve publication of destructive Git ref changes
AFTER inspecting the private candidate and its reports.

## Goal and exact boundaries

This stage combines:
1. a fresh full-ref private Git bundle after fetching the current PR #3;
2. an offline candidate `main` set to the PR #3 source tree;
3. `git-filter-repo` across all reachable refs, including annotated tags,
   removing old `infra/9router/runtime-policy.json` and performing ONLY
   operator-reviewed exact replacements in blob contents and commit/tag
   messages;
4. ref-set, Git fsck, current active-runtime blob, full-text rule and
   historical identity-policy validation.

This stage never modifies the live Mac mini checkout, running containers,
VPS, DNS, 9Router OAuth, subscription credentials, or GitHub refs.

## Operator commands on the Mac mini

Run on the trusted computer holding the private production backups.
DO NOT upload any bundle, replacement file, or unredacted logs to GitHub.

```bash
cd "$HOME/agent-monorepo"
git status --short
git fetch --all --tags
git rev-parse refs/remotes/origin/security/vps-public-info-redaction-20261010

umask 077
CUTOVER_DIR="$HOME/Amadeus-private-backups/fresh-history-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$CUTOVER_DIR"
git bundle create "$CUTOVER_DIR/fresh-all-refs.bundle" --all
git bundle verify "$CUTOVER_DIR/fresh-all-refs.bundle"
git for-each-ref --format='%(refname) %(objectname)' > "$CUTOVER_DIR/refs-before.private.txt"

git show origin/security/vps-public-info-redaction-20261010:scripts/prepare-private-git-cutover.sh \
  > "$CUTOVER_DIR/prepare-cutover.sh"
chmod 700 "$CUTOVER_DIR/prepare-cutover.sh"
```

Copy your *existing* `exact-rules.txt` from the previous offline rehearsal,
make a protected local copy, and **review it privately** before running:

```bash
cp "$HOME/Amadeus-private-backups/privacy-rehearsal/exact-rules.txt" \
  "$CUTOVER_DIR/exact-rules.private.txt"
chmod 600 "$CUTOVER_DIR/exact-rules.private.txt"
# Review the private replacement rules locally in your editor, without
# pasting production values into GitHub issues or chat logs.
```

Then run:

```bash
AMADEUS_CUTOVER_SOURCE_REPO="$HOME/agent-monorepo" \
  bash "$CUTOVER_DIR/prepare-cutover.sh" \
    "$CUTOVER_DIR/fresh-all-refs.bundle" \
    "$CUTOVER_DIR/exact-rules.private.txt"
```

This uses **a newly created disposable Git mirror** under
`~/Amadeus-private-backups/history-cutover-candidate-*/candidate.git`
without any Git remote. The original local Git checkout and its
`.local` private production policy are unaffected.

Only share with the reviewer these machine-generated summary lines:

```text
CUTOVER_CANDIDATE=...
CUTOVER_SOURCE_RUNTIME_BLOBS=...
CUTOVER_HISTORIC_9ROUTER_POLICY=...
CUTOVER_EXACT_MATCH_REMAINING_BLOBS=...
CUTOVER_HISTORY_PERSONAL_DOMAIN_BLOBS=...
CUTOVER_HISTORY_NAMED_OPERATOR_IDENTITY_BLOBS=...
CUTOVER_HISTORY_ACCOUNT_EMAIL_POLICY_BLOBS=...
CUTOVER_REMOTE_PUSH=never
```

Do NOT share paths to operator files unless redacted; do not share the
`filter-repo.private.log`, SHA mappings, original Git bundle,
replacement rules or any secret scan raw report.

## Abort conditions and limitations

- If source code blobs that run the current production services have changed
  unexpectedly, the script **fails closed**. Historical restoration/migration
  scripts can be reworded by exact replacements but must not be deployed as
  if they were previously tested source.
- If the original historical scanner still detects known personal domains,
  device/account IDs, account-policy patterns, or private-key headers, the
  candidate **fails closed**.
- The exact rule file is not an exhaustive secret inventory. Generic API-key
  heuristic matches, unknown public IPv4 candidates, untracked PR refs,
  unsafe paths, author email addresses and GitHub caches need separate
  inspection. A passing candidate is **not** proof that the entire public
  repository is clean.
- PR #3 and older branch/tag refs remain **public** until the owner approves
  a coordinated remote cutover. Old PR head/merge refs, direct GitHub SHA
  links and forks may still surface historical objects afterward.
- The current `v1.10.4` tag is historical and **must be reviewed** after
  rewriting: commit hashes and possibly old-source string values change.
  Do not silently claim it is byte-for-byte equivalent.
- An old production Docker image may still point to a now-unreachable SHA;
  the reviewed OpenClaw release path requires a separate explicit dual-image
  lineage bridge and protected runtime profile. **Do not run it here.**

## After a successful private candidate

The assistant reviews only safe output summaries and the GitHub PR CI.
The actual remote cutover requires a separate explicit owner authorization,
a pre-push ref-drift check, complete coordinated branch/tag updating,
GitHub pull-ref/cached-object review, and a local-worktree recovery plan.

**Never push this private candidate automatically.**
