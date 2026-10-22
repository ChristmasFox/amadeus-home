# Engineering Policy — Autonomous Goal Workflow V2

## Current personal-workflow override (2026-10-17)

This section supersedes the historical release/phase rules below for Lab, the private research page, and Gate-Local. PRs and green GitHub CI are not required for commits or routine deployment. Actions run manually only when useful. devctl phase completion tracks progress rather than requiring full test suites or deploying Gate as a side effect of Lab. Lab auto-deploys relevant main changes as **candidates** with small runtime health checks and no full per-deploy data backup, while preserving existing files and rollback image/configuration; formal SemVer tags wait for Arthur approval. Gate-Local runs independently, never as a Lab prerequisite. Staging/production and destructive database migrations remain separate operations.


## Gate-Local deploy behavior (2026-10-16 simplification)

Gate-Local is a development/test instance. Arthur has granted standing
Gate-Local candidate authorization for this repository. The protected host
record is bound to the Git common directory, so every linked worktree shares
the same authorization; no per-worktree opt-in or terminal confirmation is
required. A passing Goal phase / CI can trigger an automatic candidate rollout.
Valid stale application images are reconciled by the normal Compose rollout.
Every candidate first creates and verifies an encrypted full PostgreSQL
checkpoint. Destructive migrations emit a prominent warning and continue after
the backup. Failed migrations or post-switch health/smoke checks automatically
restore the database checkpoint, previous application image and configuration.

Wrong Bot/target, duplicate active Gateway/Worker, unsupported extension/PG
image changes, unavailable backup, or an unrecoverable deployment error still
stop the rollout. **CI green is necessary but does not prove the actual
Gate-Local runtime is healthy.** A candidate is recorded deployed only after
runtime checks. M2 remains PAUSED across candidate deployments. No Gate-Prod
auto-promotion; Lab and Gate runtimes remain separate.


> Current rules for any code agent working in this repository. Read this short
> file once per task. A Goal specifies product behavior and acceptance criteria,
> not a duplicate set of generic tests, runtime permissions, or publication rules.

## Product delivery defaults

| Scope | Development | After a verified phase | Formal publication |
| --- | --- | --- | --- |
| Lab (OpenClaw self-hosted Kurisu) | focused edit/task checks | after Lab-relevant changes reach `main`, M204 automatically builds/switches an OpenClaw **candidate** (VERSION unchanged; failed live checks roll back) | Arthur says 「正式部署」→ `lab-auto-release.py formal` bumps SemVer, aggregates notes since the previous `lab/v*`, live-verifies, then creates `lab/vX.Y.Z` + GitHub Release |
| Gate (AI SDK KOOK service) | focused checks and isolated integration | **Gate-Local**: repo-wide standing authorization triggers candidate deployment after CI; always back up PostgreSQL, warn before destructive migrations, and restore the checkpoint plus prior app/config on failure. M2 remains PAUSED. **Staging/Prod** never auto-promote | operator selects formal environment/promotion; M2 clearance is reserved for formal release |
| Shared Domain/Presentation | verify both affected consumers | Lab follows its main-merge **candidate** path (formal later on approval); Gate uses its separate Gate-Local candidate policy; cross-product source changes never authorize the other deployment | independent product versions and release paths |

Lab has two stages. A launchd timer on M204 watches merged `main` for Lab-relevant
paths and automatically deploys a **candidate**: external/minimal Compose checkpoint,
one immutable OpenClaw image for that Git SHA, switch the single instance, verify
container health, WhatsApp connectivity, and a real PUBG stats query. Failed
post-switch checks restore the prior Compose image/configuration. Candidate keeps
root `VERSION` unchanged and does **not** create `lab/v*` or a GitHub Release.

Formal publication is explicit: when Arthur says 「正式部署」, run
`python3 scripts/lab-auto-release.py formal` on M204 (optional `--bump`). That path
bumps SemVer, writes `RELEASE_NOTES.md` aggregating first-parent changes since the
previous `lab/v*` tag, pushes `chore(lab): release vX.Y.Z`, live-verifies, then
pushes `lab/vX.Y.Z` and the GitHub Release. No host-local opt-in or per-candidate
prompt. The timer handles only Lab and never invokes Gate deployment.

Other runtime changes outside this Lab OpenClaw release path (memory reindex,
secret rotation, network/SSH/firewall changes, Gate-Staging/Prod promotion,
cloud infrastructure) retain their existing risk boundaries. Gate-Local's
normal candidate rollout, including destructive migrations after a verified
full backup and warning, must not be re-approved per phase.

A prior Goal's explicit stop/permission clauses remain in force for runtime
actions outside the Lab main-release contract. That contract is authorized by
the merged `main` PR and its green CI; it does not authorize unrelated runtime
writes. Documentation text cannot grant OS-level access.

## Routine execution

1. For a newly chosen Goal: read its acceptance contract once; run
   `pnpm devctl goal start docs/GOAL.md` to capture immutable source and Goal
   hashes. For every subsequent continuation read `pnpm devctl goal status`
   rather than all of `CURRENT_TASK.md`, `CONTEXT.md`, and archived checkpoints.
2. Implement one narrow task. Use `pnpm devctl check --level edit` for focused
   syntax checks and `--level task` for a task boundary. Tests cannot be skipped
   if the changed code is not covered: introduce a focused test or record the
   gap for the phase gate.
3. At a phase exit, commit source and run `pnpm devctl goal finish-phase P<N>`.
   This runs affected regression and secrets gates; it does not change the Lab
   runtime.
4. Merge Lab source through the normal PR/main path. The M204 timer deploys a Lab
   **candidate** automatically; formal `lab/v*` waits for Arthur's 「正式部署」. Gate-only phases use a distinct
   protected `release-gate.sh` candidate path when the repo-wide Gate-Local host
   authorization exists and the target is healthy and authorized. M2 clearance is not
   a candidate prerequisite; the candidate path must leave M2 PAUSED. The
   current Gate autopilot may require implementation;
   mere policy text is not proof it is available. If the change is sensitive,
   unknown, config/security-related or Product Radar-only, it requests a reviewed
   deployment plan instead of running Compose directly.
5. Use `pnpm devctl check --level release` when needed. CI is the final
   independent source verifier. A green CI check is not live runtime proof; Lab
   candidate/formal acceptance also requires the live checks in the M204 pipeline.

## Host authorization

The Lab auto-release timer is installed from the repository and keeps its
protected state under `~/.local/state/amadeus/lab-auto-release`. It runs only on
M204, deploys candidates for Lab-relevant main commits, and does not require a
host-local opt-in or interactive confirmation. Formal tags use
`python3 scripts/lab-auto-release.py formal`. Remove the timer with
`python3 scripts/lab-auto-release.py uninstall`; backups and release state are
preserved.
Gate-Local's existing owner-only `0600` host record is bound to the Git common
directory, target Bot, Gate-Local machine, encrypted backup configuration and
private notification hook. It has no expiry and is shared by linked worktrees.
Arthur's standing authorization is recorded outside Git; no per-worktree
opt-in or interactive confirmation is required. `gate-auto-disable` revokes
the Gate-Local authorization. Every candidate, including code-only changes,
requires a verified full PostgreSQL checkpoint. Destructive migrations proceed
after a prominent warning and verified backup; failure restores the database
checkpoint and previous application/configuration. The candidate path must
leave M2 PAUSED and must not create or modify an M2 clearance. M2 clearance is
reserved for formal release and can be removed with `gate-m2-revoke` or
`gate-auto-disable`. New pgvector image/extension, production credentials,
paid-provider probe, real-memory ingestion schedule, formal release and
Staging/Prod promotion remain separate risk classes requiring explicit
preauthorization.

For stronger privilege separation, use a dedicated deploy user with limited
Docker/SSH rights; a file readable by a code agent is an accidental-action
guard, **not a security boundary against a malicious agent**.

## Context budget and evidence

- `AGENTS.md` is the small bootstrap. `docs/CURRENT_TASK.md` and
  `docs/CONTEXT.md` contain historical material; only read the relevant
  numbered range when necessary. Goal state is a private ignored file
  `.agent/runtime/goal-state.json` (not an extra public diary).
- Re-read the complete Goal only if its hash changes or a requirement needs
  clarification. Read just current-phase paragraphs and changed code normally.
  Never paste entire logs or full files repeatedly into a Codex context.
- Each passing edit/task check is bound to a hash of HEAD, changed worktree
  contents, dependency/config files and execution command level. Changed
  inputs invalidate reuse. Phase/release checks rerun and may require real
  isolated database fixtures; never treat a cached result as production evidence.
- The Goal phase is not `LIVE_VERIFIED` until the actual service was tested. For Gate, `BLOCKED_OPERATOR_AUTHORIZATION` is truthful when the repo-wide host authorization or target scope is invalid; M2 being paused alone is not a candidate blocker. Do not claim auto deployment was performed unless the service was tested.
  `HUMAN_FEEDBACK_PENDING` can coexist with automatic candidate acceptance.
  Stalled platform sessions still require Codex's normal resume/restart path;
  this tooling does **not** pretend to bypass model/Goal capacity limits.

## Safety and responsibilities

Never commit credentials, owner data or runtime state. Keep memory/session and
PostgreSQL volumes intact. Domain behavior stays platform-neutral. Respect
existing backup/rollback and permissions. A change in Lab and Gate shared
source triggers both regression families but never couples their deployment.
Do not modify root or legacy Goals solely to inject policy boilerplate.
