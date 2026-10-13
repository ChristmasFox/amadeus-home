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

- Python 3.10 or newer.
- `age`, `pg_dump`, `pg_restore`, `psql`, `createdb`, and `dropdb` installed on
  the operator host. Use PostgreSQL client tools at the same major version as
  the server where possible, and never older than the server.
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
