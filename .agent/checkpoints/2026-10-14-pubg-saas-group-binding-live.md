# PUBG SaaS group binding isolated live checkpoint — 2026-10-14

## Scope and authorization

Arthur authorized fixing Planner compatibility, then implementing the
group-only account-binding flow, and replacing only Gateway/Worker on isolated
OrbStack VM `pubg-saas-m2-clean`. No production service, private OpenClaw,
private 9Router, or real 9Router configuration was changed. The PG backup
rehearsal remains paused. No PUBG lookup, user-message test, extra model call,
or image push was performed in this checkpoint.

## Source and validation

- Planner fix: `53b49e5` sends explicit `stream:false` for the AI SDK's
  non-streaming generation request; one real isolated Planner request passed.
- Binding implementation: `8bcbe4c4812a72a9c4841a8d4df7b62eda0f3bfb`.
- SaaS PostgreSQL integration suite: 117/117 passed on the reusable isolated
  PostgreSQL 18.6 fixture; no skips or failures.
- Private Kurisu regression: 68/68 passed. SaaS and private PUBG typechecks,
  architecture check, `pnpm check:secrets`, and `git diff --check` passed.
- No database migration was added.

The new group flow provisions one team per KOOK guild and binds the verified
text channel. Self-binding accepts `/pubg me <name>` (Steam default) and
supported group declarations; real PUBG resolution must return one account
before any claim is written. A missing account replies exactly
`查不到该 PUBG 账号`; a user may replace their own mapping. Delegation resolves
the target only from trusted KOOK mention metadata and requires the actor to be
a current guild admin and both users to be current text-channel members.
Natural-language classification returns one of two bounded write intents,
cannot supply IDs, and rejects names absent literally from the message. Team
rename checks current channel membership and the bound tenant/team. Legacy
commands remain supported. Tests cover these checks, duplicate claims,
transactional writes, no-write-on-failed-lookup, and tenant isolation.

## Image and runtime change

Buildx generated and verified both `linux/amd64` and `linux/arm64` for commit
`8bcbe4c`. OCI manifest-list digest:
`sha256:72000a4c40ab4bdedf4a82d37a609cba62f3e218d7fed49d88e761f1d4741f6d`.
The M204 ARM64 image config ID is
`sha256:f55c83553c55321a1d8ca9c89a032cc14daf847ec949cb05c4b687a347e031cc`.
Image tag: `local/pubg-saas:git-8bcbe4c4812a72a9c4841a8d4df7b62eda0f3bfb`.
The image was transferred locally from the build VM; the OCI archive was
removed after verification.

On `pubg-saas-m2-clean`, only `pubg-saas-public-gateway-1` and
`pubg-saas-public-worker-1` were recreated with Compose `--no-deps`:

| Service | Previous container | New container | Result |
| --- | --- | --- | --- |
| Gateway | `4a4b3e78efb8` | `d2de5a5f5277` | Running; no Docker healthcheck is configured |
| Worker | `9efa03840c34` | `9da064eb31de` | Running, healthy |

PostgreSQL stayed `e47fd49fcab5` (healthy), egress-proxy stayed
`c5cd33cba219` (healthy), and isolated `pubg-saas-9router` stayed
`2ce598008143` (running). The mode-0600 stack `.env` changed only its
`PUBG_SAAS_IMAGE` reference. A read-only query returned
`connected=true`, `updated_at=2026-10-14T04:17:30.168Z` for the Gateway's
KOOK session state; Gateway started at `2026-10-14T04:17:29.561Z`.

## Reproduction commands

From the repository root, build and verify the multi-platform OCI image on the
OrbStack build VM, then load its ARM64 image locally:

```sh
orb -m nyannyan -u root bash -lc 'cd /Users/nyannyan/amadeus-home && docker buildx build --platform linux/amd64,linux/arm64 --progress=plain --resource memory=4g --resource cpu-quota=400000 --output type=oci,dest=/var/tmp/pubg-saas-8bcbe4c-multiarch.oci -f apps/pubg-saas/Dockerfile . && python3 scripts/verify-pubg-saas-oci.py /var/tmp/pubg-saas-8bcbe4c-multiarch.oci'
orb -m nyannyan -u root docker load -i /var/tmp/pubg-saas-8bcbe4c-multiarch.oci
orb -m nyannyan -u root docker image tag sha256:72000a4c40ab4bdedf4a82d37a609cba62f3e218d7fed49d88e761f1d4741f6d local/pubg-saas:git-8bcbe4c4812a72a9c4841a8d4df7b62eda0f3bfb
orb -m nyannyan -u root docker save local/pubg-saas:git-8bcbe4c4812a72a9c4841a8d4df7b62eda0f3bfb | orb -m pubg-saas-m2-clean -u root docker load
```

The isolated stack update used:

```sh
stack=/var/tmp/pubg-saas-live-0fefe78/repo/infra/pubg-saas
orb -m pubg-saas-m2-clean -u root bash -lc 'stack=/var/tmp/pubg-saas-live-0fefe78/repo/infra/pubg-saas; sed -i "s#^PUBG_SAAS_IMAGE=.*#PUBG_SAAS_IMAGE=local/pubg-saas:git-8bcbe4c4812a72a9c4841a8d4df7b62eda0f3bfb#" "$stack/.env"; chmod 600 "$stack/.env"; docker compose --project-name pubg-saas-public --project-directory "$stack" --env-file "$stack/.env" -f "$stack/compose.yaml" config --quiet; docker compose --project-name pubg-saas-public --project-directory "$stack" --env-file "$stack/.env" -f "$stack/compose.yaml" up -d --no-deps --force-recreate --wait gateway worker'
```

Worker health and container IDs can be checked without displaying environment
values with `docker inspect` and `docker ps`. The sanitized KOOK state probe
constructs its database URL from the in-container secret file but only prints
a boolean and timestamp:

```sh
orb -m pubg-saas-m2-clean -u root docker exec pubg-saas-public-gateway-1 node --input-type=module -e 'import fs from "node:fs"; import {Pool} from "pg"; const url=new URL(process.env.PUBG_SAAS_DATABASE_URL); url.password=fs.readFileSync(process.env.PUBG_SAAS_DATABASE_PASSWORD_FILE,"utf8").replace(/\r?\n$/u,""); const pool=new Pool({connectionString:url.toString()}); try { const r=await pool.query("SELECT session_id IS NOT NULL AS connected, updated_at FROM kook_gateway_state WHERE bot_account_id=$1",[process.env.KOOK_BOT_ACCOUNT_ID]); console.log(JSON.stringify({connected:r.rows[0]?.connected===true,updatedAt:r.rows[0]?.updated_at??null})); } finally { await pool.end(); }'
```

Arthur's manual KOOK acceptance remains pending. No additional model/PUBG
requests should be made before that acceptance.
