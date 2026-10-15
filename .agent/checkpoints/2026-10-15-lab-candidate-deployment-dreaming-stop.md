# Lab candidate deployment and Dreaming preflight stop — 2026-10-15

## Scope and outcome

Arthur's reordered authorization applied only to Lab (`nyannyan` / `openclaw`).
The sequence completed source push, candidate build, and guarded deployment,
then stopped before the controlled Dreaming run. No Gate, PostgreSQL, or M2
action was taken. No real secret, `AGENTS.md`, session-history SQLite, or
Workspace/MEMORY.md content was changed or cleared.

## Source and build

- Source: `57e472ebe014a0b4d3574d7ef30107340dc99308`, verified at `origin/main`
- Checks before push: rebase up to date; `pnpm check:secrets` passed;
  `git diff --check` passed
- Version: `1.10.5`
- Image: `local/openclaw-amadeus:git-57e472ebe014-20261015140824`
- Digest: `sha256:4cb3c044925bb371b7232e47520b04d17633862549b9e315e555fbc9ce7aefd9`
- `BUILD_VERIFIED`: passed on Linux/ARM64. Evidence includes OpenClaw build,
  OCI provenance, plugin readability, heartbeat silence, before-read peer
  admission, backfill peer admission, no-corpus Dreaming behavior, and runtime
  version.
- Build evidence: `/Volumes/Avalon/backups/operation-skuld/deploy/candidate-build-amadeus-openclaw-20261015140824/build-evidence.json`

## Candidate deployment and acceptance

- Applied with `scripts/release-lab.sh candidate --apply --openclaw-only
  --no-build --image <candidate> --approval-ref
  arthur-lab-approval-20261015-reordered`; the guarded wrapper delegated to
  `scripts/deploy-openclaw.sh`. No bare Compose deployment was used.
- Protected pre-switch checkpoint:
  `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261015141417`
  (mode 0700). The checkpoint includes the online SQLite backup, session
  backup, Workspace backup, and mode-0600 checkpoint/backup manifests.
- Only Lab OpenClaw was switched. Product Radar was untouched. Secret files
  were preserved. Candidate health and Amadeus plugin registration passed;
  the candidate manifest validates and remains status `candidate`. The
  candidate deployment notification reached `sent`; this was not a formal
  release notification.
- Post-restart memory state: 3 files, 70 chunks, `dirty=false`, FTS available,
  vector index complete at 1024 dimensions, hybrid search, valid identity.
  Keyword and semantic queries each returned 3 results with positive vector
  scores; keyword results also had positive text scores. Query content and
  snippets were not retained.
- Live before-read admission, Dreaming peer classifier, backfill admission,
  and no-corpus markers were present. Sanitized source-boundary checks found
  the sole configured WhatsApp peer matches the owner allowlist; Telegram
  direct admission fails closed without its peer file; groups/channels are
  excluded.
- Post-deploy evidence:
  `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261015141417/postdeploy-acceptance.json`
- Final read-only `scripts/release-lab.sh status --live` at
  `2026-10-15T14:25:59Z` matched the running image, digest, source SHA,
  version, and healthy state; it reported `UNRELEASED_CANDIDATE` and took no
  automatic action.

## Dreaming stop and rollback status

Preflight found no `dreaming` entry in the live `memory-core` config. The
similarly named enabled automation is an `agentTurn` with only `memory_search`
allowed and delivery disabled; it is not a Dreaming executor. It was not run.
The controlled Dreaming run never started, so it read no source and wrote no
memory output. There is no Dreaming output to inspect for phone numbers or
cross-user/group leakage. No transcript, phone number, peer identifier, query
text, or memory snippet was stored in this checkpoint.

The candidate deployment itself succeeded and remains healthy, so no rollback
was performed. No data restore was attempted. The protected checkpoint and
live candidate are retained. `LIVE_VERIFIED` is incomplete; modified-file
incremental refresh remains open. Formal Lab release and tag were not started.
The candidate release manifest is
`/Users/nyannyan/.local/state/amadeus/releases/lab-lab-maintainer-20261015T141417Z-candidate.json`.

## Stop point

Stop at the failed Dreaming preflight. Do not proceed to formal release/tag.
The current candidate remains deployed on Lab. Gate and M2 remain untouched.
