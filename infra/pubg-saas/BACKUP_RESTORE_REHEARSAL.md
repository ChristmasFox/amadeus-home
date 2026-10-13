# PUBG SaaS PostgreSQL backup and restore rehearsal

This runbook covers only the public SaaS PostgreSQL `public` schema. The
tooling does not read or archive private Kurisu SQLite/OpenClaw state, 9Router
state, application secrets, or container volumes. It does not deploy, start a
service, or choose a production database by default.

The backup artifact is encrypted with `age` before it leaves a temporary
owner-only directory. Keep both the encrypted artifact and manifest on external
storage. Store the `age` private identity outside Git with mode `0600` or
stricter; the backup host only needs an external recipients file containing one
or more `age1...` public recipients.

## Requirements

- Python 3.10 or newer and `age` installed on the operator host.
- Either native `pg_dump`, `pg_restore`, `psql`, `createdb`, and `dropdb`
  clients at the same major version as PostgreSQL (never older), or the local
  Compose-only client adapter below with the pinned PG 18.1 container.
- A source PostgreSQL role able to read every SaaS table in `public`.
- A separate restore PostgreSQL instance and role that can create and drop
  databases and assume `pubg_migrator`. The target cluster must already have
  `pubg_migrator`, `pubg_app`, and `pubg_backup` roles from its independent
  public-service secret/bootstrap bundle. Do not point restore at a production
  server. Restore creates a new database and refuses any existing target.
- `PUBG_SAAS_DATABASE_URL` and `PUBG_SAAS_RESTORE_ADMIN_URL` supplied by an
  external secret store or protected shell environment. These values are not
  accepted as command-line arguments and are never printed by the tool.

The URLs must be explicit `postgresql://` URIs with a host, port, user, and
database. The restore admin URL names its maintenance database, commonly
`postgres`. It must use a PostgreSQL superuser or equivalent role that can
create a database and `SET ROLE pubg_migrator`. TLS options such as `sslmode`
may be supplied in the URL. The source backup role must be able to read all
public base tables.

### Local Compose-only client transport

On OrbStack, a host-loopback publication may not be active for a PostgreSQL
container on Compose's `internal: true` network. For a local rehearsal, keep the
database on that internal network and route PostgreSQL client commands through
the checked-in `scripts/pubg-saas-compose-pg-tool.py` adapter. It accepts only
an explicitly named `pubg-saas-m2-*`, `pubg-saas-local-*`, or
`pubg-saas-test-*` project whose PostgreSQL container uses the pinned PG 18.1
image, internal project-owned networks and project-owned volume. It rejects
external database hosts and non-loopback published ports. The adapter stages a
temporary mode-0600 pgpass file in the container's `/tmp` tmpfs and removes it
after each command; passwords never appear in Docker arguments. This adapter
is for local drills. The normal host backup mode remains available for a
protected recovery host with native PostgreSQL client tools.

For the source and restore Compose project directories, render the same
file-backed secrets and `.env` described in the main Compose README. Create
temporary client-tool symlinks outside the repository:

```sh
tool_dir="$(mktemp -d)"
for name in psql pg_dump pg_restore createdb dropdb; do
  ln -s "$PWD/scripts/pubg-saas-compose-pg-tool.py" "$tool_dir/$name"
done
export PATH="$tool_dir:$PATH"
export PUBG_SAAS_PG_EXEC_PROJECT='pubg-saas-m2-source-20261014'
export PUBG_SAAS_PG_EXEC_COMPOSE_FILE='/path/to/source/compose.yaml'
export PUBG_SAAS_PG_EXEC_ENV_FILE='/path/to/source/.env'
export PUBG_SAAS_DATABASE_URL='postgresql://pubg_backup:<URL-encoded-test-password>@postgres:5432/pubg_saas'
```

Run the existing `backup` and `verify` commands below. Before restore, point
the three `PUBG_SAAS_PG_EXEC_*` values at the distinct fresh restore project,
and set `PUBG_SAAS_RESTORE_ADMIN_URL` to that isolated container's bootstrap
role URL. Keep these URLs in an owner-only environment file or secret manager;
do not paste credentials into shared shell history or logs. The source and
restore projects must have unique project names and volumes.

For a permission rehearsal, load the test passwords from the protected
Compose secret files into `PUBG_SAAS_BOOTSTRAP_PASSWORD`,
`PUBG_SAAS_APP_PASSWORD`, and `PUBG_SAAS_BACKUP_PASSWORD` without printing
them. The client adapter uses these values only in its child process
environment and transfers them over stdin to the temporary container pgpass.
After migration, seed a synthetic source tenant, team, queue row and future
sequence:

```sh
export PGHOST=postgres PGPORT=5432 PGDATABASE=pubg_saas
PGUSER=pubg_bootstrap PGPASSWORD="$PUBG_SAAS_BOOTSTRAP_PASSWORD" psql -X -v ON_ERROR_STOP=1 --command \
  "SET ROLE pubg_migrator; CREATE SEQUENCE public.rehearsal_future_seq; RESET ROLE; INSERT INTO tenants(tenant_id,platform,bot_account_id,guild_id) VALUES ('m2-local-fixture','kook','local-test-bot','local-test-guild'); INSERT INTO teams(tenant_id,team_id,label,pubg_shard) VALUES ('m2-local-fixture','m2-local-team','M2 local rehearsal','steam'); INSERT INTO public_sync_jobs(tenant_id,team_id) VALUES ('m2-local-fixture','m2-local-team');"
```

Verify app DML in a transaction that is rolled back, then require app DDL to
fail. Require backup table/sequence reads to succeed and backup DML/`nextval`
to fail; app `nextval` must succeed:

```sh
PGUSER=pubg_app PGPASSWORD="$PUBG_SAAS_APP_PASSWORD" psql -X -v ON_ERROR_STOP=1 --command \
  "BEGIN; INSERT INTO teams(tenant_id,team_id,label,pubg_shard) VALUES ('m2-local-fixture','rollback-probe','temporary','steam'); UPDATE teams SET label='updated' WHERE tenant_id='m2-local-fixture' AND team_id='rollback-probe'; DELETE FROM teams WHERE tenant_id='m2-local-fixture' AND team_id='rollback-probe'; ROLLBACK;"
! PGUSER=pubg_app PGPASSWORD="$PUBG_SAAS_APP_PASSWORD" psql -X -v ON_ERROR_STOP=1 --command "CREATE TABLE public.app_ddl_must_fail(id integer);"
PGUSER=pubg_backup PGPASSWORD="$PUBG_SAAS_BACKUP_PASSWORD" psql -X -v ON_ERROR_STOP=1 --command "SELECT count(*) FROM tenants; SELECT last_value FROM public.rehearsal_future_seq;"
! PGUSER=pubg_backup PGPASSWORD="$PUBG_SAAS_BACKUP_PASSWORD" psql -X -v ON_ERROR_STOP=1 --command "INSERT INTO tenants(tenant_id,platform,bot_account_id,guild_id) VALUES ('backup-write-must-fail','kook','x','y');"
! PGUSER=pubg_backup PGPASSWORD="$PUBG_SAAS_BACKUP_PASSWORD" psql -X -v ON_ERROR_STOP=1 --command "SELECT nextval('public.rehearsal_future_seq');"
PGUSER=pubg_app PGPASSWORD="$PUBG_SAAS_APP_PASSWORD" psql -X -v ON_ERROR_STOP=1 --command "SELECT nextval('public.rehearsal_future_seq');"
```

Run the same permission probes against the restored disposable database after
changing `PGDATABASE` to its guarded target name. First create a new sequence
as the migration role to verify restored default privileges:

```sh
PGUSER=pubg_bootstrap PGPASSWORD="$PUBG_SAAS_BOOTSTRAP_PASSWORD" psql -X -v ON_ERROR_STOP=1 --command \
  "SET ROLE pubg_migrator; CREATE SEQUENCE public.rehearsal_restore_future_seq; RESET ROLE;"
PGUSER=pubg_backup PGPASSWORD="$PUBG_SAAS_BACKUP_PASSWORD" psql -X -v ON_ERROR_STOP=1 --command \
  "SELECT last_value FROM public.rehearsal_restore_future_seq;"
```

The backup utility itself already compares every public base-table row count
with the encrypted manifest.

## Create and verify an encrypted backup

Use an external directory with owner-only permissions. The script refuses a
directory inside the Git repository, a symlink, or a directory accessible to
group/other users.

```sh
umask 077
mkdir -m 700 -p /path/on/external-storage/pubg-saas

# Load this from the host's secret manager before invoking the command.
: "${PUBG_SAAS_DATABASE_URL:?load the SaaS PostgreSQL URL from the secret store}"

python3 scripts/pubg-saas-backup-restore.py backup \
  --recipients-file /path/outside/repo/age-recipients.txt \
  --output-dir /path/on/external-storage/pubg-saas
```

The script confirms required SaaS tables exist, opens one exported PostgreSQL
snapshot, captures exact counts for every public base table, and passes the same
snapshot to `pg_dump --schema=public`. It encrypts the custom archive with
`age`, writes a SHA-256 checksum and counts to a separate manifest, then removes
the temporary plaintext dump before returning.

Copy the `.dump.age` artifact and matching `.manifest.json` to the separate
recovery host/storage location. On a host with the external identity file,
verify its checksum, decryptability, and PostgreSQL archive structure before
restoring:

```sh
artifact='/path/on/external-storage/pubg-saas/exact-file.dump.age'
manifest='/path/on/external-storage/pubg-saas/exact-file.manifest.json'

python3 scripts/pubg-saas-backup-restore.py verify \
  --artifact "$artifact" \
  --manifest "$manifest" \
  --identity-file /path/outside/repo/age-identity.txt
```

## Clean-host restore rehearsal

Provision a clean, isolated PostgreSQL instance on the recovery host. Supply
its explicit admin URL from a protected environment. The target name must start
with `pubg_saas_disposable_`, and the confirmation argument must repeat the
name exactly. The tool refuses production-like names, an existing database,
and a target that matches the backup's source database.

```sh
: "${PUBG_SAAS_RESTORE_ADMIN_URL:?load the isolated restore PostgreSQL URL from the secret store}"
target='pubg_saas_disposable_restore_20261013_01'
artifact='/path/on/external-storage/pubg-saas/exact-file.dump.age'
manifest='/path/on/external-storage/pubg-saas/exact-file.manifest.json'

python3 scripts/pubg-saas-backup-restore.py restore \
  --artifact "$artifact" \
  --manifest "$manifest" \
  --identity-file /path/outside/repo/age-identity.txt \
  --target-database "$target" \
  --confirm-disposable-target "$target" \
  --apply
```

Restore decrypts into an owner-only temporary directory, checks the custom
archive, and creates a fresh `template0` database owned by `pubg_migrator`. It
omits the archive's `CREATE SCHEMA public` TOC entry because PostgreSQL creates
that schema in a new database already, then restores the public tables and data
as `pubg_migrator`. It grants runtime DML and backup read access and records
matching default privileges for future migrations. It compares every public
base-table row count with the manifest. The new database receives a specific
disposable marker. If a restore fails after the database was created, the
marked database is left in place for diagnosis; it is never automatically
overwritten or dropped.

## Record a synthetic RPO/RTO

The manifest records `snapshotRequestedAtUtc` immediately before opening the
exported PostgreSQL snapshot. It is a conservative timestamp for the recovery
point; `createdAtUtc` records when encryption and manifest creation completed.
For a rehearsal, record the simulated failure time immediately before restore
starts and subtract `snapshotRequestedAtUtc`. The result is the snapshot age at
that failure point. Do not use `createdAtUtc` for RPO; it is later than the
database snapshot.

Measure database restore time from the start of the guarded `restore` command
until its table-count comparison succeeds. Also measure end-to-end recovery
time from the simulated failure point until the restored Worker passes its
Compose health check (`docker compose up -d --wait worker`). State whether the
Gateway and real KOOK/PUBG/model providers were included. A small synthetic
fixture measures recovery mechanics only; it does not establish a production
RPO/RTO or capacity target. The snapshot request time is optional when reading
older v1 manifests, which predate this field.

When the rehearsal is complete, remove only the marked disposable database.
This has a separate exact-name confirmation and explicit `--apply` guard:

```sh
python3 scripts/pubg-saas-backup-restore.py cleanup \
  --target-database "$target" \
  --confirm-disposable-target "$target" \
  --apply
```

Cleanup verifies the database comment marker before calling `dropdb`. It will
not drop an unmarked database. Keep the encrypted archive and manifest until
the clean-host restore and count comparison both pass.

## Local synthetic checks

The unit fixtures exercise checksum/manifest validation, public-schema naming,
explicit disposable-target confirmations, connection URI handling, and the
refusal to use repository paths. They do not connect to PostgreSQL or invoke
`age`:

```sh
python3 -m unittest discover -s scripts/tests -p 'test_pubg_saas_backup_restore.py' -v
```

The clean-host commands above are the reproducible operational rehearsal. A
successful synthetic test is not evidence that a real encrypted backup or
recovery host has been exercised.
