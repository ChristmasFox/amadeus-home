# Gate memory plugin extraction candidate checkpoint

Date: 2026-10-16 (Asia/Shanghai)

## Source and CI

- Active Goal: `docs/GATE_MEMORY_PLUGIN_EXTRACTION_GOAL.md`; P0–P5 are complete.
- PR #12 head `3e96b573839b26897cdaa0438a48a9c0f1b39f56`; all six GitHub
  checks passed before this documentation checkpoint was added.
- The source commit extracts reusable memory runtime, recall, write, candidate
  normalization, Dreaming stage orchestration and scheduling into
  `@agent/memory`; Gate supplies KOOK authorization, source provenance and
  PostgreSQL adapters.
- Local validation: memory package build passed; 28 memory tests passed; Gate
  typecheck passed; Gate tests passed (155 pass, 0 fail, 45 PostgreSQL-fixture
  tests skipped locally and covered by CI); `pnpm check:secrets` and
  `git diff --check` passed.

## Candidate deployment

- Protected path: `pnpm devctl goal finish-phase P3` →
  `scripts/release-gate.sh candidate --apply`.
- Source SHA: `3e96b573839b26897cdaa0438a48a9c0f1b39f56`.
- Image: `local/pubg-saas:git-3e96b573839b26897cdaa0438a48a9c0f1b39f56`.
- OCI digest: `sha256:b7ac35a6a8cba3cd711e51c4b0af6ffac71656af205d1fd4709aa1b9f0cb6510`.
- Docker image ID: `sha256:98160a5e40e342586f0cd758869e5e0fbdbea8bdfe139ba9fa56e50b286d5c04`.
- Previous image: `local/pubg-saas:git-f348f13f854834bdc81e2cd0c32024e9a0c5a5e4`.
- Release audit: `DEPLOYED_AND_NOTIFIED`, reason `candidate_healthy`; the
  recorded trace includes build, target verification, backup, migration,
  switch, health, smoke and notification.
- Gateway, Worker and egress-proxy run the candidate image and report healthy.
  PostgreSQL remains healthy on the same PG18.1 image and volume. The separate
  9router service remains on its existing image.
- Live `schema_migrations` confirms both
  `0030_gate_memory_usage_signals.sql` and
  `0031_gate_memory_dreaming_runs.sql`. They add content-free signal and
  idempotent scheduled-run tables; no existing table or row was deleted.
- Runtime feature readiness is `read=enabled_default`, `write=enabled_default`,
  `autoLearn=enabled_default`, `embedding=disabled_unconfigured`.
- M2 remains PAUSED. No M2 clearance was present or created. Lab was not
  changed.

## Backup and recovery

- Protected external checkpoint:
  `/Users/nyannyan/.local/share/pubg-saas-backup/gate-local-20261016T132836Z-3e96b573839b`.
- Encrypted full PostgreSQL dump:
  `pubg-saas.dump.age`, 1,859,793 bytes.
- SHA-256:
  `c71caff3e8dea9595c4e5d794be934b69a6f8f5d04516b2cd2385613fd5961d6`.
- Checkpoint state is `verified_recoverable`; the authenticated archive
  contains 249 `pg_restore --list` entries. The encrypted archive checksum was
  rechecked after deployment.
- Prior Compose and environment copies are in the same owner-only checkpoint.
- A failed health or smoke check follows the protected candidate's automatic
  application rollback, restoring the previous Compose/environment and image
  while retaining the PostgreSQL volume. Since the two migrations are
  additive, an application rollback does not require restoring the whole
  database. For disaster recovery, use the encrypted dump with the Gate backup
  runbook and restore first into a separately named recovery database.
