# Git history privacy rewrite — reviewed plan, NOT YET authorized for force push

Based on the read-only history audit workflow. This document does not claim
Git history is already rewritten or that cached old commits are purged.

## Findings, 2026-10-10

- 938 reachable commits and 12,609 reachable objects.
- 5,649 historical text blob versions reviewed, with zero read errors.
- 502 historical blob versions matched the known personal domain;
  115 matched operator device/account labels; 5 matched an account-email
  policy pattern; 3 contained proxy URI-like strings.
- The public IPv4 candidate scanner returned 11 blob versions (some are
  documentation/test addresses, not actual VPS addresses).
- Gitleaks v8.30.1 returned five candidate matches: two auth-header and
  three generic-api-key rules. Reviewed paths correspond to **mock test
  credentials, a SHA-256 checksum, or dynamic token handling**, not a
  confirmed active production secret. This is not proof there are no leaks.
- The broad current-snapshot scanner still flags 131 files, including
  old notes, examples, tests, and operational scripts. A blind global
  replacement would break the operator's runtime defaults.

These counts reflect blob versions, not individual credentials.

## Mandatory gates BEFORE irreversible publication

1. [ ] The operator has a **verified complete private Git bundle** under a
   private location OUTSIDE the repository. The previous VPS documents
   tarball is not a complete historical backup.
2. [ ] Operator has preserved live private 9Router account policy, secrets,
   and any untracked operational notes needed for future deployment.
3. [ ] Current main **and all remaining branches/tags** have been sanitized
   and runtime references migrated to private configs, with regression tests.
   Do not leave current production scripts pointing at example.com.
4. [ ] Open PRs have been merged/closed; no collaborator or bot may push the
   old history while a rewrite is underway.
5. [ ] Private replacement rules have been individually reviewed.
   Do NOT replace arbitrary IPv4, UUID, emails or hex values by broad regex.
6. [ ] On a disposable fresh mirror clone, `git-filter-repo` has rewritten
   all necessary refs and inspection confirmed intended trees, code tests,
   rewritten tags, and no reintroduction of personal values.
7. [ ] Operator has expressly approved the required destructive ref updates,
   tag changes, PR diff disruption and local-clone recloning.

## Safe backup preparation on trusted Mac mini

After the backup script has been merged into your local checkout:

```bash
cd ~/agent-monorepo
bash scripts/backup-git-history-before-rewrite.sh
```

It fetches current refs (no force push), refuses a dirty working tree, and
creates a verified bundle and ref manifest under
`~/Amadeus-private-backups/git-history-*/`.
This contains UNREDACTED history: never upload to CI or share publicly.

## Controlled offline rewrite rehearsal

Use a **fresh throwaway mirror clone**, never the live
`~/agent-monorepo` working copy. After validating all private exact-match
replacement rules and paths, use the documented
`git-filter-repo --sensitive-data-removal` process. Verify the results
for every remaining branch and the `v1.10.4` tag, confirm operational
behavior and preserve a mapping of rewritten commit SHAs.

There is deliberately NO force-push / mirror-push command in this guide.
The actual remote ref update must be separately approved.

## Historical GitHub and external exposure

Rewriting Git does not remove copies in clones/forks, GitHub refs/pull,
cached old SHAs, or externally indexed pages. GitHub Support may be needed
for qualified sensitive-data purge requests. DNS-only hostnames may still
resolve to the actual VPS IP even after every Git file has been sanitized.

GitHub procedure:
https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository

STATUS: Draft PR, no production changes, no force push, no credentials rotated.


## Phase A — offline rewrite rehearsal (available; NO GitHub push)

The script `scripts/rehearse-git-history-privacy.sh` performs a **real
git-filter-repo rewrite inside a disposable mirror cloned from your verified
private Git bundle**. It does not change the Mac mini working tree.

It permanently drops `infra/9router/runtime-policy.json` from the
*rehearsal history* and applies privately approved literal replacement
rules **only to Markdown/text documentation and selected .example files**.
Executable runtime source is deliberately untouched. This is not yet a
privacy-clean publication candidate.

On the Mac mini, install `brew install git-filter-repo`. Create a private
rules file outside Git with one exact rule per line:

```text
literal:fictional-private-domain.example==>example.com
literal:fictional-host-label==>example-device
```

Use actual operator-specific matches only **inside the private file**, not
in this PR or GitHub logs. Run from the checked-out PR branch with paths to
your verified bundle and private rules file:

```bash
bash scripts/rehearse-git-history-privacy.sh \
  /path/to/amadeus-before-rewrite.bundle \
  /path/to/exact-rules.private.txt
```

The script refuses reuse of a previous output directory, strips the clone's
origin remote, verifies the ref set and protected code blobs (main and
v1.10.4), runs Git fsck and asserts that historic private 9Router policy
paths no longer exist in reachable objects. It prints a private results
directory and rewrite counts. Nothing gets pushed.

**Next blocker:** operator-specific identifiers still embedded in executable
code and old branches cannot be removed by doc-only rewriting without
migrating their runtime settings to protected private configuration first.
