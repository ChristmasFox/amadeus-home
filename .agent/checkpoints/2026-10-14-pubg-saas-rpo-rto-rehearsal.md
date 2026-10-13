# PUBG SaaS synthetic RPO/RTO rehearsal

Date: 2026-10-14 (Asia/Shanghai)

## Scope and result

Used the isolated Ubuntu 24.04 ARM64 `pubg-saas-m2-clean` VM and local image
`local/pubg-saas:git-6313ef7` (app source unchanged since that build). Fresh,
separate Compose projects and PostgreSQL 18.1 volumes were used for the
synthetic source and recovery clusters. Source migrations reached `0014` and
contained only one synthetic tenant, team and delayed sync job. The encrypted
artifact stayed under the VM's owner-only `/var/tmp` test directory.

| Measure | Result |
| --- | ---: |
| Backup command | 641 ms |
| Encrypted artifact | 87,756 bytes; SHA-256 `9a24f9acfeb8e52992a826188fde6a088d3e9eb2065b2b588a1eba15b7932c0e` |
| Backup verification | 135 ms |
| Snapshot request to simulated outage | 0.624 s upper bound |
| Restore plus 37/37 table-count verification | 1,558 ms |
| Simulated outage to restored Worker healthy | 14,619 ms |
| Worker cycle | 1 team discovered, 0 attempted, 0 failed, 1 delayed job |

The timing is a small-fixture recovery-mechanics sample. No Gateway, human
KOOK event, PUBG request or model request was part of this RTO. It does not
prove a production RPO/RTO, 200-team restore time, six-hour scheduled backup
operation, or release capacity. The timer remains uninstalled.

The restore passed app DML inside rollback and denied app DDL. A future
migrator-owned sequence was readable to `pubg_backup`; `nextval` was denied.
The target DB was removed only through the exact-name disposable-marker cleanup
command. Both Compose projects were stopped with ordinary `down` (no `-v`);
the synthetic named volumes were retained. Final VM check found zero running
containers for these projects. No image was pushed, production database,
9Router or private OpenClaw was accessed or changed.

## Measurement correction

The first timing attempt subtracted the manifest's `createdAtUtc`, which is
written after archive encryption. That yielded an artifact-age figure, not the
snapshot age, so it is discarded as an RPO result. The backup utility now
records `snapshotRequestedAtUtc` immediately before requesting PostgreSQL's
exported snapshot; this is conservative because it slightly precedes the
database's actual snapshot point. `createdAtUtc` retains its completion-time
meaning at microsecond resolution. Readers continue accepting older v1
manifests without the optional field.

## Reproduction outline

Run only in the isolated VM using its owner-only fixtures and local image. The
existing recovery runbook explains how to prepare those files and credentials:
`infra/pubg-saas/BACKUP_RESTORE_REHEARSAL.md`.
The host-side implementation checks were:

```sh
python3 -m unittest discover -s scripts/tests -p 'test_pubg_saas_backup_restore.py' -v
pnpm test:storage-runtime
pnpm check:secrets
git diff --check
```

Copy the current backup helper to the VM over stdin; the VM fixture has no
tracked source checkout:

```sh
cat scripts/pubg-saas-backup-restore.py | orb -m pubg-saas-m2-clean -u root \
  bash -lc 'cat > /var/tmp/pubg-saas-m2-clean/tooling/scripts/pubg-saas-backup-restore.py && chmod 700 /var/tmp/pubg-saas-m2-clean/tooling/scripts/pubg-saas-backup-restore.py'
```

```sh
base=/var/tmp/pubg-saas-m2-clean
src="$base/rpo-rto-src-20261014"
restore="$base/rpo-rto-restore-20261014"
src_project=pubg-saas-m2-rpo-rto-src-20261014
restore_project=pubg-saas-m2-rpo-rto-restore-20261014
target=pubg_saas_disposable_rpo_rto_20261014

docker compose --project-name "$src_project" --project-directory "$src" \
  --env-file "$src/.env" -f "$src/compose.yaml" up -d --wait postgres
docker compose --project-name "$restore_project" --project-directory "$restore" \
  --env-file "$restore/.env" -f "$restore/compose.yaml" up -d --wait postgres

export PATH="$base/tooling/bin:$PATH"
export PUBG_SAAS_PG_EXEC_PROJECT="$src_project"
export PUBG_SAAS_PG_EXEC_COMPOSE_FILE="$src/compose.yaml"
export PUBG_SAAS_PG_EXEC_ENV_FILE="$src/.env"
PUBG_SAAS_BACKUP_PASSWORD="$(< "$src/secrets/backup-password")"
export PUBG_SAAS_DATABASE_URL="postgresql://pubg_backup:${PUBG_SAAS_BACKUP_PASSWORD}@postgres:5432/pubg_saas"
python3 "$base/tooling/scripts/pubg-saas-backup-restore.py" backup \
  --recipients-file "$base/age/recipients.txt" --output-dir "$base/artifacts"

artifact="$(find "$base/artifacts" -maxdepth 1 -type f -name '*.dump.age' \
  -printf '%T@ %p\n' | sort -nr | head -n1 | cut -d' ' -f2-)"
manifest="${artifact%.dump.age}.manifest.json"
outage_ns="$(date +%s%N)"
python3 - "$manifest" "$outage_ns" <<'PY'
import datetime, json, sys
m = json.load(open(sys.argv[1]))
s = datetime.datetime.fromisoformat(m['snapshotRequestedAtUtc'].replace('Z', '+00:00'))
o = datetime.datetime.fromtimestamp(int(sys.argv[2]) / 1e9, datetime.timezone.utc)
print(f'RPO_UPPER_BOUND_SECONDS={(o-s).total_seconds():.3f}')
PY

export PUBG_SAAS_PG_EXEC_PROJECT="$restore_project"
export PUBG_SAAS_PG_EXEC_COMPOSE_FILE="$restore/compose.yaml"
export PUBG_SAAS_PG_EXEC_ENV_FILE="$restore/.env"
PUBG_SAAS_BOOTSTRAP_PASSWORD="$(< "$restore/secrets/postgres-superuser-password")"
export PUBG_SAAS_RESTORE_ADMIN_URL="postgresql://pubg_bootstrap:${PUBG_SAAS_BOOTSTRAP_PASSWORD}@postgres:5432/postgres"
python3 "$base/tooling/scripts/pubg-saas-backup-restore.py" verify \
  --artifact "$artifact" --manifest "$manifest" \
  --identity-file "$base/age/identity.txt"
restore_start_ns="$(date +%s%N)"
python3 "$base/tooling/scripts/pubg-saas-backup-restore.py" restore \
  --artifact "$artifact" --manifest "$manifest" \
  --identity-file "$base/age/identity.txt" \
  --target-database "$target" --confirm-disposable-target "$target" --apply
restore_done_ns="$(date +%s%N)"
echo "RESTORE_MS=$(((restore_done_ns-restore_start_ns)/1000000))"
docker compose --project-name "$restore_project" --project-directory "$restore" \
  --env-file "$restore/.env" -f "$restore/compose.yaml" up -d --wait worker
ready_ns="$(date +%s%N)"
echo "RESTORE_TO_WORKER_HEALTHY_MS=$(((ready_ns-outage_ns)/1000000))"

# After role probes, clean only the exact marker-protected disposable database.
# Stop each Compose project with `down`; do not add `-v`.
```

The actual artifact from this run was
`pubg-saas-20261013T234634Z-1d518e61.dump.age`. The 200-team load result and
separate-host egress/recovery evidence remain in
`.agent/checkpoints/2026-10-14-pubg-saas-m2-local-container-rehearsal.md`.
