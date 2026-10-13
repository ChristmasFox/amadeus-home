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

## Restored-database worker and KOOK inventory follow-up — 2026-10-14

The encrypted artifact was restored again to a newly created disposable
database in the isolated restore PG18.1 project. All 37/37 public table counts
matched. The one-shot public worker then connected to that restored database
with placeholder provider configuration while its provider network was forced
internal. It discovered the single synthetic team and its delayed sync job,
attempted zero syncs, and exited successfully; no PUBG/model API call was
possible. The exact-marker disposable database was removed and the restore
Compose project was stopped without deleting its volume.

Separately, the mode-0600 test-server KOOK credential file was used only for
read-only guild/channel inventory. The authenticated API returned one guild
and one text channel. No identifiers or names were recorded, no message was
sent, and no actor was available for the outstanding human-command P3 cases.
This does not expand the previously proven gateway-auth/outbox/resume smoke.

## Application egress boundary and full database suite — 2026-10-14

The Compose gateway and worker now join only the private PostgreSQL network and
an internal proxy network; neither has a default route. The dedicated
`egress-proxy` is the sole service on the outbound bridge. It accepts HTTPS
CONNECT on port 443, resolves the requested hostname itself, rejects all
answers if any resolve to loopback, private, link-local, reserved, metadata,
or other non-global addresses, then dials a vetted resolved address directly.
The application installs Undici's global dispatcher for fetch and WSS; direct
provider access fails closed if Compose does not configure the proxy. The
proxy is not a hostname allowlist; it permits public HTTPS destinations.

Focused proxy unit tests pass 6/6, including DNS-rebinding/mixed-answer denial
and the Node WSS dispatcher path. The local ARM64 Compose rehearsal passed
rendered-config validation and started PostgreSQL plus the proxy healthy. Its
one-shot SaaS worker connected to the migrated isolated database with an empty
queue. From an app-network test container, `/proc/net/route` had no default
route, direct metadata access returned `ENETUNREACH`, proxy CONNECT to the
metadata address returned 403, and proxy CONNECT to `host.docker.internal`
returned 403. A credential-free HTTPS HEAD to `example.com` through the app's
global dispatcher returned 200. No KOOK, PUBG, model or 9Router credential was
used in these network tests, and no message was sent.

With the existing isolated `pubg-saas-pg18` fixture provided through
`PUBG_SAAS_TEST_DATABASE_URL`, `pnpm test:pubg-saas` passed 92/92 with no skips;
the earlier no-URL invocation skipped 30 PostgreSQL tests and is not counted as
acceptance. `pnpm typecheck:pubg-saas`, `pnpm test:pubg` (68/68) and
`pnpm typecheck:pubg` also passed. This verifies source and the local OrbStack
network boundary only. Clean Linux/cloud egress/restore, scheduled retention,
measured canonical-host resource headroom, cloud independence, provider/model
acceptance, KOOK eligibility/quota and human-actor P3 cases remain open.

## Follow-up rerun with checked-in internal-network adapter — 2026-10-14

Rebuilt the ARM64 SaaS image from commit `f0aa16b` as
`local/pubg-saas:git-f0aa16b`; image manifest digest:
`sha256:f6985df9ea17bde1d7f5b60826e7fb336047ad5e74d93f896f5e16a52dc5f21c`.
Fresh projects `pubg-saas-m2-local-src-20261014b` and
`pubg-saas-m2-local-restore-20261014b` each used a new PG18.1 container and
project-owned volume. Migration `0011`, empty-queue worker startup and gateway
dry-run passed with placeholders and no KOOK/PUBG/model credential loaded.

Added `scripts/pubg-saas-compose-pg-tool.py` as the local-only PostgreSQL client
transport documented in `infra/pubg-saas/BACKUP_RESTORE_REHEARSAL.md`. It
rejects non-local project names, non-pinned PG images, external networks,
non-loopback port bindings and non-project volumes. It transfers pgpass through
stdin into a mode-0600 file under the PostgreSQL container's `/tmp` tmpfs and
removes it after each invocation. The existing host-native backup/recovery
mode remains unchanged.

The initial follow-up verify failed because PostgreSQL 18 `pg_restore --list -`
interprets `-` as a literal filename. A direct minimal reproduction showed
`could not open input file "-"`; the adapter now omits the archive filename and
streams it through stdin. The focused 21-test backup/adapter suite passed after
the fix. The encrypted backup artifact
`pubg-saas-20261013T183114Z-07d216e6.dump.age` verified with SHA-256
`d34e3973f5dfdb4b5df2169255837787836e8f4d5e02a7f941e61a12ac1255c0`. Restore
into the fresh restore project passed with 37/37 public table counts matched;
the manifest held 11 migrations and one synthetic tenant/team/sync job. Source
and restored permission probes both passed: app DML within rollback, no app
DDL, backup SELECT including future sequence state, no backup writes or
`nextval`, and app sequence usage. The disposable restore DB was removed only
through the exact-name/marker cleanup command.

Stopped the source, restore and previous temporary Compose projects with plain
`docker compose down`, preserving their named volumes. The separate pre-existing
`pubg-saas-pg18` integration-test fixture remains running. While the SaaS
projects were down, `pnpm test:pubg` passed 68/68. Read-only health checks before
and after showed `openclaw` running/healthy and `9router` running on OrbStack's
available `nyannyan` machine; neither service was restarted or changed and no
private PUBG tool query was run. The configured `example-node` OrbStack machine
was absent from the current machine inventory. The KOOK test credential file
was not read or used in this local rehearsal.

## Egress change committed-image repetition — 2026-10-14

The egress source is commit `8316f4e`. Built its ARM64 local image as
`local/pubg-saas:git-8316f4e`, manifest digest
`sha256:1e94dfc77c0ad6d07928d3138e789e18ad19e17286f14647a1b50709f05e5b77`.
The reproducible build and local Compose sequence is:

```sh
docker buildx build --platform linux/arm64 --load \
  -f apps/pubg-saas/Dockerfile \
  -t local/pubg-saas:git-8316f4e .
docker compose --project-directory "$STACK" --env-file "$STACK/.env" \
  --file "$STACK/compose.yaml" config --quiet
docker compose --project-directory "$STACK" --env-file "$STACK/.env" \
  --file "$STACK/compose.yaml" up -d --wait postgres egress-proxy
docker compose --project-directory "$STACK" --env-file "$STACK/.env" \
  --file "$STACK/compose.yaml" --profile ops run --rm migrate
docker compose --project-directory "$STACK" --env-file "$STACK/.env" \
  --file "$STACK/compose.yaml" run --rm --no-deps worker \
  node dist/src/public-sync-worker.js --apply --once
docker compose --project-directory "$STACK" --env-file "$STACK/.env" \
  --file "$STACK/compose.yaml" down
```

`$STACK` is an owner-only disposable directory prepared per
`infra/pubg-saas/README.md`, with random local passwords and provider
placeholders. No real provider credential is needed for these commands. The
committed-image rerun repeated migration, worker startup, gateway dry-run,
no-default-route check, metadata/host-private denials, and public HTTPS proxy
smoke. It ended with plain `down`; the named PG volume was preserved and no
image was pushed. A quiescent container snapshot was PostgreSQL 28.58 MiB / 1
GiB and egress proxy 13.22 MiB / 128 MiB. This is an idle sample, not worker-load
capacity or canonical M204 host headroom. After SaaS shutdown, private
OpenClaw remained healthy, 9Router remained running, and `pnpm test:pubg`
passed 68/68. The local image used the available OrbStack ARM64 builder; the
host-profile `example-node` remained unavailable.
