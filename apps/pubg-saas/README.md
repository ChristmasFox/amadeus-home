# PUBG KOOK SaaS source

This package currently contains the early public persistence and authorization
slices from `docs/PUBG_KOOK_SAAS_V0_1_GOAL.md`: PostgreSQL migrations and a
`PubgRepositoryPort` adapter, a trusted group-message parser, fresh guild
permission checks, transactional squad/channel/roster management with one-use
confirmations, and direct-message scoped self-declared account claims. The KOOK
fixture-driven gateway session and inbox/outbox queue are also implemented.
The Node 22 built-in WebSocket factory and fixed KOOK group-message REST client
are implemented. One-use `return-val` confirmation cards are parsed and
authorized against the current guild/channel/actor binding. Gateway process
wiring, PUBG account lookup, worker, AI SDK integration and deployment image
are still in progress; live button behavior has not been checked in a test
guild.
This package is not a runnable or deployed service yet.

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
- `AccountClaimService` accepts only parser-produced direct messages, limits a
  claim to the KOOK user, and labels it `self_declared`. Confirmation is
  one-use; unique constraints prevent a second user from claiming the same
  shard/account pair. This is not proof of game-account ownership.
- `KookGatewayClient` persists the session ID and last successfully handled
  sequence, buffers out-of-order frames, sends heartbeat/resume signals, and
  clears session sequence state on the server's reconnect signal. Its socket
  factory is injected and it has offline fixture coverage only so far.
- `KookMessageQueue` deduplicates bound group events and enqueues replies only
  to the original bound channel. Outbox claims use expiring leases and
  `SKIP LOCKED`; delivery errors are reduced to bounded codes with retry
  backoff. Replies carry the original message ID and a local idempotency nonce.
  KOOK documents that it does not process the nonce for deduplication, so a
  lost send response can still cause an at-least-once duplicate. Payloads are
  cleared after success/dead-letter, and retention pruning is exposed for a
  future worker.
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
sender follows the [channel message API](https://developer.kookapp.cn/doc/http/message).

## Local verification

Build the shared dependencies and package with `pnpm build:pubg-saas`, then
typecheck with `pnpm typecheck:pubg-saas`. The PostgreSQL integration test only
runs when `PUBG_SAAS_TEST_DATABASE_URL` points to a dedicated ephemeral test
database; it applies migrations and removes its synthetic rows. Do not point it
at a live or shared database.
