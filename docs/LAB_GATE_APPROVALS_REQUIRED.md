# Lab / Gate actions requiring separate approval

This checklist records actions outside the source/tests/docs authorization for
the Lab Memory Core and dual-release engineering Goal. A CLI `--approval-ref`
is an audit identifier; entering one does not itself grant operational
authorization.

| Action | Direct effect | Preconditions and recovery | Status |
| --- | --- | --- | --- |
| Probe the configured Embedding endpoint | Sends a request containing a synthetic probe string to the configured provider; may incur usage charges. Confirms model ID, authentication, response shape, dimension, latency, and safe error behavior. | Approve the provider request and cost. Use synthetic text only. Do not proceed to a reindex if the returned dimension does not match the index contract. | `NOT_AUTHORIZED` |
| Rebuild the Lab memory index | Reads eligible memory files and writes the derived SQLite vector/FTS index and embedding cache; may issue multiple billable Embedding requests. | First create and verify a protected online SQLite backup and record current index identity. Confirm the model and dimension. Afterward check FTS, paraphrase retrieval, hybrid results, incremental refresh, `dirty=false`, and restart persistence. Preserve newer writes; do not restore an old whole database over them. | `NOT_AUTHORIZED` |
| Run Dreaming against an eligible corpus | Reads allowlisted session transcripts and may write `DREAMS.md`, a memory candidate, or long-term memory state. | Confirm eligible allowlisted input and a protected recovery point. Review output for source isolation and prompt injection. Remove or correct generated candidates through a reviewed recovery process; do not overwrite unrelated memory changes. | `NOT_AUTHORIZED` |
| Apply a Lab candidate | Builds the selected image set and switches the single Lab runtime through `deploy-openclaw.sh`; can briefly interrupt OpenClaw and its integrations. | Review a clean committed source tree, dry-run impact, host profile, image provenance, approval reference, and protected checkpoint/state directory. Verify health after switch. Roll back through the saved deployment checkpoint while preserving current SQLite/WAL, Workspace, and memory writes. | `NOT_AUTHORIZED` |
| Formal Lab release | Advances Lab version/release notes, deploys through the guarded Lab path, records an external manifest, and creates local immutable `lab/vX.Y.Z` tag after health checks. The release path may run owner notification and maintenance steps. | Requires all P1 `LIVE_VERIFIED` checks, separate release authorization, exact one-release notes, checkpoint, immutable image digests, and health/smoke evidence. Tag is local only; registry push is separate. Recover from the protected checkpoint without replacing newer memory state. | `NOT_AUTHORIZED` |
| Publish or sign a product image/tag | Makes a build/tag available outside the local repository and can distribute an artifact to other operators. | Review the exact source SHA, OCI digest, provenance, release notes, registry, signing identity, and public contents. Use a separately protected publishing path. | `NOT_AUTHORIZED` |
| Resume Gate M2 or apply to Gate-Local | Changes the paused M2 Gateway/Worker and could affect its KOOK identity, PostgreSQL schema/data, queues, and user-visible conversations. | Keep M2 paused until the existing Goal's real KOOK acceptance and controlled Go/No-Go are completed. Any later apply needs its own approval, protected database backup, schema compatibility review, and rollback checkpoint. Never restore the whole PG volume as an automatic rollback. | `PAUSED; NOT_AUTHORIZED` |
| Create Gate-Staging or Gate-Prod infrastructure / migrate Gate | Introduces separate host resources, credentials, Bot identity, database, and operating cost; migration can affect user data. Gate-Prod has no selected cloud host. | Choose host, budget, environment isolation, credential custody, backup/restore method, migration contract, and same-digest promotion path first. Do not assume `amadeus-gateway` is the target. | `NOT_AUTHORIZED` |

The read-only P0 observation and local source validation are complete. A future
approval must name the specific row and environment; approval of one row does
not authorize the others. Current P1 evidence and the safe reindex procedure
are in [`LAB_MEMORY_CORE_P1_REPORT.md`](LAB_MEMORY_CORE_P1_REPORT.md), and
release mechanics are in [`RELEASE_ENGINEERING.md`](RELEASE_ENGINEERING.md).
