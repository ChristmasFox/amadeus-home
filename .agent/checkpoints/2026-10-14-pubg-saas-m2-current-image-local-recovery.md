# PUBG SaaS current-image M204 build and recovery rehearsal

Date: 2026-10-14 (Asia/Shanghai)

## Scope and outcome

Built commit `20b06da6dac05e70b8f285490e30b502f052af39` natively on the
host-profile OrbStack machine `nyannyan` as ARM64 image
`local/pubg-saas:git-20b06da`, image ID
`sha256:492a72e07d7fcd7bc169b2bc8e0f8ac409d050f6843c93b69d77277a2e181f17`.
The image remained local. Two unique Compose projects used separate fresh
PostgreSQL 18.1 containers and project-owned volumes. The source applied all
14 migrations; its Worker became healthy on an empty queue. Gateway was run
only in no-argument dry-run mode. The test PUBG key was a placeholder, and no
KOOK or model credential was read or used.

The source PG contained one synthetic tenant, team and delayed sync job, plus a
migrator-owned sequence. The encrypted backup was verified and restored into a
distinct fresh PG container. All 37/37 public table counts matched, including
14 migration rows and fixture tenant/team/job counts 1/1/1. Source and restore
passed the same role checks: app transactional DML succeeded and rolled back;
app DDL failed; backup table/sequence SELECT succeeded; backup DML and
`nextval` failed; app sequence usage succeeded. A new migrator-owned sequence
on restore also received the expected backup SELECT and app usage defaults.

Artifact: `pubg-saas-20261014T001118Z-497550f8.dump.age`; SHA-256
`76fbe72fac3bb4e66ec96f611dc7fe471703e2ee3cfad6b1623351b718b4663a`.
Restore database: `pubg_saas_disposable_m2_20b06da`. It was removed using the
backup utility's exact-name/marker cleanup guard.

The new `/metrics` handler returned HTTP 200 from inside the Worker container.
Compose reported a host-loopback binding on `127.0.0.1:29464`, but a request to
that host-published port from the OrbStack machine returned HTTP 502. A Mac-host
request was refused. The forwarding cause is not established; host-side scrape
on OrbStack remains unverified. Do not attach the Worker to the public egress
network as a workaround. The health check continued to pass.

Both test projects were stopped with plain `docker compose down`; named volumes
were retained. There were no remaining containers for either test project.
While public SaaS Compose was down, `pnpm test:pubg` passed 68/68. OpenClaw and
9Router container IDs and start times matched their pre-stop snapshot, remained
healthy/running, and both restart counts were zero. Neither private service was
restarted or changed.

Focused Worker metrics/health tests passed 6/6, and
`pnpm typecheck:pubg-saas`, `pnpm check:secrets`, and `git diff --check`
passed. The full SaaS/PostgreSQL suite was not rerun in this turn: the host
shell had no `PUBG_SAAS_TEST_DATABASE_URL`. The current code delta is the
aggregate metrics endpoint; prior current-phase SaaS/PostgreSQL acceptance is
recorded in the earlier checkpoint. The pre-existing `pubg-saas-pg18` fixture
was not modified.

No real PUBG/model credentials, production DB, production deployment, image
push, 9Router configuration change or private OpenClaw restart was involved.

## Reproduction

Commands below assume `REPO_ROOT` points to this checkout as visible inside
the M204 OrbStack machine. Keep temporary stacks, age identity, passwords and
artifacts outside Git in owner-only directories. Generate unique random PG
password files; use placeholder provider settings. Do not load
`apps/pubg-saas/.env.local` for this rehearsal.

### Build the exact image on M204

```sh
COMMIT=20b06da6dac05e70b8f285490e30b502f052af39
IMAGE=local/pubg-saas:git-20b06da
BUILD=/var/tmp/pubg-saas-host-build-20b06da
mkdir -m 700 -p "$BUILD"
cd "$REPO_ROOT"
git archive --format=tar "$COMMIT" .dockerignore package.json pnpm-lock.yaml \
  pnpm-workspace.yaml apps/pubg-saas packages/pubg-domain \
  packages/presentation infra/pubg-saas/container-entrypoint.sh \
  | tar -xf - -C "$BUILD"
docker buildx build --progress=plain --load --resource memory=4g \
  --resource cpu-quota=400000 -f "$BUILD/apps/pubg-saas/Dockerfile" \
  -t "$IMAGE" "$BUILD"
docker image inspect "$IMAGE" --format '{{.Id}} {{.Os}}/{{.Architecture}}'
```

### Start two isolated Compose PostgreSQL projects

Create separate source and restore stacks from `infra/pubg-saas/` at the
recorded commit. For each stack, copy `.env.example` and the three role env
examples into the temporary stack; create `secrets/` mode `0700`; generate
four independent random password files with `openssl rand -hex 32`; keep env
files mode `0600` and mounted password files mode `0444` inside that protected
directory. Set a distinct `PUBG_SAAS_COMPOSE_PROJECT`, the image above, unique
loopback-only PG and metrics ports, and no provider values. Validate each using
`docker compose ... config --quiet`.

```sh
docker compose --project-name "$SRC_PROJECT" --project-directory "$SRC_STACK" \
  --env-file "$SRC_STACK/.env" -f "$SRC_STACK/compose.yaml" \
  up -d --wait postgres egress-proxy
docker compose --project-name "$SRC_PROJECT" --project-directory "$SRC_STACK" \
  --env-file "$SRC_STACK/.env" -f "$SRC_STACK/compose.yaml" \
  --profile ops run --rm migrate
docker compose --project-name "$SRC_PROJECT" --project-directory "$SRC_STACK" \
  --env-file "$SRC_STACK/.env" -f "$SRC_STACK/compose.yaml" \
  up -d --wait worker
docker compose --project-name "$SRC_PROJECT" --project-directory "$SRC_STACK" \
  --env-file "$SRC_STACK/.env" -f "$SRC_STACK/compose.yaml" \
  run --rm --no-deps --entrypoint node gateway dist/src/gateway.js
```

The final command is the Gateway dry-run; it does not connect to KOOK or PG.
Check Worker health and its metrics endpoint inside the container. Stop the
Worker before inserting the synthetic job; set that job's next attempt 24
hours ahead so no provider request can occur.

### Encrypted backup, fresh-container restore and permissions

For an age key, keep the private identity and recipient file outside Git and
mode `0600`. Attach a temporary PostgreSQL/age helper to the relevant Compose
project's internal `postgres_private` network. Mount the backup scripts and
age files read-only, mount only the necessary random role password file, and
mount the external artifact directory separately. The prior local helper image
was `local/pubg-saas-rehearsal-tools:git-87543bc`
(`sha256:06a3519442d8a00307aeaf8b8fcea4b0867ec03b1a6057d0891001ba1c0aed6f`);
its pinned PostgreSQL 18.1 + `age`/Python build recipe is in the earlier
M2 rehearsal checkpoint. Do not put passwords in Docker arguments or output.

Inside the source-network helper, load the backup password from its mounted
file into a temporary process environment and run:

```sh
python3 scripts/pubg-saas-backup-restore.py backup \
  --recipients-file "$AGE_DIR/recipients.txt" --output-dir "$ARTIFACT_DIR"
python3 scripts/pubg-saas-backup-restore.py verify \
  --artifact "$ARTIFACT" --manifest "$MANIFEST" \
  --identity-file "$AGE_DIR/identity.txt"
```

Start the restore project's fresh PostgreSQL container without migrating it.
Attach a second helper only to the restore project's private PG network, load
its bootstrap password from the mounted file, and run:

```sh
python3 scripts/pubg-saas-backup-restore.py restore \
  --artifact "$ARTIFACT" --manifest "$MANIFEST" \
  --identity-file "$AGE_DIR/identity.txt" \
  --target-database pubg_saas_disposable_m2_20b06da \
  --confirm-disposable-target pubg_saas_disposable_m2_20b06da --apply
```

The tool compares every public table count against the encrypted manifest.
Then run the source/restore permission probes from
[`infra/pubg-saas/BACKUP_RESTORE_REHEARSAL.md`](../../infra/pubg-saas/BACKUP_RESTORE_REHEARSAL.md),
including app DML in a rolled-back transaction, app DDL denial, backup table
and sequence reads, backup DML and `nextval` denial, app sequence usage, and a
new migrator-owned sequence after restore. Remove only the disposable restored
database through the utility's exact-name and marker guarded `cleanup --apply`
command.

Finally, stop both unique projects with ordinary `docker compose down` (no
`-v`), run `pnpm test:pubg`, and compare read-only OpenClaw/9Router IDs,
start times and restart counts before and after. No live message or private
runtime write is required.
