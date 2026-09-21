# Amadeus 1.4.5 — Operation Skuld deployment evidence

Date: 2026-09-21 (Asia/Shanghai)

## Final state

```text
VERSION=1.4.5
OPERATION_SKULD=READY
Mac mini cutover=NOT EXECUTED
Immich source reclaim=PENDING
```

This release preserves the Operation Skuld safety boundary: no Mac mini cutover, no deletion of
`/DATA/Gallery/immich`, no secret rotation, no generic Docker volume/system prune, and no deletion
of unknown AppData or log owners.

## Git and release

- Release commit: `650ba76` (`release: Amadeus 1.4.5`).
- Final pushed `main`: `41acb87` (`fix(ops): make isolated 9router restore writable`).
- Worktree was clean at final live acceptance and `origin/main` was synchronized.
- `scripts/amadeus-version.sh check` passed; release notes contain only the 1.4.5 body.

## Validation-efficiency evidence

The final release-boundary local gate passed:

- `pnpm test`
- `pnpm typecheck`
- `pnpm build`
- `pnpm check:secrets`
- `git diff --check`
- architecture tests
- non-recursive fresh-clone rehearsal with frozen install, fresh build, test, typecheck and secret scan

The final full gate was followed by failure-directed, scope-aware checks for operational shell-only
changes: live backup manifest serialization, tag-scoped image retention, known pressure policy,
health scheduler exit semantics, and exact 9Router isolated restore. These did not change TypeScript
runtime source or image-owned bundled assets. The affected-only dry-run reported:

```text
AUTO_SCOPE_OPENCLAW=build
AUTO_SCOPE_PRODUCT_RADAR=reuse
```

One OpenClaw ARM64 image was built; Product Radar was not rebuilt. Command output was captured with
bounded `scripts/run-check.sh` evidence. The fresh-clone gate explicitly builds the workspace before
running tests because workspace package exports point at generated `dist`.

## Canonical live deployment

- Host: CasaOS inside OrbStack Linux machine `ubuntu`.
- Live checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260921153903`.
- External deployment evidence: `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260921153903`.
- OpenClaw: `local/openclaw-amadeus:git-47ce26ae82a3-20260921153903`.
- Product Radar: `local/product-radar:git-16a8c15d727f-20260921082428` (reused).
- OpenClaw/Product Radar/media adapter health and owner notification passed.
- `doctor.sh`: `0 failure(s), 0 warning(s)`.
- `migration-readiness.sh`: every listed check passed; `OPERATION_SKULD=READY` and
  `IMMICH_SOURCE_RECLAIM=READY_BUT_PENDING`.
- Final sanitized acceptance logs are in the external `final-acceptance/` directory under the
  deployment evidence path above.

## Storage and scheduler

The reported state is intentionally not falsified:

```text
STORAGE_STATUS=critical
externalCapacity=warning
internalCapacity=critical
guestCapacity=critical
guestDataCapacity=critical
dockerLogPolicy=healthy
```

At acceptance time, the configured hard minimum was 10 GiB and all observed required targets had
more than 20 GiB free on the internal/guest filesystems and about 1 TiB free on Avalon. The local
operator acknowledgement is outside Git in `infra/host-profile.env`; it permits readiness to accept
known pressure only while the hard minimum remains satisfied. Storage growth history is maintained
at the external runtime data path, not committed to Git.

- Storage health LaunchAgent: loaded; final health command exited 0 while preserving `critical` facts.
- Weekly maintenance LaunchAgent: loaded; `--scheduled` exercised the safe apply path.
- Final successful maintenance evidence:
  `/Volumes/Avalon/backups/operation-skuld/storage-maintenance/20260921T154412Z` (`GC=passed`).
- The earlier `20260921T154140Z` attempt reported a Docker tag conflict and was not treated as
  acceptance; tag-scoped removal was implemented and the subsequent scheduled run passed.
- Managed Docker logs remain bounded at `local`, `20m`, `5`. Known external/unknown owners remain
  report-only; no generic recreate or log deletion was used.
- Image retention count is 2; checkpoint retention count is 3. Volumes, databases, Immich media,
  secrets and unknown images were not generic GC targets.

## Service-aware backup, secrets and 9Router

Post-deploy service-aware backup:

```text
/Volumes/Avalon/backups/operation-skuld/live-post-1.4.5-20260921T155832Z/service-aware
```

It contains:

- `pubg.sqlite`, `identity.sqlite`, and Product Radar SQLite consistent snapshots created with the
  SQLite backup API, each with integrity, SHA-256, schema and metadata manifest;
- fresh Immich `postgres-20260921T155832Z.dump`, SHA-256 and `pg_restore --list` output;
- exact 9Router image artifact and SHA-256 reference;
- external Immich media reference, not a tar archive.

Final encrypted secret bundle:

```text
/Volumes/Avalon/backups/operation-skuld/live-1.4.5-20260921T155352Z/secrets/secrets-20260921T155354Z
```

The bundle manifest contains metadata-only logical IDs. Import rehearsal validated the encrypted
files, required logical-ID coverage and file modes without printing secret values.

The exact 9Router artifact isolated restore rehearsal passed using a writable temporary copy of
`/DATA/AppData/9router/data`, fixture-only auth, and `--network none`: dashboard 200,
unauthenticated `/v1/models` 401, fixture-authenticated boundary successful. No production
provider network or credential was used.

## HomeLab and manifest/runbook

`docs/OPERATION_SKULD_SERVICE_INVENTORY.md` now explicitly classifies the active services as
`MIGRATE`, `REBUILD`, or `EXTERNAL_DATA` with persistent data, logical secret references, backup,
restore, verification and cutover dependency. Manifest/runbook consistency passed, including
critical persistent data, required secret restore targets and runtime service coverage.

## Immich reclaim boundary

- Live media root: `/Volumes/Avalon/immich/data`.
- Legacy source: `/DATA/Gallery/immich` retained.
- Existing cutover checkpoint and fresh PostgreSQL backup remain external and valid.
- Future reclaim now requires a fresh no-delete one-way checksum equivalence, live mount/health
  checks, a fresh logical dump, and the explicit `RECLAIM_IMMICH_SOURCE_1_4_5` approval token.
- No reclaim was attempted in this goal.

## Completion statement

Amadeus 1.4.5 is released, pushed, deployed to the canonical CasaOS host, and accepted as
`OPERATION_SKULD=READY`. The known storage pressure is recorded truthfully and remains above the
explicit hard minimum. Mac mini cutover and Immich source reclaim are intentionally deferred.
