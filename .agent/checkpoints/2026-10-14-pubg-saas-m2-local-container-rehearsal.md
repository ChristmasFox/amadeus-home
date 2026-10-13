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

## amd64 image smoke and build-context secret exclusion — 2026-10-14

The Goal asks for amd64 validation where feasible. An initial local Buildx OCI
build completed, but inspection found that the Docker ignore rules omitted
`.env.local`. That file was not loaded into a container environment and the
image was not pushed; however, it could have been part of the local BuildKit
context/cache. I added `*.env.local` and `**/.env.local` to `.dockerignore` in
commit `f70d29b`, ran `pnpm check:secrets` and `git diff --check`, and pruned
SaaS-specific private BuildKit cache records (820 MiB). A follow-up cache
inspection found only shared final runtime/entrypoint cache records, not
workspace-source cache records.

Built commit `f70d29b` as a temporary local `linux/amd64` image using Buildx;
the image index digest was
`sha256:329b330f43cdd84861dde5072109467306d894886c60ecff49b52633e01c18e4`.
Reproduce the build and offline architecture probe with:

```sh
docker buildx build --platform linux/amd64 --load \
  -f apps/pubg-saas/Dockerfile \
  -t local/pubg-saas:git-f70d29b-amd64-probe .
docker image inspect local/pubg-saas:git-f70d29b-amd64-probe \
  --format '{{.Os}}/{{.Architecture}}'
docker run --rm --platform linux/amd64 --network none --read-only \
  --cap-drop ALL --security-opt no-new-privileges --entrypoint node \
  local/pubg-saas:git-f70d29b-amd64-probe -e \
  "if (require('node:fs').existsSync('/app/apps/pubg-saas/.env.local')) process.exit(2); process.stdout.write(process.arch)"
docker image rm local/pubg-saas:git-f70d29b-amd64-probe
```

`docker image inspect` reported `linux/amd64`. A no-network, read-only,
capability-dropped container probe ran Node and returned `x64`; it also verified
that `/app/apps/pubg-saas/.env.local` is absent from the final image. The
temporary image tag was removed after the probe. This is an emulated local
image/runtime check, not a clean amd64 Linux host or Compose restore rehearsal.
No Compose service was started, no application process loaded credentials, and
no provider request was sent. No production resource or private runtime was
changed.

## M2 CI source and combined multi-architecture build — 2026-10-14

Added `.github/workflows/pubg-saas.yml` to cover the PostgreSQL-backed SaaS
suite, private Kurisu tests, both typecheck groups, architecture/secrets gates,
backup/restore safety tests, the synthetic 200-team benchmark, Compose render,
and a no-push Linux amd64/arm64 OCI build. All Actions are pinned by commit
SHA; CI uses only an ephemeral PostgreSQL service and synthetic placeholders.
The workflow has read-only repository permissions. It has not run on GitHub
because this branch has not been pushed.

The equivalent local multi-architecture Buildx command completed without
pushing or loading an image into the service runtime:

```sh
docker buildx build --platform linux/amd64,linux/arm64 \
  --output type=oci,dest=/tmp/pubg-saas-multiarch.oci.tar \
  --file apps/pubg-saas/Dockerfile .
python3 scripts/verify-pubg-saas-oci.py /tmp/pubg-saas-multiarch.oci.tar
```

The OCI index digest was
`sha256:cf6fb5cbb1e1771845b86bdb40cc649ac14a496e47311ce6bf3155935d941d3a`;
the verifier reported both `linux/amd64` and `linux/arm64`. A Compose render
using a temporary project directory and synthetic env/password placeholders
passed `docker compose config --quiet`; it started no service. The temporary
OCI artifact was removed. `pnpm check:secrets`, `git diff --check`, and Ruby
YAML syntax parsing passed. `actionlint` is not installed locally, and the
workflow has not yet been executed by GitHub Actions.

## CI-equivalent local acceptance — 2026-10-14

Executed the workflow's source/database steps against the existing isolated
`pubg-saas-pg18` fixture without printing its connection URL: secrets and
architecture checks, the 92-test PostgreSQL SaaS suite, 68 private Kurisu
tests, both typecheck groups, backup/restore safety tests (21/21), and the
synthetic 200-team benchmark all completed successfully. Compose rendering and
the no-push multi-architecture OCI build/verifier had already passed locally.
This confirms the workflow's local commands and environment shape, but does
not substitute for a GitHub Actions run.

The fresh benchmark used 200 tenants/teams, 800 users, 400 matches and 1,600
match-player rows. It completed 200/200 worker team runs with zero failures;
authorized query p95 was 81.67 ms, worker read p95 was 61.25 ms, and the PG
pool peaked at 16/20 connections with zero waiters. These are measurements of
the local isolated test fixture only, not M204 host capacity or an SLO.

## Current-commit Compose and encrypted recovery rehearsal — 2026-10-14

Rebuilt the current source commit `91bb60f` in the local OrbStack Buildx
context (`orbstack`) as `local/pubg-saas:git-91bb60f` for `linux/arm64`,
loaded locally and did not push it. Image manifest digest:
`sha256:ce344830bab21504e5f1ca13690eba539f989d09f9ce2d413ced48ffe2ed0682`.
The Docker build context was 12.36 KB. Buildx reused the existing incremental
image layers. Reproduce with:

```sh
docker buildx build --platform linux/arm64 --load \
  -f apps/pubg-saas/Dockerfile \
  -t local/pubg-saas:git-91bb60f .
docker image inspect local/pubg-saas:git-91bb60f \
  --format '{{.Id}} {{.Os}}/{{.Architecture}}'
```

Started new source and restore Compose projects named
`pubg-saas-m2-local-20261014-source` and
`pubg-saas-m2-local-20261014-restore`, each with its own fresh pinned PG18.1
container and project-owned volume. The source project started PostgreSQL and
the egress proxy healthy, applied migrations through `0011`, ran the gateway
dry-run and started the worker with one synthetic delayed queue row. The
worker discovered one team, attempted zero syncs and made no provider calls.
All values in Compose env files were local placeholders and generated
passwords; `.env.local`, KOOK, PUBG, model and 9Router credentials were not
read or loaded. The gateway was not started with `--apply`.

The protected source fixture contained one synthetic tenant, team and delayed
sync job plus a sequence created under `pubg_migrator`. Encrypted age backup and
archive verification passed. Restore into the separate fresh PG18.1 container
matched all 37/37 public base-table counts; tenant/team/sync-job counts were
`1:1:1`. On both source and restored databases, `pubg_app` DML passed inside a
rolled-back transaction, DDL was denied, `pubg_backup` table and sequence
SELECT succeeded while INSERT and `nextval` were denied, and `pubg_app`
sequence usage succeeded. The restored disposable database was removed only
with the exact-name and marker-guarded cleanup command.

Two harness setup errors were corrected without source changes. The first
archive verification subprocess omitted `PUBG_SAAS_PG_EXEC_*`, so the local PG
adapter correctly refused to run without its explicitly selected isolated
project; a minimal direct `pg_restore --list` reproduction succeeded once the
source project context was supplied. A first restored-database permission
probe used the label `restored` instead of the Compose project name `restore`,
and the adapter refused the mismatched project. Rerunning only verification
and the affected permission probe with the correct project contexts passed.
Neither failure was a backup/archive, application, database-permission or
product defect.

Reproduce the source stack startup with an owner-only temporary `$STACK`
prepared from `infra/pubg-saas/compose.yaml`, the PostgreSQL init script, and
synthetic local secrets/password files:

```sh
docker compose --project-name pubg-saas-m2-local-20261014-source \
  --project-directory "$STACK" --env-file "$STACK/.env" \
  --file "$STACK/compose.yaml" up -d --wait postgres egress-proxy
docker compose --project-name pubg-saas-m2-local-20261014-source \
  --project-directory "$STACK" --env-file "$STACK/.env" \
  --file "$STACK/compose.yaml" --profile ops run --rm migrate
docker compose --project-name pubg-saas-m2-local-20261014-source \
  --project-directory "$STACK" --env-file "$STACK/.env" \
  --file "$STACK/compose.yaml" up -d worker
docker compose --project-name pubg-saas-m2-local-20261014-source \
  --project-directory "$STACK" --env-file "$STACK/.env" \
  --file "$STACK/compose.yaml" run --rm --no-deps \
  --entrypoint node gateway dist/src/gateway.js
```

For backup/restore, use the exact commands and permission probes in
`infra/pubg-saas/BACKUP_RESTORE_REHEARSAL.md`, with the source and restore
`PUBG_SAAS_PG_EXEC_*` settings pointing at those separate project files, the
encrypted archive/identity/recipient and passwords outside Git, and a guarded
`pubg_saas_disposable_*` target. This rehearsal used the checked-in
`scripts/pubg-saas-compose-pg-tool.py` adapter. Compose requested a
loopback-only PG mapping, but OrbStack did not activate it, so all PostgreSQL
client operations used `docker compose exec` on the internal network; no
non-local database was contacted.

Both Compose projects were stopped with plain `docker compose down`, preserving
their named synthetic data volumes. With the public Compose services down,
`pnpm test:pubg` passed 68/68. Read-only checks on OrbStack machine `nyannyan`
showed OpenClaw healthy and 9Router running before and after the stop; neither
was restarted or changed. The existing isolated `pubg-saas-pg18` test fixture
was left running. No live private PUBG query, real KOOK/PUBG/model request,
production operation, image push or deployment was performed. Real provider
acceptance, clean-Linux/cloud recovery and independence, scheduled backup
installation, and canonical-host capacity measurements remain open.

## AMD64 Compose and recovery simulation; clean VM provisioning limit — 2026-10-14

Built current commit `91bb60f` locally as
`local/pubg-saas:git-91bb60f-amd64` for `linux/amd64` (loaded only into the
local `orbstack` Docker engine; Buildx manifest digest
`sha256:82bff06affbf9a21baf7133bce0f1e977432830942b8b495ece1ed2a21df4b53`).
The same 12.36 KB Docker context was used. A fresh temporary Compose project
explicitly selected `linux/amd64` for each service and used separate fresh
PG18.1 source and restore containers. PostgreSQL and the app image ran as
`x86_64`/`x64` under OrbStack emulation. Migration `0011`, gateway dry-run and
an empty-queue worker one-shot passed with placeholders only.

The AMD64 source database received one synthetic tenant, team and delayed sync
job plus a migration-role-owned future sequence. An encrypted `age` backup,
archive verification and restore into the fresh AMD64 PG18.1 container passed;
all 37/37 public table counts matched and tenant/team/job counts were `1:1:1`.
The source and restored databases both passed app DML-with-rollback, app DDL
denial, backup table/sequence SELECT, backup INSERT/`nextval` denial and app
sequence use. The disposable target was removed through exact-name/marker
cleanup. Temporary age identity and archive were deleted after verification.

An attempt to create a fresh Ubuntu 24.04 AMD64 VM for a native clean-host
rehearsal failed during OrbStack provisioning: `orbctl create` timed out after
two minutes because the guest did not receive an IP. This occurred with
`--isolated --isolate-network`, with `--isolated`, and with ordinary network
integration. OrbStack removed the failed provisioning records; the existing
`nyannyan` private-services machine stayed running. I stopped further VM
retries and used the local AMD64 container emulation instead. This is useful
architecture/Compose/restore evidence but does not satisfy a native clean
Linux host or cloud independence rehearsal.

The first temporary AMD64 Compose file also had a service-platform override
inserted beneath a nested `depends_on` key and failed YAML parsing. Correcting
the temporary file at service scope made `docker compose config --quiet` and
the run pass; no repository Compose source was edited. Both AMD64 Compose
projects were stopped with plain `docker compose down`, preserving their
synthetic volumes. Afterwards the only container in the local Docker engine
was the reusable `pubg-saas-pg18` test fixture; read-only checks showed private
OpenClaw healthy and 9Router running, without restart or configuration change.
No image was pushed or deployed, and no KOOK/PUBG/model credential was used.

## Synthetic 200-team local resource observation — 2026-10-14

Extended `apps/pubg-saas/tests/m2-200-team-load.benchmark.ts` to sample its
own RSS, heap, external and ArrayBuffer peaks every 10 ms during fixture seed,
authorized queries and worker reads. The SaaS package typecheck passed, and
the targeted benchmark passed against the existing isolated local
`pubg-saas-pg18` fixture with no skips or failures. It seeded 200 tenants and
teams, 800 users/roster accounts, 400 matches and 1,600 match-player rows.

This run completed all 200 authorized tasks and 200/200 worker team runs.
Authorized-query P95/P99 were 79.83/110.50 ms; worker-read P95/P99 were
62.37/103.50 ms. The worker phase executed 7,356 SQL statements. Pool use
peaked at 16/20 connections with no waiters. The benchmark Node process RSS was
93.1 MiB at sampling start and 169.8 MiB peak; peak heap was 54.2 MiB.

A separate coarse host/container sample during the same local synthetic load
observed 24 GiB host physical memory and system free memory at 74% before,
minimum sampled and after. The PostgreSQL test container was 58.5 MiB at
baseline and reached 112.2 MiB in four `docker stats` samples. Four samples are
too sparse for a reliable CPU peak; the printed CPU percentage is not used as a
capacity result. The benchmark runs on the Mac host against the isolated PG
fixture; the Node RSS is not gateway/worker container memory. The canonical
OrbStack host-profile machine `example-node` remains unavailable, so this
evidence does not establish its headroom or an SLO. No services or private
runtime were changed by the measurement.

## Final local source gate — 2026-10-14

On commit `7ff2d6d`, the final local source gate passed against the reusable
loopback-only `pubg-saas-pg18` fixture: SaaS/PostgreSQL tests 92/92, private
Kurisu regression 68/68, and backup/restore plus Compose PostgreSQL adapter
unit tests 21/21. Public and private typecheck groups, architecture check,
secrets scan, and `git diff --check` also passed. `pnpm workflow:plan` selected
FAST for the clean worktree (zero changed paths); no Docker build, Compose
start, image push, live provider call, or production operation was part of this
gate.

The final 200-team run completed all 200 authorized query tasks and 200/200
worker team runs with zero failures. Query P95/P99 were 81.67/112.12 ms;
worker-read P95/P99 were 60.43/105.31 ms across 7,356 SQL statements. The pool
peaked at 16/20 with no waiters. The host-run Node process sampled baseline RSS
80,740,352 bytes, peak RSS 160,727,040 bytes, peak heap 51,750,304 bytes,
external memory 8,963,837 bytes, and ArrayBuffers 4,794,044 bytes. These are
local fixture measurements only; they do not establish Compose worker memory,
canonical `example-node` headroom, a quota-feasibility result, or an SLO. The
benchmark schema was cleaned up, and no Compose or private runtime was changed.
The Goal stays open for native clean-Linux/cloud independence, installed backup
scheduling, live platform eligibility, and human-actor KOOK acceptance.

## KOOK eligibility and quota feasibility review — 2026-10-14

Read the current official [developer eligibility policy](https://developer.kookapp.cn/doc/privacy)
and [message quota documentation](https://developer.kookapp.cn/doc/http/message).
The policy lists unverified developers at one bot, one developer-owned guild,
200 bot messages/day and 60 API requests/minute; verified developers may create
unlimited bots, invite each bot to 10,000 guilds, and use 240 API requests/minute.
The message API separately documents a shared ceiling of 10,000 proactive sends
per developer account across its bots, resetting at 12:00 Asia/Shanghai. Failed
requests do not count; temporary replies are excluded and certain first replies
within five minutes receive a quota discount. The implementation's 200/day
default remains conservative and does not assume those discounts.

At the Goal's planning baseline of 30 queries per team per day, 200 teams imply
6,000 outbound answer messages/day if every query gets one ordinary response.
That is 60% of the verified account-wide 10,000 cap before welcomes, other
SaaS traffic, or the developer's other bots; two counted replies per query
would be 12,000 and exceed it. This is planning arithmetic, not measured usage
or a feasibility pass. The test bot's read-only inventory showed one guild and
one text channel; it cannot establish developer verification status, written
capacity approval, or remaining account quota. Do not raise the runtime budget
or claim 200-guild eligibility until those operator-side facts are confirmed.

## Worker liveness health signal — source acceptance

Added a loopback-only `GET /healthz` to the independent public sync Worker and
a Compose healthcheck that marks the Worker unhealthy when its local process
stops responding. The endpoint returns only `ok`, disables caching, rejects
other paths/methods, and publishes no port. The readiness/configuration and
queue telemetry remain separate; host alert routing is still not installed.

Targeted health-server tests passed 2/2. The updated full SaaS/PostgreSQL suite
passed 94/94 with no skips; private Kurisu regression passed 68/68. Both
typecheck groups, architecture check, 21 backup/restore and Compose adapter
tests, secret scan and diff check passed. Ruby's YAML parser accepted the
updated Compose file. `pnpm workflow:plan` selected RUNTIME and prohibited
Docker build/Compose execution by default; the earlier explicit local-only
build/Compose authorization was used for this integration check. Built
`local/pubg-saas:git-c0b0774` for ARM64 (local image ID/manifest
`sha256:3e897e398a57a9134081e6206a7e4559bdf012f979c09abecafa39318223a821`),
then started a fresh isolated Compose project with generated placeholder
secrets, applied migration `0011`, and waited for PostgreSQL, egress proxy and
Worker health. Compose reported `WORKER_HEALTH=healthy`; the Worker log showed
zero teams and zero sync jobs, so no provider request was attempted. The
gateway was not started. Plain `docker compose down` stopped the test project
and preserved its project-owned empty database volume. Afterwards only the
reusable PG fixture remained in the local engine; read-only checks showed
private OpenClaw healthy and 9Router running. No image was pushed and no
provider credential or private runtime was used or changed. Host alert routing
and canonical-host resource headroom remain open.

## Post-0012 ARM64 Compose, encrypted restore and offline Kurisu check — 2026-10-14

Commit `a04224aa3e8f77aaa15c32108cf07c789f8069b8` adds migration `0012`,
bounded query/session/usage retention and `/pubg privacy`. The image was built
locally in the `orbstack` context for `linux/arm64` as
`local/pubg-saas:git-a04224a`; its Buildx manifest-list digest is
`sha256:9920ad368398723be3703e49c8543ffaec6c3984994aa0f937d957c7e894bdf1`.
No image was pushed.

Two unique Compose projects, `pubg-saas-m2-a04224a-src` and
`pubg-saas-m2-a04224a-restore`, used fresh PostgreSQL 18.1 containers and
separate volumes. Compose render, source PostgreSQL readiness, migration
through `0012`, a credential-free gateway dry-run and Worker startup passed.
The first Worker cycle logged zero teams/jobs and no provider attempt; the
Worker was stopped before another cycle after the synthetic fixture was seeded.
The source contained one synthetic tenant, team, sync job and future sequence.
All random database passwords, age identity/recipient, encrypted artifact and
manifest were in owner-only paths outside Git. No KOOK/PUBG/model credential
was loaded or used.

Encrypted backup and decrypt/archive verification passed. Restore into the
other fresh PG container passed with 37/37 public table counts matching; the
manifest recorded 12 migration rows and tenant/team/job counts of 1:1:1.
On both source and restored databases, `pubg_app` INSERT/UPDATE/DELETE passed
inside a rolled-back transaction and DDL was denied. `pubg_backup` could read
table and sequence state but could not INSERT or call `nextval`; `pubg_app`
retained sequence use, including a sequence created by `pubg_migrator` after
restore. The disposable restore database was removed with the exact-marker
guarded cleanup command. Both Compose projects were stopped with ordinary
`down`; isolated named volumes were preserved. The only remaining local
container was the pre-existing `pubg-saas-pg18` fixture.

The affected source/database tests passed 15/15; the full SaaS/PostgreSQL suite
passed 100/100 with no skips. SaaS and private typechecks passed; the private
Kurisu regression passed 68/68 while SaaS Compose was down; backup utility
safety tests passed 14/14; secret scan and `git diff --check` passed. Read-only
OrbStack checks before and after the stop showed private OpenClaw
`running/healthy` and 9Router `running`; neither was restarted or modified.
This is source-suite and process-health independence evidence, not a live
private PUBG API query or clean Linux/cloud isolation test.

Two corrected harness assumptions are recorded: a pre-fix migration test
expected 11 rows and failed after `0012`; it now asserts the `0012` migration
ID and passes. The first restored-role probe omitted `PGHOST=postgres` from the
local Compose adapter environment; adding it made the same probe pass without
repeating restore. Reproduce the build/start/migrate flow using
`infra/pubg-saas/README.md`, and backup/restore/permission commands using
`infra/pubg-saas/BACKUP_RESTORE_REHEARSAL.md`, with the image tag above and
fresh `pubg-saas-m2-*` names. Host scheduling, clean Linux/cloud recovery,
canonical-host capacity, live provider acceptance and full human-user P3
acceptance remain open.

## Current-source repeat — 2026-10-14, commit `880a5cf`

The M1 follow-up added team leaderboard preferences and team-scoped aliases
with fresh admin authorization and actor/channel-bound one-use confirmations.
The current-source SaaS/PostgreSQL suite passed 100/100 without skips, private
Kurisu regression passed 68/68, both typecheck groups and the image build
passed. Migrations `0013` and `0014` are part of the restored schema.

Built the current ARM64 image locally:

```sh
docker buildx build --platform linux/arm64 --load \
  -f apps/pubg-saas/Dockerfile \
  -t local/pubg-saas:git-880a5cf .
```

Image manifest digest: `sha256:6dd0afafea5fc7d33c1ed3eed34e7834b0bed911dbf8f31da373671acf8d142f`.
The source and restore Compose projects each used a fresh, separately named
PG18.1 service/volume, rendered with `config --quiet`, started local Postgres
and the egress proxy, and ran the migration service through `0014`. The source
worker started against an empty queue; gateway ran only its no-credential
dry-run. A synthetic team fixture then included one tenant/team/job, a
`kills` preference, one alias and sequence state. The worker was stopped
before another scheduled cycle.

Using the local Compose PostgreSQL client adapter and an external age identity
and recipient, backup and archive verification passed; restore to the fresh
PG container matched 37/37 public base-table counts and 14 migration rows.
The synthetic tenant/team/job, preference, alias and sequence state matched.
On source and restore, app DML passed inside rollback and app DDL was denied;
backup SELECT worked while writes and `nextval` were denied; app sequence use
worked. Exact permission commands are in
`infra/pubg-saas/BACKUP_RESTORE_REHEARSAL.md`. The disposable restore DB was
removed with the exact-target marker guard. Both Compose projects were stopped
with plain `down`, retaining their isolated named volumes.

After shutdown, `pnpm test:pubg` passed 68/68. Read-only checks showed private
OpenClaw healthy and 9Router running; neither was restarted or changed. The
local Docker context was OrbStack on the Mac. The canonical CasaOS machine
`example-node` was absent from the OrbStack inventory, so this rehearsal does
not claim canonical-host acceptance or measured M204 headroom. No real KOOK,
PUBG or model credential was loaded, no image was pushed, and no production
database/configuration/deployment was touched.

Corrected local harness invocation: the first backup verify shell omitted the
temporary adapter directory from `PATH`; adding that generated directory
allowed the same encrypted artifact to verify successfully. The first
read-only OrbStack container query omitted `-u root` and hit Docker socket
permission denial; the root-scoped read-only query then confirmed private
service health. Neither was an application/test failure. Remaining gates are
canonical-host Compose/resource/alert routing, scheduled backup installation,
clean-Linux/cloud restore and isolation, live human-actor KOOK/quota checks,
and real PUBG/model acceptance.

## KOOK test-server authentication check — 2026-10-14

The protected, ignored `apps/pubg-saas/.env.local` was used only for the
previously authorized KOOK test server. Read-only official API inventory found
one guild and one text channel; identifiers and names were not recorded. A
separate fresh PG18.1 Compose project applied migrations through `0014` and
received one synthetic local-only tenant/team/player/channel fixture. Its
current-image Gateway used a local nonfunctional PUBG API placeholder, no
model configuration and `KOOK_DAILY_MESSAGE_BUDGET=5`. KOOK Gateway
authentication succeeded and persisted one session row with `last_sn=0`.

No human event arrived. The isolated database still had zero inbox/outbox,
preference and alias rows, so this run proves authentication only; it does not
prove message ingestion, permission behavior, card callbacks or delivery. The
desktop automation surface could not bind Chrome, so no human actor action was
available. The Gateway, proxy and PG containers were stopped with plain
`docker compose down`; the isolated volume was preserved and the temporary
credential copy was removed. No KOOK message was sent; no PUBG/model request,
production mutation, 9Router change or private OpenClaw restart occurred.

To resume P3, recreate the isolated project and connect its test Gateway, then
have a human test-server member send `/pubg help` and click the read-only
`创建队伍` guidance button. Verify the scoped inbox/outbox and daily budget by
counts only; never log the command payload, user/channel IDs or bot token.
