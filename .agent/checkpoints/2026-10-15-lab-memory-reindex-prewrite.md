# Lab Memory Core reindex pre-write checkpoint — 2026-10-15

Status: **protected backup verified; reindex not yet run**. This checkpoint
covers only Lab on OrbStack `nyannyan`, container `openclaw`. Gate/M2 was not
queried or changed.

## Baseline

- OpenClaw image was healthy at version `1.10.4`; the memory CLI is OpenClaw
  `2026.9.4`.
- The configured provider is `openai-compatible`, model
  `Qwen/qwen3.7-text-embedding-flash`, sources `memory`.
- Before the write, Memory Core reported 2 indexed files, 70 chunks, 3 scanned
  files, `dirty=true`, FTS enabled/available, vector enabled at 1024 dimensions,
  hybrid search mode, provider state `pending`, and index identity status
  `valid`. Dreaming session corpus count was 0.
- The agent database is
  `/home/node/.openclaw/agents/main/agent/openclaw-agent.sqlite`, backed by the
  guest bind path
  `/DATA/AppData/openclaw/config/agents/main/agent/openclaw-agent.sqlite`.
  At snapshot time the source main file was 340,553,728 bytes, WAL 951,752
  bytes, and SHM 32,768 bytes.

## Protected artifacts

Directory: `/Volumes/Avalon/backups/operation-skuld/lab-memory/20261015T124516Z`
(mode `0700`). Files and manifests are mode `0600`; this directory is outside
Git and on the verified Avalon volume. Storage UUID, sentinel, guest visibility,
and available space passed `scripts/storage-preflight.sh --identity-only`.

- `openclaw-agent.sqlite`: created with Python SQLite's online
  `Connection.backup()` API, 340,561,920 bytes, SHA-256
  `a8b90f7c7bff9e0b87c9d528a4396edab46c0efa956feb22dc0b84b2f668a720`.
  `PRAGMA quick_check` and `PRAGMA integrity_check` both returned `ok`. The
  verifier loaded the pinned bundled `sqlite-vec 0.1.9` `vec0` extension.
- `memory-workspace.tar.gz`: includes the full `workspace/memory/` directory
  and `workspace/MEMORY.md`; `DREAMS.md` was absent at capture time. The
  extracted archive tree hash matched the source tree hash
  `ad54495ee21894184ab117697b2b6b6f36bb11d4535721127653011d722fe1d5`;
  archive SHA-256 is
  `a737e71135d12ed66948ec79284dea42e37e5fb4ed88e9d99be48571b2bb8766`.
  `gzip -t` passed. The archive contains two files (including one empty file
  under `memory/`) and one directory; 9,246 source bytes.
- `index-baseline.json` is a filtered, metadata-only status record. No memory
  text or session transcript was emitted.

## Verification issue and resolution

The first invocation of `scripts/sqlite-consistent-snapshot.py` copied the
database but its generic Python SQLite connection could not run its integrity
check because it had not loaded the database's `vec0` module. The snapshot was
retained in the protected directory. The bundled `vec0.so` was copied to a
mode-0700 temporary directory with its expected basename, loaded for
`quick_check` and `integrity_check`, and the snapshot passed both checks. The
temporary extension copy was removed. No source database, WAL, workspace file,
container, or service was modified; no rollback was needed.

## Planned write and recovery

Planned command after this checkpoint is committed:

```sh
orb -m nyannyan -u root docker exec openclaw openclaw memory index --force --agent main
```

This rebuilds the derived vector/FTS index and embedding cache in the existing
agent database and may issue billable Embedding requests. It must not delete,
replace, or recreate the agent database or session-history tables. `memory
reset` is out of scope. If the command fails or produces an unhealthy index,
stop at this step, capture sanitized status/error evidence, and leave the live
database/WAL and verified backup untouched. Do not restore the whole snapshot
over newer session or memory writes. Any recovery must first review the write
window and preserve those newer writes; no automatic database rollback is
authorized by this checkpoint.
