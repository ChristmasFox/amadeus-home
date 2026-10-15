# Lab Memory Core authorized reindex result — 2026-10-15

Status: **step 3 accepted for full rebuild, keyword/semantic retrieval, and
`dirty=false`; modified-file incremental refresh and restart persistence remain
open P1 `LIVE_VERIFIED` gates**. Scope was OrbStack `nyannyan` / container
`openclaw` only. Gate/M2 was not queried or changed.

## Pre-write recovery point

The pre-write checkpoint is
`.agent/checkpoints/2026-10-15-lab-memory-reindex-prewrite.md`, with protected
external artifacts at
`/Volumes/Avalon/backups/operation-skuld/lab-memory/20261015T124516Z`.
The SQLite online backup passed `quick_check` and `integrity_check`; its SHA-256
is `a8b90f7c7bff9e0b87c9d528a4396edab46c0efa956feb22dc0b84b2f668a720`.
The memory archive includes `workspace/memory/` and `workspace/MEMORY.md` and
passed archive/content verification. No rollback was needed; the backup remains
untouched.

## Reindex and retrieval

Command:

```sh
orb -m nyannyan -u root docker exec openclaw openclaw memory index --force --agent main
```

The command exited 0. Its raw output was consumed by an in-container filter and
not emitted or retained. The derived index in the existing agent database now
reports 3 files / 3 scanned, 70 chunks, `dirty=false`, FTS enabled/available,
hybrid mode, a valid index identity, vector enabled at 1024 dimensions, and 72
cached embeddings.

- Exact keyword query: 3 results; all 3 have positive text scores and positive
  vector scores. Maximum text score was 0.803; maximum vector score was 0.720.
- Different-worded semantic paraphrase: 1 result with a positive vector score;
  maximum vector score was 0.332.
- Only counts and numeric scores were recorded. No memory path, snippet, or
  source text was emitted.

No `memory reset`, service restart, session backfill, or Dreaming run occurred.
The session-history database was not deleted, replaced, or rebuilt; the command
updated the derived Memory Core index in that same existing database. The
status check after the queries still reported `dirty=false`.

## Recovery boundary

If later verification fails, stop and preserve the current live database/WAL
and the pre-write snapshot. Do not restore the whole snapshot over any newer
session or memory writes. Review the write window first; any targeted index
recovery must preserve newer user data. No rollback action has been performed.
