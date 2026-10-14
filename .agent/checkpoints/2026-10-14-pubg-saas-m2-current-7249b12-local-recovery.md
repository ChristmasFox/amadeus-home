# PUBG SaaS M2 current-source M204 Compose and recovery rehearsal

Date: 2026-10-14 (Asia/Shanghai)

## Scope and safety

Built current app source commit `7249b12` as a local ARM64 image on the
host-profile OrbStack machine `nyannyan`. Image:
`local/pubg-saas:git-7249b12`, manifest digest
`sha256:2c17198eb271c4a103585830dc2944abe8dbbeff8d25ab22a733ea4ac9c8faee`.
No image was pushed. Source and restore used unique Compose projects and fresh,
separate PostgreSQL 18.1 volumes. Bot, PUBG and model values were placeholders;
the real test-bot env file was not read or mounted. No provider request, message,
production database, deployment, 9Router change or private OpenClaw restart
occurred.

## Current-source results

Both rendered Compose configurations passed `config --quiet`. The source
project applied all 14 migrations, and its egress proxy and Worker became
healthy. Host-loopback metrics returned 200 with `pubg_saas_worker_up 1`; the
Gateway dry-run stated that `--apply` and real public credentials are required.
The synthetic source fixture contained one tenant, team and delayed sync job.

An encrypted `age` backup was created and verified, then restored into the
separate fresh PG container. Its manifest checksum is
`4fc66a236bcdb3c3682aed774747cb11261f89dcb5d483b38cd252fab1eb2200`; the
encrypted archive remains outside Git at
`$HOME/Library/Caches/pubg-saas-m2-current-7249b12/artifacts/` with mode 0600.
Restore matched all 37/37 public tables and all 14 migration rows; fixture row
counts were 1 tenant / 1 team / 1 job. Source and restored DB probes passed:

- `pubg_app`: DML allowed inside a rolled-back transaction, DDL denied, and
  sequence `nextval` allowed.
- `pubg_backup`: table and current/future sequence reads allowed; DML and
  sequence `nextval` denied.
- Restored Worker: healthy against the restored disposable DB; 1 delayed job,
  0 due jobs, 0 attempts, 0 ingress rows and 0 outbox rows. No provider call ran.

The first restored Worker attempt used the Compose default DB name `pubg_saas`
instead of the explicitly named disposable restore DB; it failed startup. The
test-only Worker env was corrected to target the restore DB, after which health
and queue checks passed. No source change was needed.

The M204 guest did not have `age`, and the `orb`-wrapped PostgreSQL adapter
timed out while opening the backup utility's long-lived exported snapshot
(`timed out opening a PostgreSQL backup snapshot`). One-shot adapter queries
worked. Rather than publish PostgreSQL or change the backup utility, a
temporary local helper image was built from the pinned PG18.1 image with
`age`/Python, and ran attached only to each Compose `postgres_private` network.
It used the same checked-in backup utility and external owner-only identity;
the helper image and artifacts were not pushed. The helpers and password files
are under owner-only external paths in
`/var/tmp/pubg-saas-m2-current-7249b12` and
`$HOME/Library/Caches/pubg-saas-m2-current-7249b12`.

Both projects were stopped with ordinary `docker compose down` (no `-v`); the
two project-owned PG volumes remain. With the SaaS test containers down,
`pnpm test:pubg` passed 68/68. Read-only post-checks showed OpenClaw and 9Router
still running with the same IDs and start times as before, restart count 0.
This proves the private source regression runs independently of the local SaaS
projects; no live Kurisu message or private PUBG query was sent.

## Reproduction

The following paths contain only disposable test configuration and credentials;
do not print or commit their files. Source and restore `.env`/password files
are under `$BASE` on M204. The `age` identity, artifact and temporary helper
scripts are under `$LOCAL_BASE` on the Mac. The normal Compose commands are in
`infra/pubg-saas/README.md`; permission probes are in
`infra/pubg-saas/BACKUP_RESTORE_REHEARSAL.md`.

```sh
source scripts/host-profile.sh
amadeus_host_profile_load "$PWD"
BASE=/var/tmp/pubg-saas-m2-current-7249b12
LOCAL_BASE="$HOME/Library/Caches/pubg-saas-m2-current-7249b12"
SRC=pubg-saas-m2-current-src-7249b12
RESTORE=pubg-saas-m2-current-restore-7249b12

orb -m "$ORBSTACK_MACHINE" -u root docker buildx build --platform linux/arm64 --load \
  -f apps/pubg-saas/Dockerfile -t local/pubg-saas:git-7249b12 .

orb -m "$ORBSTACK_MACHINE" -u root docker compose --project-name "$SRC" \
  --project-directory "$BASE/source" --env-file "$BASE/source/.env" \
  -f "$BASE/source/compose.yaml" up -d --wait postgres egress-proxy
orb -m "$ORBSTACK_MACHINE" -u root docker compose --project-name "$SRC" \
  --project-directory "$BASE/source" --env-file "$BASE/source/.env" \
  -f "$BASE/source/compose.yaml" --profile ops run --rm migrate
orb -m "$ORBSTACK_MACHINE" -u root docker compose --project-name "$SRC" \
  --project-directory "$BASE/source" --env-file "$BASE/source/.env" \
  -f "$BASE/source/compose.yaml" up -d --wait worker
orb -m "$ORBSTACK_MACHINE" -u root curl -fsS http://127.0.0.1:29465/metrics

# The checked-in backup/restore utility runs in the temporary PG18.1+age helper
# attached to ${SRC}_postgres_private; the command reads the backup password
# from the mounted 0600/0444 test secret file, never an argv or log value.
# Use the owner-only backup-inside.sh and verify-inside.sh in $LOCAL_BASE/tooling.
# Create the fresh restore PG separately, then run restore-inside.sh and the
# runbook's source/restore permission probes with the target DB set explicitly.
orb -m "$ORBSTACK_MACHINE" -u root docker compose --project-name "$RESTORE" \
  --project-directory "$BASE/restore" --env-file "$BASE/restore/.env" \
  -f "$BASE/restore/compose.yaml" up -d --wait postgres
# After restored Worker/role checks, remove only the marked disposable DB via
# the utility's exact-target cleanup --apply, then stop without deleting volumes.
orb -m "$ORBSTACK_MACHINE" -u root docker compose --project-name "$SRC" \
  --project-directory "$BASE/source" --env-file "$BASE/source/.env" \
  -f "$BASE/source/compose.yaml" down
orb -m "$ORBSTACK_MACHINE" -u root docker compose --project-name "$RESTORE" \
  --project-directory "$BASE/restore" --env-file "$BASE/restore/.env" \
  -f "$BASE/restore/compose.yaml" down
pnpm test:pubg
```

M2 remains open for persistent backup scheduling, release-grade RPO/RTO and
physical/cloud independence, production-shaped capacity/alert delivery, human
P3 actor flows and verified KOOK quota, and real PUBG/model acceptance.
