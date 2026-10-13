# PUBG KOOK SaaS source

This package implements public persistence, authorization and the current KOOK
transport slice from `docs/PUBG_KOOK_SAAS_V0_1_GOAL.md`: PostgreSQL migrations and a
`PubgRepositoryPort` adapter, a trusted group-message parser, fresh guild
permission checks, transactional squad/channel/roster management with one-use
confirmations, and direct-message scoped self-declared account claims. The KOOK
gateway, durable ingress, processing loop and channel/direct-message outbox
are wired into an executable source entry point. Current management commands
cover team status, unbind/disband confirmation, and private account status and
unclaim. Full onboarding/create/roster UI, PUBG name lookup, query handling,
ingestion worker, AI SDK and deployment images remain in progress. The service
is not deployed, and live button behavior has not been checked in a test guild.

## Trust boundaries

- Callers construct `TeamContext` only after resolving a verified KOOK event
  and tenant/team ownership in server code.
- Result sets and conversation state require a `TrustedConversationScope`
  created from the verified bot, user, channel and an opaque server-generated
  session ID. Model/tool arguments never define that scope.
- The adapter checks that the trusted channel remains bound to the selected
  tenant/team, or that a direct message has a `team_user_access` grant for the
  selected team. Session state is keyed by tenant, team, bot, user, channel and
  session. Match and telemetry facts are shared inside the public database;
  match selection is constrained by the trusted team's PUBG account IDs.
- `TeamAdminService` accepts a parser-produced trusted group event and calls
  `KookPermissionClient` on every management action before beginning a DB
  transaction. Roster replacement/addition, channel unbinding and disbanding
  use hashed, one-use confirmation tokens bound to actor, guild, bot and
  channel. The parser drops the gateway's role list; the permission client
  reads current KOOK state. Team rows keep the selected PUBG shard.
- `AccountClaimService` accepts parser-produced direct messages or button callbacks, limits a
  claim to the KOOK user, and labels it `self_declared`. Confirmation is
  one-use; unique constraints prevent a second user from claiming the same
  shard/account pair. This is not proof of game-account ownership.
- `KookGatewayClient` persists the session ID and last successfully handled
  sequence, buffers out-of-order frames, sends heartbeat/resume signals, and
  clears session sequence state on the server's reconnect signal. Its socket
  factory uses Node 22's built-in WebSocket. Frame size and queued-frame count
  are bounded; shutdown drains in-flight durable writes. Coverage remains offline.
- `KookIngressQueue` is the runtime's sole gateway ingress. It persists only
  explicit `/pubg`/`!pubg` commands, messages mentioning this bot, DMs addressed
  to it and documented button callbacks. Stored fields exclude display names,
  cached roles, attachments and verification tokens. Existing group bindings
  are pinned at reception and rechecked before processing/reply completion;
  unbound requests cannot inherit a newly bound team's context.
- Admission defaults to 1000 pending requests per bot and 20 per actor; these
  are configurable limits, not a capacity benchmark. Processing uses leases,
  bounded retry, per-actor/channel ordering and expiry. Request payload TTL
  defaults to one hour (configurable up to 24 hours); terminal payloads are
  scrubbed immediately and dedupe tombstones retained for 24 hours.
- Reply completion and outbox enqueue commit in one transaction. Business
  mutations keep an actor/bot/source-event receipt for up to 24 hours: an exact
  callback redelivery can recover its result after a crash; a new click cannot
  reuse the consumed token. Group mutation callbacks acknowledge privately to
  their original actor, including after the channel is unbound or team removed.
- `KookMessageQueue` deduplicates bound group events and enqueues replies only
  to the original bound channel. Outbox claims use expiring leases and
  `SKIP LOCKED`; delivery errors are reduced to bounded codes with retry
  backoff. Replies carry the original message ID and a local idempotency nonce.
  KOOK documents that it does not process the nonce for deduplication, so a
  lost send response can still cause an at-least-once duplicate. Payloads are
  cleared after success/dead-letter. `KookApplicationRuntime` runs serial
  ingress/outbox processors and retention cleanup. Outbox destinations come
  from stored ingress, and bound channel delivery rechecks the current binding.
  An already in-flight HTTP send may finish while an unbind takes place.
- Public credentials and `DATABASE_URL` are runtime-only. No real credential
  is needed for local repository tests.

The current permission check reads guild ownership from `guild/view`, the
current member roles from `guild/user-list?filter_user_id=...`, and role
permission bits from `guild-role/list`. It treats only guild ownership or the
Administrator bit as sufficient for guild-management actions. The gateway
event's embedded role list is not used as current authority. These contracts
follow the [KOOK HTTP API reference](https://developer.kookapp.cn/doc/reference),
[guild API](https://developer.kookapp.cn/doc/http/guild),
[guild-role API](https://developer.kookapp.cn/doc/http/guild-role) and
[group message event format](https://developer.kookapp.cn/doc/event/message).
Gateway framing, heartbeat, sequence, resume and reconnect handling follows
the [KOOK WebSocket protocol](https://developer.kookapp.cn/doc/websocket) and
[gateway URL API](https://developer.kookapp.cn/doc/http/gateway). The REST
sender follows the [channel message API](https://developer.kookapp.cn/doc/http/message)
and [direct-message API](https://developer.kookapp.cn/doc/http/direct-message).
Visible reply quotation uses `quote`; `reply_msg_id` separately associates a
reply for KOOK's quota calculation.

## Source entry points

After `pnpm build:pubg-saas`, both commands below are dry-run and open no network
connection:

```sh
node apps/pubg-saas/dist/src/migrate-database.js
node apps/pubg-saas/dist/src/gateway.js
```

The separately authorized public runtime phase must supply its independent
`DATABASE_URL`, `KOOK_BOT_ACCOUNT_ID` and `KOOK_BOT_TOKEN` outside Git. Appending
`--apply` runs the selected entry point. Apply schema migrations separately
before gateway startup; the gateway checks migration `0002_kook_ingress.sql`
and never migrates automatically. The PG connection pool is bounded and has
connection/statement timeouts. SIGINT/SIGTERM stop intake and drain processing
before closing the pool.

Supported deterministic commands are `/pubg status`, `/pubg unbind` and
`/pubg disband` in bound channels (fresh guild admin required); private DMs use
`/pubg account` and `/pubg unclaim`. State changes require an actor-bound card
confirmation. This handler does not invoke an LLM. Complete onboarding and the
query planner are still required by the Goal; these commands are an implementation
slice rather than V0.1 acceptance.

## Local verification

Build the shared dependencies and package with `pnpm build:pubg-saas`, then
typecheck with `pnpm typecheck:pubg-saas`. The PostgreSQL integration test only
runs when `PUBG_SAAS_TEST_DATABASE_URL` points to a dedicated ephemeral test
database; it applies migrations and removes its synthetic rows. Do not point it
at a live or shared database. The 26-test SaaS suite passed on ephemeral
PostgreSQL 18 together with the workflow-selected private PUBG checks. It covers
restart/retry, admission bounds, destination pinning, callback mutation-receipt
recovery, a previously applied schema upgrade, and fixture WebSocket -> PG ->
channel/DM HTTP delivery. No real KOOK token or guild was used.
