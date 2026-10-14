# PUBG SaaS KOOK ingress diagnostics checkpoint — 2026-10-14

## Finding

The gateway had a live WebSocket sequence and no process restart, while durable
group ingress/outbox stopped advancing. The raw messages after the previous
deployment were not retained, and Docker logs were empty, so the exact parser
result for each historical message cannot be recovered. The source-level
cause was reproducible: `request-event.ts` required a bot mention, `/pubg`
prefix, or a small account/team binding phrase before inserting a group
message. The existing test explicitly asserted that `查一下今天击杀` returned
`null`. Those queries never reached PostgreSQL or the public query handler.

Read-only API listing confirmed two ordinary text channels in the same KOOK
server: existing `6115211415447433` and new `6521538183595713`. Only the first
was bound before this fix. Since channel auto-provisioning happens after
ingress admission, the prefilter also prevented the new channel from reaching
the existing fresh-membership check and lazy-binding path.

## Source change and tests

Source commit: `fb1681868947aa57c2195a26ab81186f1110e951`.

- Admit bounded unmentioned PUBG stats-query candidates, group account/team
  writes, and explicit `/pubg` commands. Unrelated group chatter remains
  filtered before the model path.
- Preserve the strict KOOK event envelope, actor ID equality, guild/channel
  fields, text-channel type, message size, and timestamp validation. Reject
  both KOOK `author.bot=true` and the configured bot's own user ID.
- Add `inspectKookRequest` and fixed parser rejection reason codes. The durable
  ingress observer emits structured JSON with stage, reason, count, and numeric
  channel ID only. It never includes message text, user ID, message ID, or
  credentials, and caps each reason/channel at one event per minute.
- Existing durable ingress limits continue to cap accepted requests at the
  configured per-user, channel, tenant, and bot limits.
- Tests prove unrelated chatter is not admitted, unmentioned stats queries are
  admitted for both real channel IDs, malformed actor metadata reports only a
  fixed reason, self-authored messages are rejected, diagnostics omit message
  and actor content, and a fresh text channel requires live member validation
  before it binds to the guild's single team.

Final validation: SaaS/PostgreSQL suite 120/120; private Kurisu regression
68/68; `pnpm typecheck:pubg-saas`, `pnpm typecheck:pubg`, `pnpm test:pubg`,
`pnpm check:architecture`, `pnpm check:secrets`, and `git diff --check` passed.
The existing isolated PostgreSQL 18.6 fixture on loopback port 55432 was reused.
One intermediate full-suite run exposed only a new test-fixture account-name
collision; the fixture was corrected and the final full suite passed.

## Local image and isolated M204 runtime

Buildx produced and verified `linux/amd64` and `linux/arm64`, OCI manifest list
`sha256:2779458c51433194631d092cbec2966fcbbd1ce1b3273d3f07522c4ff3252fbf`.
The local tag is
`local/pubg-saas:git-fb1681868947aa57c2195a26ab81186f1110e951`. The image was
loaded directly into M204; no registry push occurred.

On `pubg-saas-m2-clean`, only Gateway/Worker were recreated with
`--no-deps --force-recreate --wait`:

| Service | Before | After | Post-restart |
| --- | --- | --- | --- |
| Gateway | `d2de5a5f5277` | `9da169a9dce0` | running, restart count 0; no Docker healthcheck is configured |
| Worker | `9da064eb31de` | `a7a59a056668` | running, healthy, restart count 0 |

Compose reported successful wait for both services. A read-only PG probe
returned `connected=true`, `last_sn=27`, `updated_at=2026-10-14T04:48:43.937Z`
for the KOOK gateway state. PostgreSQL `e47fd49fcab5`, egress-proxy
`c5cd33cba219`, and isolated 9Router `2ce598008143` kept their container IDs.
The only `.env` edit was the immutable `PUBG_SAAS_IMAGE` tag; mode remains 0600.
No migration, message send, live PUBG request, or extra model request was made.

Arthur's two named temporary planner rehearsal PG containers were removed:
`pubg-saas-m2-planner-source-20261014-postgres-1` (`a324a11edb9d`) and
`pubg-saas-m2-planner-restore-20261014-postgres-1` (`b2f9c11d0f08`). Plain
`docker rm -f` was used; their volumes were not removed. The public PG, proxy,
9Router, private OpenClaw and private 9Router were untouched.

## Reproduction commands

From repository root, build and verify the multiarch OCI archive on the local
OrbStack builder:

```sh
orb -m nyannyan -u root bash -lc 'cd /Users/nyannyan/amadeus-home && docker buildx build --platform linux/amd64,linux/arm64 --progress=plain --resource memory=4g --resource cpu-quota=400000 --output type=oci,dest=/var/tmp/pubg-saas-fb16818-multiarch.oci -f apps/pubg-saas/Dockerfile . && python3 scripts/verify-pubg-saas-oci.py /var/tmp/pubg-saas-fb16818-multiarch.oci'
orb -m nyannyan -u root docker load -i /var/tmp/pubg-saas-fb16818-multiarch.oci
orb -m nyannyan -u root docker image tag sha256:2779458c51433194631d092cbec2966fcbbd1ce1b3273d3f07522c4ff3252fbf local/pubg-saas:git-fb1681868947aa57c2195a26ab81186f1110e951
orb -m nyannyan -u root docker save local/pubg-saas:git-fb1681868947aa57c2195a26ab81186f1110e951 | orb -m pubg-saas-m2-clean -u root docker load
```

The isolated live service replacement command was:

```sh
stack=/var/tmp/pubg-saas-live-0fefe78/repo/infra/pubg-saas
orb -m pubg-saas-m2-clean -u root bash -lc 'stack=/var/tmp/pubg-saas-live-0fefe78/repo/infra/pubg-saas; sed -i "s#^PUBG_SAAS_IMAGE=.*#PUBG_SAAS_IMAGE=local/pubg-saas:git-fb1681868947aa57c2195a26ab81186f1110e951#" "$stack/.env"; chmod 600 "$stack/.env"; docker compose --project-name pubg-saas-public --project-directory "$stack" --env-file "$stack/.env" -f "$stack/compose.yaml" config --quiet; docker compose --project-name pubg-saas-public --project-directory "$stack" --env-file "$stack/.env" -f "$stack/compose.yaml" up -d --no-deps --force-recreate --wait gateway worker'
```

Verify without displaying secrets:

```sh
orb -m pubg-saas-m2-clean -u root docker inspect --format '{{.Name}}|{{.State.Status}}|{{.RestartCount}}|{{.Config.Image}}' pubg-saas-public-gateway-1 pubg-saas-public-worker-1 pubg-saas-public-postgres-1 pubg-saas-public-egress-proxy-1 pubg-saas-9router
```

No manual messages were sent. Arthur's KOOK acceptance is next; the first
eligible member message in the new channel should exercise fresh membership
validation and lazy binding. The PostgreSQL backup/restore drill remains
paused.
