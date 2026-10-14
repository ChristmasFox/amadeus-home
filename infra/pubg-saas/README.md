# Public PUBG SaaS Compose unit

This folder is the independently movable public KOOK SaaS deployment unit. It
contains no private Kurisu/OpenClaw mount, secret, network, or runtime
dependency. PostgreSQL sits on an internal network; Compose requests a
host-loopback port for the read-only scheduled backup role. The gateway and
worker join only the internal PostgreSQL and proxy networks. A dedicated
`egress-proxy` is the sole service attached to the outbound bridge; its
HTTPS-only CONNECT handler resolves each target itself and denies loopback,
private, link-local, reserved and known metadata address ranges. Node's global
Undici dispatcher sends both HTTPS requests and WSS connections through it.
The database port binds to `127.0.0.1` where the host runtime supports
publishing a port on an internal network. OrbStack may leave that mapping
inactive; local rehearsals should use the `docker compose exec` adapter in
[`BACKUP_RESTORE_REHEARSAL.md`](BACKUP_RESTORE_REHEARSAL.md) instead of
weakening the database network boundary. The database is never bound to a LAN
address.

The outbound bridge is **not** an egress firewall; only the proxy can reach it.
Application containers have no default route, and the proxy rejects CONNECTs
to non-public addresses before opening an upstream socket. The proxy permits
public HTTPS destinations rather than enforcing a hostname allowlist, so the
configured model URL and application endpoint validation remain part of the
boundary. The available local OrbStack ARM64 Compose rehearsal verified no
application default route, direct metadata denial, proxy denial for
`host.docker.internal` and metadata, and an unauthenticated HTTPS HEAD through
the proxy. Clean Linux/cloud repetition and M204 resource measurement remain
open.

## Worker alert signals

Each structured `pubg_saas_sync_cycle` log includes identifier-free alert codes
for unavailable queue telemetry, a due-job age of at least 15 minutes, expired
leases, failed team syncs, and worker RSS at or above 80% of its 2 GiB Compose
memory limit. These are early-warning signals, not SLOs or automatic admission
controls. Docker health checks cover worker liveness and PostgreSQL readiness.
Host log collection, alert delivery and canonical-host thresholds are not
installed or verified; configure a host-owned log/alert route before launch.

Worker also exposes aggregate Prometheus text metrics at `/metrics` on container
port `9464`, published by Compose only on host loopback. Scrape it locally with
`curl http://127.0.0.1:${PUBG_SAAS_WORKER_METRICS_PORT:-9464}/metrics`. The
metrics contain process memory, pool/queue gauges, process-lifetime sync
counters and alert-code counts; they do not include tenant, guild, team, player
or actor labels. Counters reset when that Worker process restarts. Health remains
on its separate container-loopback `/healthz` endpoint.

On M204's OrbStack machine, Docker reported the loopback port binding, and the
container endpoint returned 200, but a request to the host-published port
returned 502. The cause is not established, so host-side scraping remains
unverified on OrbStack. Do not connect the Worker to the public egress network
to work around it; use `docker compose exec worker` for an in-container check.

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

No service publishes a LAN/public port. KOOK connectivity is an outbound
WebSocket connection. PostgreSQL's loopback-only port exists for the read-only
host backup job; it does not expose the database to the LAN. `docker compose down`
stops this Compose project and preserves its PostgreSQL volume. Never use
`down -v` for a database that contains data.

## Public AI planner benchmark

`apps/pubg-saas/tests/nl-query-provider.benchmark.ts` runs the configured AI SDK
planner against 100–200 benchmark cases sequentially. The JSON file must be
outside the repository, owner-only (`0600`), and contain only deidentified
prompts with reference plans based on the shared Domain/Kurisu query behavior.
It accepts this case shape:

```json
{
  "version": 1,
  "cases": [
    {
      "caseId": "team-today-kills-01",
      "message": "今天队伍一共淘汰多少人？",
      "expectedPlan": {
        "version": 1,
        "intent": "team_stats",
        "subject": "team",
        "playerName": null,
        "actorName": null,
        "victimName": null,
        "metric": "kills",
        "period": "today",
        "comparePeriod": null,
        "matchCount": null,
        "needsClarification": false
      }
    }
  ]
}
```

Set `PUBG_SAAS_PROMPT_BENCHMARK_FILE` and
`PUBG_SAAS_PROMPT_BENCHMARK_REPORT` to separate protected files outside Git,
then load `MODEL_BASE_URL`, `MODEL_ID`, and `MODEL_API_KEY` from the public
inference provider's test credentials and run:

```sh
pnpm --filter @agent/pubg-saas exec tsx tests/nl-query-provider.benchmark.ts
```

Each request has a 45-second abort timeout, one invocation and no retry. The
mode-0600 report records exact/field accuracy, fallback count, latency P50/P95,
and token use without writing raw prompts or extracted player names. This
planner-only benchmark does not replace Domain/executor, database authorization,
or full KOOK acceptance. No live provider benchmark has been run.

## Backup and independent restore

The backup tool and its public-schema-only scope are documented in
[`BACKUP_RESTORE_REHEARSAL.md`](BACKUP_RESTORE_REHEARSAL.md). Run it on a
protected operator/recovery host with `age` and PostgreSQL client tools, using
the `pubg_backup` read-only role for `PUBG_SAAS_DATABASE_URL`. Keep encrypted
archives and age identities outside Git and outside the public Compose volume.
Restore only to a clean, isolated PostgreSQL instance with the disposable target
guard. Record RPO/RTO and public/private independence evidence before launch.

The source includes a six-hour UTC `systemd` timer and job script. For an
operator-approved host setup, copy
[`backup.env.example`](backup.env.example) to `/etc/pubg-saas/backup.env`, set
its database URL with a URL-encoded `pubg_backup` password, point the output to
an independent encrypted-storage mount, and install the service/timer examples
from `systemd/` after replacing the service's `ExecStart` placeholder with this
checkout's source path. Create the `pubg-saas-backup` system user/group and make
the encrypted-storage directory owner-only and writable by it; keep
`/etc/pubg-saas/backup.env` root-owned with mode `0600`. Enable the timer only
as part of an approved host apply. The job creates an encrypted snapshot and
prunes only complete, matching backup/manifest pairs older than at least seven
days; pruning requires the exact output-directory guard. The env file and
recipient file stay outside Git. This source has not been installed or
scheduled on M204.

The Compose source and local rendered-config check do not prove a real
encrypted backup, clean-host restore, egress policy, cloud independence, KOOK
quota eligibility, or M204 capacity. Those remain explicit M2/P6 acceptance
gates.

### KOOK outbound message quota

The gateway reserves one durable daily send slot in PostgreSQL before each
channel or direct-message API call. The window resets at 12:00
Asia/Shanghai, matching KOOK's documented quota reset. The default
`KOOK_DAILY_MESSAGE_BUDGET=200` is a conservative per-SaaS-bot ceiling; raise
it only after verifying bot eligibility and allocating a safe share of the
developer-account-wide quota. The application cannot observe sends made by
other bots outside this database. Explicit KOOK rejections and 429 responses
release the reservation; ambiguous network failures retain it until the
window rolls over so retries cannot exceed the local budget.

KOOK currently documents a 10,000-message daily cap across a developer
account's bots, with a lower 200-message bot limit for accounts that are not
verified. See [message quota](https://developer.kookapp.cn/doc/http/message)
and [developer policy eligibility](https://developer.kookapp.cn/doc/privacy).
The live account's eligibility and remaining shared quota still require
operator verification before public capacity is claimed.

The published developer policy also lists these eligibility ceilings:
unverified accounts can create one bot, invite it to one server they created,
and make 60 API calls per minute; verified accounts can create unlimited bots,
invite a bot to up to 10,000 servers, and make 240 API calls per minute. The
message endpoint reference describes the separate 10,000-message daily
developer-account aggregate (all bots), reset at 12:00 Asia/Shanghai. Failed
sends do not count, temporary messages are excluded, and a first reply within
five minutes receives a quota discount. The SaaS reserves a full local slot
for every send, which is conservative for that discount, but cannot see
traffic from sibling bots. Before serving more than one test guild or raising
the 200-send default, verify the developer account's real-name status, server
eligibility, rate threshold, other bot traffic, and the share allocated to this
SaaS bot. The policy page displays an update date of 2024-01-29, so confirm it
again during release review.

PUBG's developer FAQ currently describes 10 requests/minute as a
testing/development default only. A launch key needs an approved higher limit
based on the documented use; no live API-rate compliance or launch quota is
claimed by the synthetic benchmark. See the [PUBG Developer FAQ](https://developer.pubg.com/faq).

At the Goal's optional baseline of 200 teams × 30 user queries/team/day, one
reply per query would require up to 6,000 locally reserved sends/day. The
current 200-send default and the published unverified per-bot allowance cannot
support that workload. Verified-account eligibility and an allocated share
under the published 10,000/day account aggregate are required; sibling bots,
management replies and other outbound events consume that same share. KOOK's
first-reply discount may reduce the platform's actual debit, but the SaaS
intentionally reserves a full local slot and does not rely on that discount.
This is quota arithmetic from the stated workload, not a live eligibility or
API-capacity result.
