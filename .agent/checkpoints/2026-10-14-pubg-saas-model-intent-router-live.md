# PUBG SaaS model-routed KOOK group ingress — 2026-10-14

## Result

Arthur corrected the earlier phrase-gated design. Commit `da039536d2f7c37d47995282e8a001cacf0897c2` removes that prefilter. A schema-valid, bounded KOOK text message from a non-bot author now enters durable ingress and is passed to the constrained AI SDK classifier after persisted per-user/channel/tenant/bot rate admission. Model output is one of:

- `declare_pubg_account` (self or a validated mentioned member)
- `rename_team`
- `query_stats`
- `legacy_command`
- `unsupported` (silent)

The model gets no identity/tenant/permission fields and cannot select a write target. Account/team names must occur literally in the submitted text. Only KOOK-validated mention IDs can select a delegated target; fresh admin/member checks and real PUBG resolution before persistence remain in application code. The existing query authorizer and fixed Domain executor still scope statistics. Model input is capped at 800 characters, output at 100 tokens, with no retries. Deterministic parsing of explicit `/pubg`/`!pubg` commands is only used when no classifier is configured or no valid structured result is returned. Model `unsupported` is silent.

Trusted-event, admission, processing and classifier silence logs contain a fixed stage/reason, a rate-limited count, and only a validated numeric channel ID where available. They contain no message, user, or secret values. Self-authored messages and messages marked as another bot are rejected before classification. Existing durable request rates and queue bounds remain enabled.

The earlier raw KOOK messages were not retained, so their exact individual parser reason cannot be reconstructed. The source defect was reproducible: `request-event.ts` discarded ordinary chat before durable ingress, and the test asserted that an unmentioned stats query parsed as `null`. That hard gate is now removed.

## Validation

- `pnpm typecheck:pubg-saas` passed.
- `pnpm test:pubg-saas` passed 121/121 with the reused isolated PostgreSQL 18.6 fixture on loopback port 55432; no skips.
- `pnpm test:pubg` passed 68/68 (private Kurisu regression).
- `pnpm check:architecture`, `pnpm check:secrets`, and `git diff --check` passed.
- Tests prove arbitrary chat reaches the classifier, unsupported intent creates no outbox reply, no message text enters diagnostics, self/other bot messages are dropped, mention IDs remain outside the model prompt, old commands still work, and model failure falls back only for explicit legacy commands. Existing PG tests continue covering permission denial before PUBG lookup, verified account writes, conflict/overwrite behavior, channel membership, tenant isolation, query scope and cross-tenant boundaries.
- The known KOOK text channels `6115211415447433` and `6521538183595713` are both accepted by the trusted-event tests. No human message was sent during this change.

## Image and isolated M204 replacement

Buildx verified `linux/amd64` and `linux/arm64` in local OCI manifest list `sha256:51e8d08f30e184c6eae5bb045cbf308704434d2c46473f5575f679fd10d85d70`. The local immutable tag is `local/pubg-saas:git-da039536d2f7c37d47995282e8a001cacf0897c2`. The image was transferred from OrbStack machine `nyannyan` to `pubg-saas-m2-clean` with `docker save|load`; it was not pushed.

Only Gateway and Worker were recreated in Compose project `pubg-saas-public`:

| Service | Before | After | Result |
| --- | --- | --- | --- |
| Gateway | `9da169a9dce0` | `d153f94c8269` | running, restart count 0; no Docker healthcheck |
| Worker | `a7a59a056668` | `7c0737c9dfa4` | running, healthy, restart count 0 |

Compose `--wait` returned successfully. A read-only PG query returned `connected=true`, `last_sn=27`, `updated_at=2026-10-14T05:01:34.691Z` for the persisted KOOK session. PostgreSQL `e47fd49fcab5`, egress-proxy `c5cd33cba219`, and isolated 9Router `2ce598008143` retained their IDs. The ignored stack `.env` remains mode 0600 and its only change was the image reference. No migration, message send, PUBG lookup, model request, image push, private OpenClaw/9Router operation, or production deployment occurred. The two temporary planner PG rehearsal containers had already been removed without deleting volumes.

## Reproduction commands

From repository root, build and verify the local multi-platform OCI archive, then transfer it without a registry:

```sh
orb -m nyannyan -u root bash -lc 'cd /Users/nyannyan/amadeus-home && docker buildx build --platform linux/amd64,linux/arm64 --progress=plain --resource memory=4g --resource cpu-quota=400000 --output type=oci,dest=/var/tmp/pubg-saas-da03953-multiarch.oci -f apps/pubg-saas/Dockerfile . && python3 scripts/verify-pubg-saas-oci.py /var/tmp/pubg-saas-da03953-multiarch.oci'
orb -m nyannyan -u root docker load -i /var/tmp/pubg-saas-da03953-multiarch.oci
orb -m nyannyan -u root docker image tag sha256:51e8d08f30e184c6eae5bb045cbf308704434d2c46473f5575f679fd10d85d70 local/pubg-saas:git-da039536d2f7c37d47995282e8a001cacf0897c2
orb -m nyannyan -u root docker save local/pubg-saas:git-da039536d2f7c37d47995282e8a001cacf0897c2 | orb -m pubg-saas-m2-clean -u root docker load
```

Only Gateway and Worker were replaced:

```sh
orb -m pubg-saas-m2-clean -u root bash -lc 'stack=/var/tmp/pubg-saas-live-0fefe78/repo/infra/pubg-saas; sed -i "s#^PUBG_SAAS_IMAGE=.*#PUBG_SAAS_IMAGE=local/pubg-saas:git-da039536d2f7c37d47995282e8a001cacf0897c2#" "$stack/.env"; chmod 600 "$stack/.env"; docker compose --project-name pubg-saas-public --project-directory "$stack" --env-file "$stack/.env" -f "$stack/compose.yaml" config --quiet; docker compose --project-name pubg-saas-public --project-directory "$stack" --env-file "$stack/.env" -f "$stack/compose.yaml" up -d --no-deps --force-recreate --wait gateway worker'
```

Read-only health and container-ID checks (do not print container environment):

```sh
orb -m pubg-saas-m2-clean -u root docker inspect --format '{{.Name}}|{{.Id}}|{{.State.Status}}|{{.RestartCount}}|{{.Config.Image}}' pubg-saas-public-gateway-1 pubg-saas-public-worker-1 pubg-saas-public-postgres-1 pubg-saas-public-egress-proxy-1 pubg-saas-9router
orb -m pubg-saas-m2-clean -u root docker inspect --format '{{.State.Health.Status}}' pubg-saas-public-worker-1
orb -m pubg-saas-m2-clean -u root docker exec pubg-saas-public-gateway-1 node --input-type=module -e 'import fs from "node:fs"; import {Pool} from "pg"; const url=new URL(process.env.PUBG_SAAS_DATABASE_URL); url.password=fs.readFileSync(process.env.PUBG_SAAS_DATABASE_PASSWORD_FILE,"utf8").replace(/\r?\n$/u,""); const pool=new Pool({connectionString:url.toString()}); try { const r=await pool.query("SELECT session_id IS NOT NULL AS connected,last_sn,updated_at FROM kook_gateway_state WHERE bot_account_id=$1",[process.env.KOOK_BOT_ACCOUNT_ID]); const row=r.rows[0]; console.log(JSON.stringify({connected:row?.connected===true,lastSn:row?.last_sn??null,updatedAt:row?.updated_at??null})); } finally { await pool.end(); }'
```

No live KOOK or provider test was sent; Arthur's manual test remains the next acceptance step.
