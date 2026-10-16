# Gate Memory Operations

This runbook covers the Gate SaaS PostgreSQL data only. It does not operate on
Lab/OpenClaw data, and it does not authorize a Gate-Local change by itself.
Migration, provider, M2, and Gate-Local candidate permissions remain separate.

## Before a schema or image change

1. Review the exact Gate source commit and the SQL under
   `apps/pubg-saas/src/infrastructure/postgres/migrations/`.
2. Run the Gate release verification against a disposable loopback PostgreSQL
   database. `scripts/release-gate.sh verify` refuses a missing, non-loopback,
   or production-named test database. CI has separate ordinary PostgreSQL and
   pgvector fixtures; missing fixture configuration is a failure.
3. Use the Gate backup tool with an external age recipient file and an
   independent owner-only output directory. Verify the encrypted archive and
   perform a restore into a newly named disposable database before a live
   migration. Keep the age identity outside Git with mode `0600`.
4. Run the migration through the guarded Gate release process. Do not invoke
   the application migrator against a real database as an ad hoc repair.
5. Keep the previous application image, the pre-change Compose file and
   `.env`, and the encrypted database checkpoint together. On an application
   rollback, keep the current database volume and use a forward repair if the
   schema has advanced. Do not restore an old volume over newer writes by
   default.

Migration `0025_gate_memory_pgvector.sql` is excluded from startup migration
execution. The normal PG18 image does not provide pgvector. Installing the
extension or replacing that database image is a separate high-risk operation;
the Gate-Local autopilot blocks it. It needs its own reviewed image, backup,
restore, and rollback procedure before it can be automated.

## Gate-Local candidate autopilot

Gate-Local has an independent source path and protected local approval. The
operator controls live outside Git at:

- `~/.config/amadeus/gate-local-auto-approval.json`
- `~/.config/amadeus/gate-local-m2-clearance.json`

Both are owner-only `0600` files in an owner-only `0700` directory. The
non-interactive enable command binds this checkout to one Gate-Local instance,
one Bot account, one OrbStack machine, external backup/encryption files, and
the two default risk categories: `reversible_app_candidate` and
`backward_compatible_schema`. Supply these non-secret fields in the invoking
process environment; no terminal prompt is used:

| Variable | Value |
| --- | --- |
| `GATE_LOCAL_INSTANCE_ID` | Bounded Gate-Local instance identifier |
| `GATE_LOCAL_BOT_ACCOUNT_ID` | The single authorized KOOK Bot account ID |
| `GATE_LOCAL_ORBSTACK_MACHINE` | The dedicated Gate-Local OrbStack machine |
| `GATE_LOCAL_BACKUP_ROOT` | Existing external directory, owner-only mode `0700` |
| `GATE_LOCAL_AGE_RECIPIENTS_FILE` | External age recipients file |
| `GATE_LOCAL_AGE_IDENTITY_FILE` | External age identity file, mode `0600` |
| `GATE_LOCAL_NOTIFICATION_HOOK` | Executable external Gate-private test notification hook |

The approval has no expiry and remains active until `gate-auto-disable` or a
protected state-file removal. A legacy `expiresAt` field is ignored. Malformed,
wrong-checkout, wrong-target, or unsafe-path records still fail closed. The
migration classifier continues to reject destructive or incompatible changes,
data mutations, extensions, and unrecognized SQL regardless of the default
authorization categories.

```sh
pnpm devctl configure status
pnpm devctl configure gate-auto-enable
```

`gate-auto-enable` can run directly from Codex or a script with those fields
present. It records the selected target and Gate-private notification hook.
Lab notification hooks are rejected so Gate cannot trigger the Lab owner
outbox. It does not clear the M2 pause or enable memory features. Missing or
invalid configuration is an error and writes no approval.

M2 is a separate human-acceptance gate. After the operator completes that
acceptance, the operator can record an indefinite local clearance with a
separate interactive command and evidence reference:

```sh
pnpm devctl configure gate-m2-clear
```

This command records an operator decision; it does not change a running
Gateway, Worker, Bot token, database, or M2 service. The clearance has no
expiry; `gate-m2-revoke` removes only that clearance, while
`gate-auto-disable` removes both Gate authorization records.

For a Gate-only phase, `pnpm devctl goal finish-phase P<N>` calls the protected
candidate route only when the local candidate approval and the independent
M2 clearance both match. The route re-runs Gate release verification and the
secrets scan, requires a clean committed tree, checks that the target machine
and Bot ID match, discovers the Compose project, working directory, and file
from the active Gateway container labels, rejects ambiguous or untrusted
layouts, duplicate Gateway/Worker processes, and runtime drift, builds a
SHA-tagged immutable local image, and confirms its image ID
after transfer. It writes a mode-`0700` external checkpoint containing the
prior Compose/env files and an encrypted public-schema PostgreSQL dump. The
dump is verified by decrypting it through `pg_restore --list` before the
migrator runs. The image/Compose switch waits for PostgreSQL, egress proxy,
Gateway KOOK-handshake readiness, and Worker health. Smoke probes are local
loopback requests and do not send a KOOK message. A failed health/smoke check
restores the prior application config and attempts an application rollback;
the current database volume is preserved. A private Gate notification hook
receives a small status object after health passes. Notification failure is
reported as `DEPLOYED_NOTIFICATION_FAILED`; it is never reported as fully
notified.

The adapter does not enable `GATE_MEMORY_READ_ENABLED`,
`GATE_MEMORY_WRITE_ENABLED`, `GATE_MEMORY_AUTO_LEARN_ENABLED`, or embedding
requests. It rejects Gate-Staging/Prod, mixed Lab/Gate source changes,
unreviewed control-plane changes, destructive schema changes, data-changing
migrations, unrecognized SQL statements, and extension/pgvector operations.
The migration classifier only auto-authorizes new tables, non-unique indexes,
nullable columns without defaults or constraints, reviewed-safe functions, and
`COMMENT ON` metadata. Unique indexes, defaulted or constrained columns, data
mutations, and destructive schema changes require separate authorization;
unknown syntax fails closed. A blocked candidate prints a fixed recovery step
for its reason. No target query, backup, image build, database migration, or
service switch is performed when approval or M2 clearance is missing.

To revoke M2 clearance without disabling Gate candidate authorization:

```sh
pnpm devctl configure gate-m2-revoke
```

To revoke Gate-Local candidate automation and M2 clearance together, remove
both local records:

```sh
pnpm devctl configure gate-auto-disable
```

## Scoped vector index rebuild

Migrations `0024`, `0028`, and `0029` provide the embedding outbox,
consent/admission records, and per-Bot index-generation state using ordinary
PostgreSQL types. Migration `0025` separately adds the optional vector table.
Complete the database migration and optional extension steps through the
reviewed release path before starting this index runbook.

Build the source and obtain `GATE_MEMORY_ADMIN_DATABASE_URL` from the
operator's protected secret store. Set `GATE_MEMORY_ADMIN_TARGET` to exactly
the same environment as `--target`; the URL and password are never command-line
arguments. The admin uses one Bot account at a time.

```sh
pnpm --filter @agent/pubg-saas build
export GATE_MEMORY_ADMIN_TARGET=gate-local
# Load GATE_MEMORY_ADMIN_DATABASE_URL from the protected secret store.
node apps/pubg-saas/dist/src/gate-memory-admin.js status \
  --target gate-local --bot-id "$GATE_BOT_ACCOUNT_ID"
```

All mutations require `--apply`. An omitted `--apply` prints a plan and exits
without connecting to PostgreSQL. Initialize the legacy index state at
generation 1 only when it is absent and the configured embedding contract is
the approved initial model/dimension/version:

```sh
node apps/pubg-saas/dist/src/gate-memory-admin.js initialize \
  --target gate-local --bot-id "$GATE_BOT_ACCOUNT_ID" --apply
```

For a shadow reindex, set the next monotonic
`GATE_MEMORY_EMBEDDING_INDEX_VERSION`, model ID, dimensions and provider
configuration using the separately approved Gate secret store. `begin` and
`scan` do not make provider calls. Each scan is one bounded page (default 50,
maximum 100) and has a local SQL `statement_timeout` of three seconds:

```sh
node apps/pubg-saas/dist/src/gate-memory-admin.js begin \
  --target gate-local --bot-id "$GATE_BOT_ACCOUNT_ID" --apply
node apps/pubg-saas/dist/src/gate-memory-admin.js scan \
  --target gate-local --bot-id "$GATE_BOT_ACCOUNT_ID" --scan-limit 50 --apply
```

Repeat the scan command until its result says `complete: true`. The scan
re-evaluates current memory scope and queues only valid current entries; it
does not truncate the corpus to recent rows. Then process a bounded number of
jobs. This is the first command in the sequence that can call the configured
embedding provider. It requires the independent embedding enable flag,
`--apply`, and `--allow-provider-requests`; the configured timeout, batch
limits, request/token budgets, and database daily budget still apply:

```sh
node apps/pubg-saas/dist/src/gate-memory-admin.js work \
  --target gate-local --bot-id "$GATE_BOT_ACCOUNT_ID" --max-jobs 20 \
  --apply --allow-provider-requests
```

Repeat bounded work runs while checking status and the fixed error codes. A
paused/failed generation can be resumed after its cause is corrected. Activate
only after the scan is complete and every currently valid memory has a vector
for the new contract:

```sh
node apps/pubg-saas/dist/src/gate-memory-admin.js status \
  --target gate-local --bot-id "$GATE_BOT_ACCOUNT_ID"
node apps/pubg-saas/dist/src/gate-memory-admin.js activate \
  --target gate-local --bot-id "$GATE_BOT_ACCOUNT_ID" --apply
```

`cancel` drops the in-progress generation pointer and stops its queued work;
it does not bulk-delete orphaned vectors. Do not delete old vector generations
until a separately reviewed retention/cleanup change has a verified backup.
The normal read path uses only the active contract and falls back to lexical
recall if vectors are unavailable. No worker or cron is enabled by this admin
tool.

## Limits and recovery

- Recall returns at most six entries by default and reserves a fixed context
  token budget; it does not discard old facts solely because they are old.
- Embedding uses a 10-second default timeout, one request at a time, batches
  of at most eight inputs, and explicit daily request/token ceilings. The
  provider's token usage is not assumed to equal the local UTF-8 byte estimate.
- Lexical search defaults to a 500 ms SQL timeout. Shadow scans, resume, and
  activation use a three-second transaction-local timeout.
- If a provider call times out, the job retries with bounded backoff and the
  daily reservation remains conservative for an unknown billed outcome.
- If the active index is intact, keep serving it while the shadow generation
  is paused or failed. Do not activate partial coverage. If the target schema
  is missing or incompatible, stop and use the encrypted checkpoint plus the
  reviewed migration recovery procedure; do not repair production SQL by hand.
