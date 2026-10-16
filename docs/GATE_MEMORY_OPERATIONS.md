# Gate Memory Operations

This runbook covers the Gate SaaS PostgreSQL data only. It does not operate on
Lab/OpenClaw data or authorize Gate-Staging/Prod changes. Gate-Local candidate
authorization is repo-wide and standing; formal-release and M2 clearance remain
separate. A Gate-Local candidate does not clear or resume M2.

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
   environments, and the encrypted database checkpoint together. The guarded
   Gate-Local candidate restores the encrypted checkpoint with the previous
   application configuration when migration or health checks fail.

Migration `0025_gate_memory_pgvector.sql` is excluded from startup migration
execution. The normal PG18 image does not provide pgvector. Installing the
extension or replacing that database image remains outside this candidate
path.

## Gate-Local candidate autopilot

Gate-Local has a protected host authorization shared by every linked worktree
through the Git common directory. The owner-only record lives outside Git at:

- `~/.config/amadeus/gate-local-auto-approval.json`
- `~/.config/amadeus/gate-local-m2-clearance.json`

`gate-local-auto-approval.json` is an owner-only `0600` file in an owner-only
`0700` directory. It binds this repository to one Gate-Local instance, one Bot
account, one OrbStack machine, external backup/encryption files, and the private
Gate notification hook. Arthur granted standing authorization: there is no
per-worktree opt-in or interactive confirmation, and the record has no expiry.
`gate-auto-disable` revokes it. The separate M2 clearance file is reserved for
formal release and remains untouched by candidate deployments. The record's
host configuration originated from these non-secret fields:

| Variable | Value |
| --- | --- |
| `GATE_LOCAL_INSTANCE_ID` | Bounded Gate-Local instance identifier |
| `GATE_LOCAL_BOT_ACCOUNT_ID` | The single authorized KOOK Bot account ID |
| `GATE_LOCAL_ORBSTACK_MACHINE` | The dedicated Gate-Local OrbStack machine |
| `GATE_LOCAL_BACKUP_ROOT` | Existing external directory, owner-only mode `0700` |
| `GATE_LOCAL_AGE_RECIPIENTS_FILE` | External age recipients file |
| `GATE_LOCAL_AGE_IDENTITY_FILE` | External age identity file, mode `0600` |
| `GATE_LOCAL_NOTIFICATION_HOOK` | Executable external Gate-private test notification hook |

Linked worktrees match with `git rev-parse --git-common-dir`; unrelated
repositories, wrong targets, malformed records, and unsafe external paths still
fail closed. The Gate authorization does not enable memory features or clear
the M2 pause.

M2 is a separate human-acceptance gate. Safe Gate-Local candidates do not
require M2 clearance and leave the M2 pause unchanged. M2 clearance is reserved
for a future formal release. After the operator completes M2 acceptance, the
operator can record an indefinite local clearance with a separate interactive
command and evidence reference:

```sh
pnpm devctl configure gate-m2-clear
```

This command records an operator decision; it does not change a running
Gateway, Worker, Bot token, database, or M2 service. The clearance has no
expiry; `gate-m2-revoke` removes only that clearance, while
`gate-auto-disable` removes both Gate authorization records.

For a Gate-only phase, `pnpm devctl goal finish-phase P<N>` uses the protected
candidate route after validation. It requires a clean committed tree, checks
the target machine and Bot ID, discovers Compose from the active Gateway
labels, enforces one Gateway and Worker, builds a SHA-tagged immutable local
image, and verifies the transferred image config and rootfs layers.

Every candidate first saves the prior Compose, application environment, and
Gateway environment in a mode-`0700` external checkpoint, then creates and
authenticates a full encrypted PostgreSQL dump. The checkpoint records the
encrypted size, SHA-256, and `pg_restore --list` entry count; no plaintext dump
is retained. Migration deltas are compared with the active image's source SHA.
Destructive database SQL emits a prominent warning after backup and proceeds
automatically. A failed migration or post-switch health/smoke check stops
Gateway and Worker, restores the full database checkpoint and previous
Compose/environment files, then restarts the previous application image.

The canary path selects exactly one tenant marked test/fixture/canary for the
Gate Bot, writes the ID only to the protected Gateway environment, and prints
only a redacted status. If selection is absent or ambiguous, deployment stops
before backup or migration. The canary sets only
`GATE_PUBG_INTELLIGENCE_ENABLED=1` and the exact one-tenant allowlist. Existing
Gate tenant authorization and bounded PostgreSQL reads remain in force. Health
checks cover PostgreSQL, egress, Gateway, and Worker, followed by local health
probes. The private Gate notification hook receives a small status object.
Notification failure is reported as `DEPLOYED_NOTIFICATION_FAILED`.

M2 remains PAUSED; candidate deployment does not create or modify an M2
clearance. `GATE_MEMORY_READ_ENABLED`, `GATE_MEMORY_WRITE_ENABLED`, and
`GATE_MEMORY_AUTO_LEARN_ENABLED` remain independent capability flags. This path
does not target Gate-Staging/Prod or Lab.

To recover data from the encrypted full-database checkpoint, decrypt it and
stream it to `pg_restore` targeting a newly named, empty recovery database.
Verify the restored database there before any operator-approved connection
change. Do not overwrite the active database or replace its PostgreSQL volume
as a manual recovery action; the guarded candidate rollback restores its
verified encrypted checkpoint before restarting the prior application image.

To revoke a future formal-release M2 clearance without disabling Gate candidate
authorization:

```sh
pnpm devctl configure gate-m2-revoke
```

To revoke Gate-Local candidate automation and any M2 clearance together, remove
both local records:

```sh
pnpm devctl configure gate-auto-disable
```

## Automatic memory learning and Deep promotion

Light and REM persist short-lived candidates with provenance; neither stage
writes ordinary chat directly into long-term memory. REM can merge repeated
same-key, same-value observations while retaining only current, consent-scoped
DM source IDs. Deep rechecks the active consent, source admissions, direct
speaker identity, transcript expiry, candidate content against its source, and
the sensitive/third-party/prompt-injection filters before considering a write.

Deep uses a deterministic policy. A single observation is never sufficient;
the source reliability must be at least 80, evidence must be no older than 30
days, and at least two distinct observations are required. Promotion then
requires either repetition on at least two UTC dates or at least two distinct
recall queries plus a successful-use signal. Unresolved competing values,
weak sources, stale evidence, and prohibited content fail closed. Candidate
kind sets the score threshold; a high planner confidence alone is not part of
the promotion decision. A correction against a current value receives a score
penalty and must still match the captured revision with compare-and-set. A
qualifying correction advances that revision and queues the configured
embedding generations.

An existing forget tombstone is an absolute barrier to automatic promotion.
Explicit remember/correct remains the immediate, user-confirmed path. Recall
and use signals remain query-text-free and expire according to their schema.
The P4 Gateway scheduler waits for the next 03:00 in
`GATE_MEMORY_DREAMING_TIMEZONE` (defaults to `Asia/Shanghai`) and runs Light,
REM, then Deep once. It does not catch up a missed run at startup. A
content-free PostgreSQL claim keyed by Bot, timezone, and local date prevents
duplicate runs across concurrent Gateway instances. A failed run records only
a fixed error code and is retried at the next scheduled date. The scheduler
runs only when Gate automatic learning is enabled; it does not enable any
memory or embedding feature flag.

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
pnpm build:pubg-saas
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
jobs. This is the first admin command in the sequence that can call the configured
embedding provider. It requires `--apply` and `--allow-provider-requests`; the provider is capability-detected
from complete Gate embedding configuration. The configured timeout, batch limits,
request/token budgets, and database daily budget still apply:

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
recall if vectors are unavailable. The admin tool itself creates no scheduler.
The running Gateway owns the bounded daily Light/REM/Deep scheduler; index
administration remains separate.

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
