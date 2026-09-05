---
name: agent-checkpoint
description: Record a recoverable Codex engineering checkpoint after a meaningful repository phase.
---

# Agent Checkpoint

- Read `README.md`, `docs/ARCHITECTURE.md`, `docs/PROJECT_STATE.md`, `docs/CURRENT_TASK.md`, and `.agent/state.md`, then run `git status --short --branch` and `git log -5 --oneline --decorate`.
- Record what changed, what was verified, the current Git commit/branch, runtime assumptions, unresolved risks, and the next concrete task.
- Update `docs/CURRENT_TASK.md`, `docs/PROJECT_STATE.md`, `.agent/state.md`, and add a dated file under `.agent/checkpoints/`. Put unfinished follow-ups in `.agent/tasks/`.
- Run the smallest relevant tests plus `pnpm check:secrets` and `git diff --check`; do not claim completion when a required check is skipped.
