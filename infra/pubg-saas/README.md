# Public PUBG SaaS Compose unit

This folder is the independently movable public KOOK SaaS deployment unit. It
contains no private Kurisu/OpenClaw mount, secret, network, or runtime
dependency. PostgreSQL has no published port and sits on an internal network;
only the gateway and public sync worker join the separate outbound bridge.

The outbound bridge is **not** an egress firewall. Before real credentials are
installed, the host/cloud network policy must deny loopback, RFC1918, link-local
and cloud metadata destinations and allow only the required KOOK, PUBG and
approved inference endpoints. Docker's default bridge does not prove that
boundary. The M2 egress test and real M204 resource measurement are still open.

## Build an immutable local image

Build from the Git checkout and tag the image with its full source commit. The
Node base image digest in the Dockerfile is a multi-platform manifest verified
for Linux amd64 and arm64. The Compose file deliberately has no `build:` entry,
so `up` cannot silently build a different source tree.

```sh
commit="$(git rev-parse HEAD)"
image="local/pubg-saas:git-${commit}"
docker build -f apps/pubg-saas/Dockerfile -t "$image" .
```

For an ARM64 or amd64 Linux builder, select the target platform explicitly. A
multi-platform registry publication is a separate release action and is not
part of these local source checks.

## Prepare a disposable test stack

Run only with an isolated test KOOK bot, independent test PUBG API key, and a
public inference endpoint approved for the test. Do not reuse Kurisu tokens,
private 9Router credentials, production guild data, or the private SQLite.

```sh
cd infra/pubg-saas
cp .env.example .env
mkdir -m 700 -p secrets
chmod 700 secrets
umask 077
for name in postgres-superuser-password app-password migrator-password backup-password; do
  openssl rand -hex 32 > "secrets/$name"
done
chmod 0444 secrets/*-password
cp gateway.env.example secrets/gateway.env
cp worker.env.example secrets/worker.env
cp migrator.env.example secrets/migrator.env
```

Edit `.env` so `PUBG_SAAS_IMAGE` exactly matches the image built above. Replace
the placeholders in the three `secrets/*.env` files with isolated test values.
Keep `PUBG_SAAS_DATABASE_PASSWORD_FILE` pointing at the matching mounted
Compose secret. Compose file-backed secrets are bind mounts, so their mode
settings are not portable; the password files use mode `0444` inside a
host-only mode `0700` secrets directory. The entrypoint reads the password file
and constructs the PostgreSQL URL in memory; the password is not part of the
checked-in config or the Compose service environment. Keep the env files at
mode `0600` because Compose reads those values into the process environment.

Validate the rendered configuration, apply schema migrations to this isolated
database, and then start the public processes:

```sh
docker compose --env-file .env config --quiet
docker compose --env-file .env run --rm migrate
docker compose --env-file .env up -d gateway worker
docker compose --env-file .env ps
```

The migration service uses a separate non-superuser role. The gateway and
worker use a DML-only role; the backup role is read-only. PostgreSQL roles are
created on the first initialization of a **new** data volume. This init script
does not retrofit an existing database volume. Do not delete an existing volume
to make initialization rerun; use a separately reviewed migration for existing
data.

The stack publishes no inbound port. KOOK connectivity is an outbound WebSocket
connection. `docker compose down` stops this Compose project and preserves its
PostgreSQL volume. Never use `down -v` for a database that contains data.

## Backup and independent restore

The backup tool and its public-schema-only scope are documented in
[`BACKUP_RESTORE_REHEARSAL.md`](BACKUP_RESTORE_REHEARSAL.md). Run it on a
protected operator/recovery host with `age` and PostgreSQL client tools, using
the `pubg_backup` read-only role for `PUBG_SAAS_DATABASE_URL`. Keep encrypted
archives and age identities outside Git and outside the public Compose volume.
Restore only to a clean, isolated PostgreSQL instance with the disposable target
guard. Record RPO/RTO and public/private independence evidence before launch.

The Compose source and local rendered-config check do not prove a real
encrypted backup, clean-host restore, egress policy, cloud independence, KOOK
quota eligibility, or M204 capacity. Those remain explicit M2/P6 acceptance
gates.
