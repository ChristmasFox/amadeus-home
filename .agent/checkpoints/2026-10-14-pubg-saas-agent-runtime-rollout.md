# PUBG SaaS conversational Agent rollout checkpoint — 2026-10-14

## Scope and decision

Roll out the public conversational Agent correction to the already authorized
M204 public stack. Keep the independent PostgreSQL, egress proxy and 9Router
containers, all private Kurisu/OpenClaw resources, and the established tenant,
permission and shared PUBG Domain boundaries unchanged. Replace only Gateway
and Worker. This is an M2 checkpoint, not M2 completion: Arthur must verify the
real KOOK conversation experience.

## Source and local verification

- `1e74e5a feat(pubg-saas): route KOOK chat through AI agent` makes the bounded
  Vercel AI SDK `ToolLoopAgent` the main trusted-message path. The existing
  QueryPlan schema, authorized executor, shared Domain and server-derived
  tenant/team/user scope remain in use.
- `f5c40e2 fix(pubg-saas): forward backup snapshot SQL input` fixes stdin
  forwarding in the Compose PostgreSQL utility so encrypted snapshot export
  can stream correctly.
- `pnpm test:pubg-saas`: 126/126 passed against the isolated PostgreSQL test
  instance; no skips.
- `pnpm test:pubg`: 68/68 private PUBG/Kurisu regression tests passed.
- `pnpm typecheck:pubg`, `pnpm typecheck:pubg-saas`, and
  `pnpm --filter @agent/pubg-saas build`: passed.
- Architecture check, `pnpm check:secrets`, and `git diff --check`: passed.
- `python3 -m unittest discover -s scripts/tests -p 'test_pubg_saas_*.py' -v`:
  24 tests passed, including the snapshot stdin regression.
- Local Buildx OCI verification passed for `linux/amd64` and `linux/arm64`.
  The ARM64 image is `local/pubg-saas:git-f5c40e2`; no image was pushed.
- An isolated synthetic encrypted backup restored to a separate fresh PG
  container. All 39/39 public tables matched; fixture tenant/team/conversation
  and Agent rows matched; app DML, app no-DDL, backup read-only, sequence-read
  and app sequence-use probes passed. The restored database was not connected
  to a Worker because its deliberately due synthetic sync job could trigger a
  provider request.

## M204 public stack rollout

Before migration, a public-schema-only encrypted snapshot was created and
verified with `pg_restore --list`. The protected artifact is
`pubg-saas-public-pre-agent-20261014.dump.age`, SHA-256
`5971eb44a4cb40138d219ec434eb84c63c32406154cc3e1e9b5b7905e9846f54`; it
contains 37 public base tables and migration `0014`. The encryption identity,
manifest and artifact remain in protected host-local storage and are not in
Git.

Only the protected live Compose image setting changed. Additive migrations
`0015` and `0016` were applied. Only `gateway` and `worker` were recreated with
`local/pubg-saas:git-f5c40e2`:

| Service | Result after rollout |
| --- | --- |
| Gateway | Running; 0 restarts; new image; Docker does not report a healthcheck for this service |
| Worker | Healthy; 0 restarts; new image |
| PostgreSQL | Healthy; existing container ID preserved; migration `0016` |
| egress-proxy | Healthy; existing container ID preserved |
| independent 9Router | Running; existing container ID preserved |

The Gateway database has a non-null KOOK session and `last_sn=29`. At the final
read-only check, that sequence had not advanced in the prior two minutes; this
is session-state evidence, not proof that a human message receives a reply. No
matching provider/fatal/panic error log lines were present in the preceding
two-minute log window. The local outbound budget usage row read 15/200; existing
usage attribution and KOOK developer-account eligibility are unverified.

The deployment smoke did not send a group message or intentionally call the
model or PUBG API. No PUBG/model credential was read for the isolated test
projects. The production stack's configured provider credentials were left
unchanged. Private OpenClaw/Kurisu, private 9Router and 9Router configuration
were not touched.

## Manual KOOK acceptance remaining

Arthur should send these messages in the real test server, including the
second text channel, and judge response quality and identity handling:

1. `你好` — the bot replies without a mention or command.
2. `今晚开黑吗` — ordinary game conversation gets a natural answer.
3. `昨天谁伤害最高` — when real data/team setup is available, the Agent uses
   the authorized stats tool and summarizes its actual result.
4. `那他踢队友了吗` — follow-up resolves the correct player and uses the
   appropriate kick/melee data; insufficient coverage is stated honestly.
5. A natural-language self-bind and an admin `@member` bind — PUBG lookup must
   succeed before persistence; a missing account or unauthorized delegation
   must not save.
6. Alternate messages from two members — no user context or permissions cross.
7. If no team is provisioned in a test channel, ordinary chat still works and
   a data request explains how to set up a team.
8. Observe a normal provider/tool failure if one occurs; the bot should send a
   safe fallback and retain a traceable run status. Do not intentionally
   destabilize the live provider configuration just to induce an error.

No one should use desktop/browser automation for these checks. Until Arthur
reports acceptance, M2 and the Goal remain open.

## Reproduction and rollback

Source checks already run for this checkpoint:

```sh
PUBG_SAAS_TEST_DATABASE_URL='<isolated PostgreSQL test URL>' pnpm test:pubg-saas
pnpm test:pubg
pnpm typecheck:pubg
pnpm typecheck:pubg-saas
pnpm --filter @agent/pubg-saas build
python3 -m unittest discover -s scripts/tests -p 'test_pubg_saas_*.py' -v
pnpm check:architecture
pnpm check:secrets
git diff --check
```

The M204 Compose directory and prior image setting are protected host-local
state. For an authorized rollback, restore the saved pre-deploy image setting
there and run:

```sh
docker compose up -d --no-deps --wait gateway worker
```

Migration `0015`/`0016` is additive; PostgreSQL rollback requires no destructive
schema operation. The encrypted pre-migration snapshot remains available
outside Git.
