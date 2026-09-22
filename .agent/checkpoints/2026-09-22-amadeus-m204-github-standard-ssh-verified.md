# Amadeus-M204 standard GitHub SSH URL verified

Date: 2026-09-22 (Asia/Shanghai)
Status: STANDARD SSH CLONE/PULL PATH VERIFIED

## Incident and correction

The target's first user-invoked clone used `git@github.com:ChristmasFox/amadeus-home.git`, while the prior
configuration only defined the nonstandard `github-amadeus` alias. The failure was therefore a host-alias
mismatch, not a GitHub authorization failure. A later inspection found `/Users/nyannyan/.ssh/config` reduced
to a 2-byte empty file. Its pre-correction copy was retained at a target-local backup path; no key material was
lost or exposed.

## Current target configuration

- Standard `Host github.com` uses the dedicated target-local ED25519 identity with `IdentitiesOnly yes`.
- The clean repository at `/Users/nyannyan/agent-monorepo` has standard origin
  `git@github.com:ChristmasFox/amadeus-home.git`.
- Repository-local `core.sshCommand` pins the same dedicated key, so ordinary fetch/pull remains correct even
  if an unrelated SSH default identity is later present.

## Live verification

- `git ls-remote origin HEAD` returned `e9c648dcf1a7f6e4793c911d70b614efd9dc0aa2`.
- `git pull --ff-only` fast-forwarded the target clone to that commit.
- Target clone status after pull: `main` tracking `origin/main`, clean worktree.

No secret/state/media transfer, service startup, second runtime, or cutover occurred.
