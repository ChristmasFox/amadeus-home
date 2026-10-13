# PUBG SaaS M2 local container and recovery rehearsal

Date: 2026-10-14 (Asia/Shanghai)

## Scope and safety boundary

This rehearsal used only two new, uniquely named local Compose projects with
fresh PostgreSQL 18.1 containers and volumes. The source project applied
migrations through `0011`, started the public sync worker against an empty
queue, and ran the gateway in its side-effect-free dry-run mode. No real KOOK,
PUBG or model credentials were loaded; local placeholders were used for the
no-call startup. The pre-existing `pubg-saas-pg18` test
fixture was left running and untouched. No production database, private
OpenClaw, 9Router or deployed service was read or changed.

The local ARM64 image was built from the SaaS image source at `66941c2`:

```sh
docker buildx build --platform linux/arm64 --load \
  -f apps/pubg-saas/Dockerfile \
  -t local/pubg-saas:git-66941c2 .
```

Image digest: `sha256:bdce2f6f5cdce21d07ee87d7787987ee93da37666e6793e2bb3ab36541cdbaf7`.
The image was not pushed. The temporary Compose project files and random test
passwords were outside Git with owner-only permissions.

The applied local Compose steps followed `infra/pubg-saas/README.md`:

```sh
docker compose --project-directory "$STACK" --env-file "$STACK/.env" \
  -f "$STACK/compose.yaml" config --quiet
docker compose --project-directory "$STACK" --env-file "$STACK/.env" \
  -f "$STACK/compose.yaml" up -d postgres
docker compose --project-directory "$STACK" --env-file "$STACK/.env" \
  -f "$STACK/compose.yaml" --profile ops run --rm migrate
docker compose --project-directory "$STACK" --env-file "$STACK/.env" \
  -f "$STACK/compose.yaml" up -d worker
docker compose --project-directory "$STACK" --env-file "$STACK/.env" \
  -f "$STACK/compose.yaml" run --rm --no-deps --entrypoint node gateway \
  dist/src/gateway.js
```

`$STACK` was an owner-only temporary source or restore project directory with
the Compose file, init script, secret files and local-only `.env`. The worker
reported zero teams and zero jobs. Gateway `--apply` was deliberately not run;
it requires an active KOOK credential and can receive/send external events.

## Backup, restore and permission results

The protected age recipient and identity, encrypted artifacts and random
database passwords were all outside the repository. The repository utility
commands used were:

```sh
python3 scripts/pubg-saas-backup-restore.py backup \
  --recipients-file "$AGE_RECIPIENTS" --output-dir "$BACKUP_DIR"
python3 scripts/pubg-saas-backup-restore.py verify \
  --artifact "$ARTIFACT" --manifest "$MANIFEST" \
  --identity-file "$AGE_IDENTITY"
python3 scripts/pubg-saas-backup-restore.py restore \
  --artifact "$ARTIFACT" --manifest "$MANIFEST" \
  --identity-file "$AGE_IDENTITY" \
  --target-database pubg_saas_disposable_m2_20261014_retry2 \
  --confirm-disposable-target pubg_saas_disposable_m2_20261014_retry2 --apply
python3 scripts/pubg-saas-backup-restore.py cleanup \
  --target-database pubg_saas_disposable_m2_20261014_retry2 \
  --confirm-disposable-target pubg_saas_disposable_m2_20261014_retry2 --apply
```

Encrypted backup, decryption/archive verification and restore into the second,
fresh PG container passed. All 37/37 public base-table counts matched. The
manifest included 11 migration rows and one synthetic tenant, team and sync
job. App insert/update/delete passed inside a rolled-back transaction; app DDL
was denied. The backup role could SELECT tables and the empty sequence state,
but could not write. A transaction-created future sequence was readable by
`pubg_backup` with SELECT only; `pubg_app` retained sequence usage. All three
disposable databases created during failed and successful attempts were
removed through the exact-marker guarded cleanup command.

The first restore exposed a real backup-role defect: without sequence SELECT,
PG18.1 `pg_dump` serialized the uncalled empty `usage_records_usage_id_seq` as
`setval(..., 0, false)`, and restore correctly rejected that value. The
bootstrap role script and restore access SQL now grant `SELECT` on existing
sequences and default `SELECT` on future sequences to `pubg_backup`, without
granting it sequence usage or writes. The focused Python safety suite passes
14/14.

## Private independence and limits

Both isolated Compose projects were stopped with `docker compose down` (no
`-v`; named synthetic volumes were preserved). After the local public stack was
stopped, `pnpm test:pubg` passed 68/68 across identity, presentation, Domain and
plugin tests. This proves the private source regression suite runs while the
local SaaS services are stopped; the live private OpenClaw process was not
stopped or restarted.

On this OrbStack run, the PG loopback binding was present in Docker's requested
HostConfig but absent from the runtime port table, and host `pg_isready` could
not connect to the PG service on the internal Compose network. The backup
utility therefore used temporary host PostgreSQL 18 clients routed through
`docker exec`, with owner-only passfiles transferred via stdin. This shim and
its random credentials were not checked in. Host-loopback backup behavior on
clean Linux remains unverified.

Still open: clean Linux/ARM64 and amd64 recovery, scheduled retention, tested
egress policy, measured M204 resource headroom, isolated-cloud independence,
live KOOK eligibility/quota and full human-user P3 flows, and real PUBG/model
provider accuracy and latency. No deployment was performed.
