---
name: agent-checkpoint
description: Record a recoverable Codex engineering checkpoint after a meaningful repository phase.
---

# Agent Checkpoint

- Read `docs/CONTEXT.md`, `docs/CURRENT_TASK.md`, and the current Goal; inspect detailed state and architecture as relevant, then run `git status --short --branch` and `git log -5 --oneline --decorate`.
- Record what changed, what was verified, the current Git commit/branch, runtime assumptions, unresolved risks, and the next concrete task.
- Use checkpoints only for deploy, release, migration, storage/database mutation, security-sensitive runtime change, or other explicit rollback risks. Update current state/task facts, add a dated checkpoint, and track unfinished follow-ups in `.agent/tasks/`. Ordinary FAST/RUNTIME edits need no checkpoint.
- Run the smallest relevant tests plus `pnpm check:secrets` and `git diff --check`; do not claim completion when a required check is skipped.
