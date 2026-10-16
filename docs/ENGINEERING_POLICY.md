# Engineering Policy — Autonomous Goal Workflow V2

> Current rules for any code agent working in this repository. Read this short
> file once per task. A Goal specifies product behavior and acceptance criteria,
> not a duplicate set of generic tests, runtime permissions, or publication rules.

## Product delivery defaults

| Scope | Development | After a verified phase | Formal publication |
| --- | --- | --- | --- |
| Lab (OpenClaw self-hosted Kurisu) | focused edit/task checks | build and apply a *reversible candidate* automatically **only** with a one-time host-local operator authorization and safe source scope | formal tag/release remains a separate explicitly reviewed operation |
| Gate (AI SDK KOOK service) | focused checks and isolated integration | build/prepare candidate if needed; **never auto-apply to Gate-Local, Staging or Prod** | operator selects environment and promotion |
| Shared Domain/Presentation | verify both affected consumers | Lab may follow its own candidate path; Gate remains isolated | independent product versions and release approvals |

Candidate acceptance is not a formal release. Lab runtime health and owner
WhatsApp notification are provided by the existing guarded release path. Human
feedback is asynchronous; it need not block unrelated development. A runtime
write outside the preauthorized Lab candidate contract (destructive schema
change, memory reindex, secret rotation, network/SSH/firewall change, risky
maintenance, Gate changes, cloud infrastructure) still needs its own approval.

A prior Goal's explicit stop/permission clauses are **not silently overridden**.
Review and amend conflicting legacy Goals with the operator before enabling auto
apply for them. Documentation text cannot grant OS-level access.

## Routine execution

1. For a newly chosen Goal: read its acceptance contract once; run
   `pnpm devctl goal start docs/GOAL.md` to capture immutable source and Goal
   hashes. For every subsequent continuation read `pnpm devctl goal status`
   rather than all of `CURRENT_TASK.md`, `CONTEXT.md`, and archived checkpoints.
2. Implement one narrow task. Use `pnpm devctl check --level edit` for focused
   syntax checks and `--level task` for a task boundary. Tests cannot be skipped
   if the changed code is not covered: introduce a focused test or record the
   gap for the phase gate.
3. At a phase exit, commit source, run `pnpm devctl goal finish-phase P<N>`.
   This runs affected regression and secrets gates; only after a clean committed
   tree may the preauthorized Lab candidate switch occur.
4. The phase command deduplicates already-deployed HEAD, delegates actual
   immutable images, checkpoints, health checks, rollback and owner notification
   to `release-lab.sh`, and **never deploys Gate**. If the change is sensitive,
   unknown, config/security-related or Product Radar-only, it requests a reviewed
   deployment plan instead of running Compose directly.
5. Once for a release candidate, use `pnpm devctl check --level release` when
   needed. CI is the final independent source verifier. A green CI check is not
   live runtime proof.

## One-time host authorization

Enable from the maintainer's **interactive local terminal** (not from CI or
the Goal instruction):

`pnpm devctl configure lab-auto-enable`

This writes a mode-0600 approval bound to that checkout outside the repository
in `~/.config/amadeus/lab-auto-approval.json`. No per-Goal “lab-auto” prefix is
needed. Disable with `pnpm devctl configure lab-auto-disable`. Without that
approval, phase validation continues but Lab deployment is reported as pending.
It cannot bypass the existing `release-lab.sh --apply --approval-ref` guards.
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
- The Goal phase is not `LIVE_VERIFIED` until the actual service was tested.
  `HUMAN_FEEDBACK_PENDING` can coexist with automatic candidate acceptance.
  Stalled platform sessions still require Codex's normal resume/restart path;
  this tooling does **not** pretend to bypass model/Goal capacity limits.

## Safety and responsibilities

Never commit credentials, owner data or runtime state. Keep memory/session and
PostgreSQL volumes intact. Domain behavior stays platform-neutral. Respect
existing backup/rollback and permissions. A change in Lab and Gate shared
source triggers both regression families but never couples their deployment.
Do not modify root or legacy Goals solely to inject policy boilerplate.
