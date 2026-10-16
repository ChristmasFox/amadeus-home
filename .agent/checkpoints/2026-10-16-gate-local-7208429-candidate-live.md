# Gate-Local 7208429 candidate deployment

Date: 2026-10-16 (Asia/Shanghai)

## Result

- Candidate source: `7208429655ab953c0f5840d89838e7e508435ac8`.
- Target: OrbStack machine `pubg-saas-m2-clean`, Compose project
  `pubg-saas-public`; active deployment directory discovered from the running
  Compose labels at `/var/tmp/pubg-saas-live-0fefe78/repo/infra/pubg-saas`.
- Candidate image: `local/pubg-saas:git-7208429655ab953c0f5840d89838e7e508435ac8`,
  image ID `sha256:aa15e0fb7072f4d708f9e419eea2e253b62a8245d0ab7f8ccb550c6a04c0ab0d`,
  `linux/arm64`. Local-to-OrbStack image identity verification passed.
- Build: existing OrbStack Buildx builder `orbstack`, existing
  `apps/pubg-saas/Dockerfile`; image built with OCI revision set to the full
  candidate SHA.
- The Gate-Local release command was
  `bash scripts/release-gate.sh candidate --apply --approval-ref arthur-20261016-gate-local-7208429`.
  It stopped before remote mutation with `candidate_host_tools_unavailable`
  because the Homebrew libpq bin directory was not on PATH. Per Arthur's authorization, the manual
  fallback completed the build, migration, service switch, and health checks.

## Backup and migration

- Full PostgreSQL custom-format dump, encrypted with the configured age
  recipients and verified by full age decryption plus `pg_restore --list`
  inside the existing Gate PostgreSQL container: 1,822,531 bytes and 243
  non-header restore-list entries.
- Backup directory:
  `~/.local/share/pubg-saas-backup/gate-local-pg-predeploy-7208429-20261016T092803Z`
- Encrypted dump SHA-256:
  `c61837d648c4ba31c6c262ceec95fca701102385e0d9fe1a510ee5093bbb6ae7`.
- `compose.before.yaml` and `.env.before` are in the same owner-only directory,
  both mode 0600. The checkpoint JSON and migration output are also mode 0600.
- No migration SQL files differ between the previous live f6 source and this
  candidate. The candidate migrator exited successfully. A read-only query
  found exactly the 28 migration IDs present in the candidate runner, through
  `0029_gate_memory_index_generations.sql`; optional pgvector migration `0025`
  remains absent.

## Runtime verification

- Gateway: running/healthy, candidate image, `/healthz` returned HTTP 200. This
  endpoint reports the KOOK gateway handshake as connected.
- Worker: running/healthy, candidate image.
- egress-proxy: running/healthy, candidate image.
- PostgreSQL: same pre-deploy container ID, running/healthy, unchanged pinned
  `postgres:18.1-bookworm` image and volume.
- Gateway error-level log count in the post-deploy window: 0.
- `GATE_MEMORY_READ_ENABLED`, `GATE_MEMORY_WRITE_ENABLED`,
  `GATE_MEMORY_AUTO_LEARN_ENABLED`, and `GATE_MEMORY_EMBEDDING_ENABLED` are
  unset in both Gateway and Worker.
- M2 remains PAUSED. No clearance was created and no M2 resume occurred. Lab
  was not accessed.

## Rollback

Restore `compose.before.yaml` and `.env.before` to the deployment directory,
then run from that directory with the existing `.env`:

```sh
docker compose --project-name pubg-saas-public --env-file .env \
  --file compose.yaml up -d --no-build --force-recreate --wait \
  egress-proxy gateway worker
```

The saved `.env.before` selects the previous healthy image
`local/pubg-saas:git-f6a960834a29f149b5bac054d63d6fd6dc075cee`. PostgreSQL and
its volume were not replaced. If database recovery is needed, use the verified
encrypted dump above with the existing Gate backup restore procedure before
starting the prior application image.

## Host tool PATH follow-up

At 2026-10-16T17:38+08:00, M204's Homebrew `libpq 18.6_1` was already installed
and current. Its binary is `/opt/homebrew/opt/libpq/bin/pg_restore`, version
18.6. `scripts/gate-local-candidate.py` now checks the common Homebrew libpq
bin directories and prepends the directory containing `pg_restore` to its
child-process PATH when the tool is otherwise absent. Tests:
`python3 scripts/tests/test_gate_autopilot.py` passed (29 tests); path/version
lookup passed; `bash scripts/release-gate.sh candidate` returned
`APPLY=not-requested`. No deployment apply or runtime write was attempted.
