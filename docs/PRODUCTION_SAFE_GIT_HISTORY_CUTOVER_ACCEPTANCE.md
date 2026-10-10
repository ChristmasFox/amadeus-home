# Production-safe Git history cutover — source acceptance

Date: 2026-10-11

This report records the source and test work required before the history
cutover described in `docs/PRODUCTION_SAFE_GIT_HISTORY_CUTOVER_PLAN.md`.
It does not authorize a deployment, a runtime restart, a remote ref rewrite,
or a force push.

## Completed source work

- Qwen Image engine JSON files now contain policy and variable references.
  `scripts/render-qwen-image-config.py` renders them from a separate operator
  mode-0600 profile and writes mode-0600 installed configs. Missing or
  mismatched profiles fail closed.
- Qwen Image public Host/Origin values now come from a protected mode-0600
  network JSON. Without that file, the debug UI has no public scope and keeps
  only deliberate LAN/loopback behavior. The browser does not embed an
  operator hostname.
- VPS account identities now come from a protected account map. OpenClaw,
  the SSH probe, accounting store, scheduled report prompt, tool schema and
  Compose example use the same external contract. A community install uses
  neutral fixtures; owner-only account queries return a typed configuration
  error when the production map is absent or not private.
- Mac host name and storage paths are profile inputs for MacHostAgent, the
  NAS helper, the Qwen managers and the OpenClaw host profile. The active
  runtime scan set contains no operator user path, storage mount, or host
  alias.
- Historical migration and restore scripts are explicitly classified in
  `docs/PRIVACY_RUNTIME_CLASSIFICATION.md`; they were not bulk rewritten or
  executed as part of this source-only phase.
- Historical evidence, task records, canonical pointers, and operator-only
  research/backup helpers are explicitly classified in the same document.
- CI now has a strict active-runtime current-snapshot gate, an informational
  broad current-snapshot inventory, and the selected public VPS gate in
  addition to the separate reachable-history audit. The history workflow
  fetches all accessible pull-request head/merge refs before scanning.

## Verification evidence

All commands below were run from the repository root on the cutover branch.

| Check | Result |
| --- | --- |
| `pnpm workflow:plan` | `CHANGE_SCOPE_LEVEL=RELEASE`; it reported `DOCKER_BUILD=forbidden`. No release action was run. |
| `node scripts/audit-public-infrastructure.mjs --self-test` | Passed. |
| `node scripts/audit-public-infrastructure.mjs --strict-active` | 85 files scanned, 0 flagged. |
| `node scripts/audit-public-infrastructure.mjs --strict-vps` | 78 files scanned, 0 flagged. |
| `node scripts/audit-public-infrastructure.mjs --audit-all` | 1,148 tracked text candidates scanned, 269 classified findings; informational only. |
| `node scripts/audit-git-history-blobs.mjs` | 12,738 reachable objects; 5,710 text blobs; 0 read errors; 503 personal-domain, 116 named-identity, 5 account-policy, 4 proxy-URI, 0 private-key, and 13 public-IPv4 candidate blobs. |
| `pnpm check:secrets` | Passed. |
| `pnpm --filter @agent/identity build`, `@agent/presentation build`, `@agent/amadeus-plugin typecheck` | Passed. |
| `pnpm --filter @agent/amadeus-plugin test` | 140 passed, 0 failed. |
| Qwen bridge tests | 18 passed, 0 failed. |
| Qwen debug UI tests | 19 passed, 0 failed. |
| MacHostAgent tests | 10 passed, 0 failed. |
| VPS accounting tests | 47 passed, 0 failed. |
| `node --test scripts/test-init-pubg-team.mjs` | 4 passed, 0 failed. |
| Python compile, `bash -n`, `sh -n`, `git diff --check` | Passed. |
| Qwen renderer fixture | Rendered output had mode 0600 and no unresolved `${QWEN_IMAGE_*}` references. |

## Deliberately not performed

- No CasaOS/OpenClaw deployment, Docker build, Compose restart, launchd
  install, VPS command, DNS change, firewall change, SSH change, or live
  service mutation was performed.
- No branch, tag, pull-request ref, remote object, or Git history was rewritten.
  No force push was performed.
- No secret, generated account map, runtime profile, bundle, checkpoint
  archive, subscription file, database, or credential was added to Git.

## Remaining cutover gates

The earlier offline rehearsal retained runnable source blobs by design, so it
is not a publishable sanitized history. The repository still contains
historical private objects and archival references that must be handled in the
disposable mirror workflow from the plan. The broader `--audit-all` inventory
remains informational: the current run scanned 1,148 tracked text candidates
and reported 269 classified findings, mostly in checkpoints, historical goals,
canonical task records, and recovery scripts. It is not evidence that
reachable Git history is clean. The local mirror currently exposes one
accessible pull-request head ref; CI fetches all head/merge refs that the
remote makes available before its history scan.

Before any remote cutover, the operator must still preserve the private bundle
and complete ref manifest outside the repository, run the exact-value rewrite
in a disposable mirror, verify every intended branch/tag and reachable-history
scan, coordinate open PR and tag refs, and give separate explicit authorization
for destructive remote ref replacement. This acceptance report does not grant
that authorization.
