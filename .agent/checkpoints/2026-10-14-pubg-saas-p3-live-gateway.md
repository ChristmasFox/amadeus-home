# PUBG SaaS P3 live KOOK gateway — isolated M204 acceptance

Date: 2026-10-14 (Asia/Shanghai)

## Scope and safety

Started a new isolated M204 Compose project `pubg-saas-p3-live-058118d` from
Git commit `058118d`, image `local/pubg-saas:git-058118d`, ARM64 manifest
`sha256:fd1825f35b0c953b3e98e1b9f82397e0b3c992d18aa4e0f9237ebc79ae7af017`.
It owns a fresh PostgreSQL 18.1 volume and has applied all 14 migrations.
Gateway, Worker, PostgreSQL and egress proxy are running; Worker and PostgreSQL
health checks pass. A read-only query returned only
`KOOK_WS_SESSION_ESTABLISHED`, confirming that the Gateway completed the KOOK
WebSocket handshake and saved resume state.

Only `KOOK_BOT_ACCOUNT_ID` and `KOOK_BOT_TOKEN` were selected from the
mode-0600 `apps/pubg-saas/.env.local`; a KOOK-only mode-0600 env file is kept
outside Git under `$HOME/Library/Caches/pubg-saas-p3-live-058118d/`. Gateway
runtime reports both KOOK fields present and reports no PUBG or model key.
The acceptance-only synthetic resolver is enabled; it recognizes four fixed
Steam fixture names and never falls back to PUBG. It is rejected when
`NODE_ENV=production`. Worker uses a clearly named non-credential placeholder
and is attached only to the internal PostgreSQL network; it has no route to
the egress proxy or public Internet. Model credentials are absent. No real PUBG
or model request is possible in this setup.

The Gateway's public egress is limited to the checked-in guarded proxy for KOOK
WebSocket/API access. The disposable database has no production data. No image
was pushed; no production deployment, 9Router change, private OpenClaw restart,
or private Kurisu data access occurred. The live stack is intentionally left
running while Arthur performs the human steps below.

## Ordered human KOOK checks

Use Channel A (an existing text channel) and the newly created Channel B in
the same test server. Arthur must be the server owner/Administrator. Have one
ordinary non-admin member available for the denial checks.

1. In Channel A, Arthur sends:

   ```text
   /pubg create steam "P3 Synthetic Demo Squad" P3SyntheticAlpha P3SyntheticBravo
   ```

   The bot should return a create-and-bind confirmation card. The two player
   names resolve only to fixed synthetic IDs; they are not real PUBG accounts.

2. Have the ordinary member click the confirmation button first. It must be
   rejected, with no team created. Arthur then clicks the same button; creation
   should succeed and the bot should return a team ID. If the button remains
   clickable, click it once more; the consumed one-use confirmation must be
   rejected and must not create another team.

3. In Channel A, send `/pubg teams` twice. Both replies should list exactly
   the single `P3 Synthetic Demo Squad` and the same team ID.

4. In Channel B, send `/pubg status`. The bot should report that this channel
   is unbound. Then Arthur sends `/pubg bind <team-id>` using the ID from step 2
   and clicks the confirmation. `/pubg status` in both channels should now show
   the same team; the response should show two bound channels.

5. In Channel B, Arthur sends `/pubg preference kills`. The bot should return
   an admin confirmation card. Have the ordinary member click it first; the
   callback must be rejected and the preference must remain unchanged. Arthur
   then clicks the same card; the callback should succeed. `/pubg preference`
   should report `kills`. The ordinary member should also send
   `/pubg disband`; the bot must deny the command and return no confirmation
   card.

All PUBG identities and match statistics are synthetic or absent. This
acceptance checks live KOOK transport, message handling, Postgres persistence,
channel binding, replay protection and authorization callbacks. It does not
claim real PUBG statistics, AI/model queries, quota eligibility, or separate
guild/tenant isolation from a same-server second channel. Those remain separate
gates.

## Reproduction commands

The local ARM64 image can be rebuilt from the Git checkout; it was not pushed.
Compose files and database-password files are in the root-only M204 directory
`/var/tmp/pubg-saas-p3-live-058118d/`. The KOOK-only env file stays outside Git;
never print or commit it. `--apply` is already part of both Gateway and Worker
container commands. Build, start, and inspect with:

```sh
source scripts/host-profile.sh
amadeus_host_profile_load "$PWD"
orb -m "$ORBSTACK_MACHINE" -u root docker buildx build \
  --platform linux/arm64 --load \
  -f apps/pubg-saas/Dockerfile \
  -t local/pubg-saas:git-058118d .
BASE=/var/tmp/pubg-saas-p3-live-058118d
dcompose() {
  orb -m "$ORBSTACK_MACHINE" -u root docker compose \
    --project-name pubg-saas-p3-live-058118d --project-directory "$BASE" \
    --env-file "$BASE/.env" -f "$BASE/compose.yaml" "$@"
}
dcompose up -d --wait postgres egress-proxy
dcompose --profile ops run --rm migrate
dcompose up -d --wait gateway worker
dcompose ps
dcompose exec -T postgres \
  psql -U pubg_bootstrap -d pubg_saas -Atqc \
  "SELECT CASE WHEN count(*)=1 AND count(*) FILTER (WHERE session_id IS NOT NULL)=1 THEN 'KOOK_WS_SESSION_ESTABLISHED' ELSE 'KOOK_WS_SESSION_NOT_ESTABLISHED' END FROM kook_gateway_state"
```

The operator-only `.env.local` filtering step that creates the required
KOOK-only env file is recorded in the live task context; it must never be
replaced with the full `.env.local`. To re-apply/start after an intentional
stop, reuse the existing protected files and the same Compose commands above.
Do not use `down -v`; the live P3 project owns its isolated PostgreSQL volume.

## Operator readiness gate — 2026-10-14

Arthur deferred the human interaction steps until the second text channel and
test account are ready. Readiness has not been confirmed. Do not use desktop or
browser automation to open KOOK, and do not send messages. The isolated project
remains available from the already-running Gateway session; its presence does
not count as human-flow acceptance.
