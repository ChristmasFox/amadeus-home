# M204 PUBG SaaS metrics relay acceptance

Date: 2026-10-14 (Asia/Shanghai)

## Scope and outcome

Commit `7f3b95b` built on OrbStack machine `nyannyan` as
`local/pubg-saas:git-7f3b95b`, image ID
`sha256:e52c734edc432eb5f9d84af9aa2c8086467f38146ec9dade75e26fe6b4c00d47`
(`linux/arm64`). The repository Compose unit now publishes only the dedicated
metrics relay on host loopback. The Worker remains on its internal PostgreSQL
and egress networks with no host port; the relay accepts only `GET /metrics`
and makes a fixed request to `worker:9464/metrics`.

A new isolated Compose project initialized PostgreSQL 18.1, applied all current
migrations and started a healthy Worker with an empty queue. From the M204
OrbStack host, `GET /metrics` returned HTTP 200 and included
`pubg_saas_worker_up 1`; a query-string path returned 404 and POST returned
405. Docker inspection confirmed the Worker had no host-port binding and
joined only `postgres_private` and `egress_internal`. The egress-proxy had the
loopback mapping `127.0.0.1:29465 -> 9465/tcp`.

The project stopped with ordinary `docker compose down`, retaining its
isolated volume. OpenClaw and 9Router IDs, start times, status and restart
counts matched immediately before and after the stop (both restart counts 0).
No Gateway, live KOOK session, PUBG request or model request was started. The
only provider configuration was copied from checked-in placeholder examples;
no credentials were read. No production database/configuration, private
OpenClaw runtime, 9Router setting, registry or cloud resource was touched.

The earlier full encrypted backup/restore and source/restore role-boundary
rehearsal remains recorded in
`.agent/checkpoints/2026-10-14-pubg-saas-m2-current-image-local-recovery.md`.
This relay-only change did not alter PostgreSQL migrations, backup tools,
restore logic or role grants, so that full restore was not repeated.

## Verification

- Focused relay, Worker health and metrics tests: 14/14 passed.
- `pnpm typecheck:pubg-saas`: passed.
- `pnpm typecheck:pubg`: passed.
- `pnpm test:pubg`: 68/68 passed.
- `pnpm check:architecture`, `pnpm check:secrets`, and `git diff --check`:
  passed.
- The full SaaS/PostgreSQL suite last passed 104/104 without skips on the
  reusable isolated PG18.6 fixture at the earlier current-source CI gate; that
  full suite was not repeated for this isolated HTTP relay delta.

## Reproduction

Build the exact committed source locally on M204. The build context uses the
repository `.dockerignore`, which excludes local env and secret files.

```sh
orb -m nyannyan -u root bash -lc 'cd /Users/nyannyan/amadeus-home && docker buildx build --progress=plain --load --resource memory=4g --resource cpu-quota=400000 -f apps/pubg-saas/Dockerfile -t local/pubg-saas:git-7f3b95b .'
orb -m nyannyan -u root docker image inspect local/pubg-saas:git-7f3b95b --format '{{.Id}} {{.Os}}/{{.Architecture}}'
```

Create a disposable stack directory on M204 from the checked-in examples. For
each rerun, choose a new `RUN_ID` and unused loopback ports; the recorded run
used project `pubg-saas-m2-relay-20261014-7f3b95b`, PG port 58435 and metrics
port 29465. The secrets below are fresh random placeholders, not provider
credentials.

```sh
orb -m nyannyan -u root bash -lc '
set -euo pipefail
REPO=/Users/nyannyan/amadeus-home
RUN_ID=unique-suffix
PROJECT=pubg-saas-m2-relay-$RUN_ID
STACK=/var/tmp/$PROJECT
PG_PORT=58436
METRICS_PORT=29466
mkdir -m 700 -p "$STACK/secrets"
cp "$REPO/infra/pubg-saas/compose.yaml" "$STACK/compose.yaml"
cp "$REPO/infra/pubg-saas/.env.example" "$STACK/.env"
cp -R "$REPO/infra/pubg-saas/postgres-init" "$STACK/postgres-init"
for name in gateway worker migrator; do
  cp "$REPO/infra/pubg-saas/$name.env.example" "$STACK/secrets/$name.env"
done
chmod 0600 "$STACK/.env" "$STACK"/secrets/*.env
sed -i "s|^PUBG_SAAS_COMPOSE_PROJECT=.*|PUBG_SAAS_COMPOSE_PROJECT=$PROJECT|; s|^PUBG_SAAS_IMAGE=.*|PUBG_SAAS_IMAGE=local/pubg-saas:git-7f3b95b|; s|^PUBG_SAAS_BACKUP_PG_PORT=.*|PUBG_SAAS_BACKUP_PG_PORT=$PG_PORT|; s|^PUBG_SAAS_WORKER_METRICS_PORT=.*|PUBG_SAAS_WORKER_METRICS_PORT=$METRICS_PORT|" "$STACK/.env"
umask 077
for name in postgres-superuser app migrator backup; do
  openssl rand -hex 32 > "$STACK/secrets/$name-password"
done
chmod 0444 "$STACK/secrets/"*-password
docker compose --project-name "$PROJECT" --project-directory "$STACK" --env-file "$STACK/.env" -f "$STACK/compose.yaml" config --quiet
docker compose --project-name "$PROJECT" --project-directory "$STACK" --env-file "$STACK/.env" -f "$STACK/compose.yaml" up -d --wait postgres egress-proxy
docker compose --project-name "$PROJECT" --project-directory "$STACK" --env-file "$STACK/.env" -f "$STACK/compose.yaml" --profile ops run --rm migrate
docker compose --project-name "$PROJECT" --project-directory "$STACK" --env-file "$STACK/.env" -f "$STACK/compose.yaml" up -d --wait worker
curl --fail --silent --show-error "http://127.0.0.1:$METRICS_PORT/metrics" | grep -Fx "pubg_saas_worker_up 1"
test "$(curl --silent --output /dev/null --write-out "%{http_code}" "http://127.0.0.1:$METRICS_PORT/metrics?probe=1")" = 404
test "$(curl --silent --output /dev/null --write-out "%{http_code}" --request POST "http://127.0.0.1:$METRICS_PORT/metrics")" = 405
WORKER=$(docker compose --project-name "$PROJECT" --project-directory "$STACK" --env-file "$STACK/.env" -f "$STACK/compose.yaml" ps -q worker)
NETWORKS=$(docker inspect "$WORKER" --format "{{json .NetworkSettings.Networks}}")
PORTS=$(docker inspect "$WORKER" --format "{{json .HostConfig.PortBindings}}")
case "$NETWORKS" in *public_egress*) exit 1;; esac
case "$NETWORKS" in *postgres_private*) ;; *) exit 1;; esac
case "$NETWORKS" in *egress_internal*) ;; *) exit 1;; esac
case "$PORTS" in null|"{}"|"") ;; *) exit 1;; esac
'
```

To reproduce the private-runtime stop check, take the read-only snapshot
immediately before stopping the disposable SaaS project, then compare it after
ordinary `down`:

```sh
orb -m nyannyan -u root bash -lc '
set -euo pipefail
RUN_ID=unique-suffix
PROJECT=pubg-saas-m2-relay-$RUN_ID
STACK=/var/tmp/$PROJECT
BEFORE=$(docker inspect openclaw 9router --format "{{.Name}}|{{.Id}}|{{.State.StartedAt}}|{{.RestartCount}}|{{.State.Status}}" | sort)
docker compose --project-name "$PROJECT" --project-directory "$STACK" --env-file "$STACK/.env" -f "$STACK/compose.yaml" down
AFTER=$(docker inspect openclaw 9router --format "{{.Name}}|{{.Id}}|{{.State.StartedAt}}|{{.RestartCount}}|{{.State.Status}}" | sort)
test "$BEFORE" = "$AFTER"
printf "PRIVATE_RUNTIME_SNAPSHOT=UNCHANGED\\n"
'
```

The full encrypted backup, fresh-PG restore, count comparison and permission
probe commands are recorded in
`.agent/checkpoints/2026-10-14-pubg-saas-m2-current-image-local-recovery.md`
and `infra/pubg-saas/BACKUP_RESTORE_REHEARSAL.md`.
