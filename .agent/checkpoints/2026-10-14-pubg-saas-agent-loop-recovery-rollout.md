# PUBG SaaS Agent tool-loop recovery rollout — 2026-10-14

## Scope

Arthur directed correcting Agent tool-loop behavior, raising the overall
deadline to 300 seconds, allowing up to eight members per KOOK team, avoiding
repeated identical team queries, pushing `main`, replacing only the m2-clean
Gateway and Worker, and performing one real `昨日小队战绩` validation. No
private Kurisu/OpenClaw/9Router, external SaaS 9Router, PostgreSQL, or
egress-proxy container was changed.

## Source and validation

Commit `d936f79` (`fix(pubg-saas): recover agent loops and cap rosters`) was
fast-forward pushed to `origin/main` from `7bea102`.

- Agent deadline: 300 seconds, with 270 seconds for the normal tool loop and a
  reserved 30 seconds for a no-tool summary when completed Domain results need
  recovery. Step timeout is 120 seconds; the 128-step ceiling is only a
  runaway guard. It does not force a no-tool final step during normal queries.
- On timeout, step ceiling, or provider failure after completed tool results,
  the Agent makes one bounded summary attempt using those results. Recovery is
  recorded distinctly from an empty response. If no tool result exists or the
  summary fails, the safe ingress fallback remains active.
- A repeated identical `pubg_query` reuses the first real result, and a repeat
  detected by the Agent switches that turn to a summary step. Team stats and
  ranking expose all eight roster rows in one Domain query.
- Server-side team membership writes enforce eight members transactionally.
  A user's own rebind can replace their prior member at capacity; a ninth new
  member is rejected. Tenant and authorization assertions were retained.

Validation passed:

- `pnpm test:pubg`: 68/68.
- `pnpm test:pubg-saas`: 133/133 using the already-running isolated
  `pubg-saas-pg18` container; it was not restarted.
- Focused Agent, binding, authorizer, resolver, query and ingress integration
  tests: 28/28 using the same isolated PostgreSQL service.
- SaaS typecheck/build, architecture check, `pnpm check:secrets`, and
  `git diff --check`.
- Local Buildx OCI verification: `linux/amd64` and `linux/arm64`, manifest list
  `sha256:0456c731884e546dd438a3e0f0b875911aeb1f530b55176fe3b12d29f9112dee`.

## Encrypted backup and restore rehearsal

The committed image migrated a separate source PostgreSQL 18.1 Compose
project to `0016_agent_authorization_outcomes.sql`. A synthetic tenant/team/job
and future sequence were written only to that source fixture. The age-encrypted
archive verified and restored into a second, freshly created PG18.1 Compose
project. All 39/39 public table counts matched. App transaction rollback,
app DDL denial, backup read-only and sequence restrictions, app sequence use,
and restored default sequence grants passed on both databases. The restored
tenant/team/job counts were 1/1/1. Only the exact marker-protected disposable
database was cleaned. Both test containers were stopped with plain `down`; the
isolated volumes were retained. No production PG was used.

The owner-only local rehearsal files are under
`~/Library/Caches/pubg-saas-m2-current-7249b12/rpo-rto-agent-20261014-d936f79`;
the directory is outside Git. The procedure is documented in
`infra/pubg-saas/BACKUP_RESTORE_REHEARSAL.md`.

## M204 runtime replacement

The protected pre-switch checkpoint is
`/var/tmp/pubg-saas-m2-clean/checkpoints/20261014-pubg-saas-d936f79-pre-switch.txt`
(mode 0600). m2-clean runs ARM64; its new image was loaded locally as
`local/pubg-saas:git-d936f79` (`sha256:7aad5fa11fa4c6f245b9d74862138c9aac1da3c45412f7935b694ac3f3bb622e`).
Compose recreated Gateway and Worker exactly once with `--no-deps --no-build`.
Both started successfully. Worker is healthy; Gateway is running (the Compose
file has no Docker healthcheck for Gateway). A read-only probe reports the
KOOK session connected, updated at `2026-10-14T09:49:02.452Z`.

Only Gateway/Worker container IDs changed. PostgreSQL remained
`e47fd49fcab5…` healthy; egress-proxy remained `c5cd33cba219…` healthy; the
SaaS 9Router remained `2ce598008143…` running. Database migration `0016` was
already present; no production schema migration was run. The stack `.env`
remains mode 0600 and only `PUBG_SAAS_IMAGE` was changed.

## Live model/query acceptance still pending

No new human ingress or Agent run existed immediately after deployment. A
trusted human event is required to exercise the production Gateway → Inbox →
Agent → authorized Domain tool → Outbox path. The bot's own messages are
filtered, and prior operator instructions prohibit KOOK desktop/browser
automation. Arthur was asked to send `昨日小队战绩` in the target group; once it
arrives, inspect only the outcome, failure code, tool-call count/status and
delivery state, without printing message contents or secrets. Do not claim
live Planner acceptance or M2 completion until this succeeds. Stop after that
single live query and wait for Arthur.

## Reproduction commands

Source checks from the repository root:

```sh
pnpm test:pubg
pnpm typecheck:pubg-saas
pnpm build:pubg-saas
pnpm check:architecture
pnpm check:secrets
git diff --check
```

For the PostgreSQL-backed SaaS suite, keep the isolated `pubg-saas-pg18`
container running and pass its database URL to the child test process from a
protected environment; do not print that URL. The focused test file list is in
the command history for this commit.

Multi-platform image verification:

```sh
docker buildx build --platform linux/amd64,linux/arm64 \
  --output type=oci,dest=/tmp/pubg-saas-d936f79.oci.tar \
  --file apps/pubg-saas/Dockerfile .
python3 scripts/verify-pubg-saas-oci.py /tmp/pubg-saas-d936f79.oci.tar
```

The already-authorized two-service replacement command is:

```sh
stack=/var/tmp/pubg-saas-live-0fefe78/repo/infra/pubg-saas
docker compose --project-name pubg-saas-public --project-directory "$stack" \
  --env-file "$stack/.env" -f "$stack/compose.yaml" config --quiet
docker compose --project-name pubg-saas-public --project-directory "$stack" \
  --env-file "$stack/.env" -f "$stack/compose.yaml" \
  up -d --no-deps --force-recreate --no-build --wait gateway worker
```

No live `昨日小队战绩` Agent call, full KOOK user end-to-end acceptance, or M2
completion is recorded in this checkpoint.
