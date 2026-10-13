# PUBG KOOK SaaS source

This package implements public persistence, authorization and the current KOOK
transport slice from `docs/PUBG_KOOK_SAAS_V0_1_GOAL.md`: PostgreSQL migrations and a
`PubgRepositoryPort` adapter, a trusted group-message parser, fresh guild
permission checks, transactional squad/channel/roster management with one-use
confirmations, and direct-message scoped self-declared account claims. The KOOK
gateway, durable ingress, processing loop and channel/direct-message outbox
are wired into an executable source entry point. Name-based commands/cards
cover create/bind/list/roster changes, status/unbind/disband, and private
self-claim/status/unclaim. Public lookup reuses the shared API client with
independent PostgreSQL request admission. Automatic guild-invite welcome now
uses durable system-event intake plus verified guild/channel metadata. Public
query authorization/session construction is implemented as a tested application
module; query handling, ingestion worker, AI SDK and deployment images remain in
progress. The service is not deployed, and live buttons remain unverified.

## Trust boundaries

- Callers construct `TeamContext` only after resolving a verified KOOK event
  and tenant/team ownership in server code.
- Result sets and conversation state require a `TrustedConversationScope`
  created from the verified bot, user, channel and an opaque server-generated
  session ID. Model/tool arguments never define that scope.
- `PublicQueryAuthorizer` re-reads an active durable ingress lease and its
  sanitized event/fingerprint. It derives group scope from the admission-time
  binding and revision, then checks fresh official channel/member data. It
  ignores a caller's event/roster/team overrides. Group queries do not create
  privileged setup or persistent DM grants. DM queries require an actor's
  explicit `team_user_access` grant and fresh guild membership; multiple
  authorized teams produce a selection response. A self-declared PUBG account
  claim never supplies this grant. Removed membership/API failure denies access.
- Query sessions have opaque server-created IDs, requester/channel/team keys
  and at most 24 hours of inactivity (default 12 hours). A request ledger makes
  ingress retries reuse the exact session without storing message text. Roster,
  alias/shard changes, expired sessions, revoked/regranted DM access and channel
  binding generations invalidate old state at the managed repository boundary.
  Ingress also pins its binding generation; the same team unbound and rebound
  cannot receive an old queued request. Migration `0006` terminates legacy
  pending group events whose generation was not recorded, retaining their audit
  identity while removing payloads. It never invents historical authority.
- The authorizer is an application module for the upcoming query handler. It
  is not yet wired to the management-only executable handler. Reply-thread
  correlation remains pending. Its `TeamContext` uses official names from the
  shared PUBG account directory when available, stable account IDs as fallback,
  and scoped confirmed aliases.
  Query executors must authorize each request rather than cache an authorized
  object for later events. Live KOOK membership/filter semantics need real-guild
  acceptance. Official endpoint references: [guild/member APIs](https://developer.kookapp.cn/doc/http/guild)
  and [channel APIs](https://developer.kookapp.cn/doc/http/channel).
- The adapter checks that the trusted channel remains bound to the selected
  tenant/team, or that a direct message has a `team_user_access` grant for the
  selected team. Session state is keyed by tenant, team, bot, user, channel and
  session. Normalized match/player facts are shared inside the public database;
  match selection is constrained by the trusted team's PUBG account IDs and
  shard. The adapter checks the registered team shard/roster before data access;
  conversation grants/bindings also guard match and telemetry reads, not just
  conversation storage. Forged or outdated team configurations fail closed.
- Public match/player facts use official shard + match ID keys. Same-ID records
  in different shards cannot overwrite or join each other. Derived telemetry
  features and prefetch attempts add tenant/team and a SHA-256 digest of the
  active team configuration, so teams in the same match cannot reuse facts
  derived from another roster or alias set. Reads/writes and due-attempt lists
  also require a match containing an authorized team account.
- Migration `0005` backfills child shards only from the known legacy parent
  match, with composite keys/FKs and scoped indexes. Unmatched historical
  telemetry stops the transaction with `public_match_shard_backfill_unresolved`;
  it is retained for an operator to resolve from evidence before a protected
  live apply. The migration does not guess a shard or silently delete it.
- Migration `0007` creates team-config-scoped telemetry tables and evicts old
  unscoped derived cache rows whose originating roster/aliases cannot be
  established. Match/player rows remain reusable across teams.
- `TeamAdminService` accepts parser-produced trusted group/button events and calls
  `KookPermissionClient` on every management action before beginning a DB
  transaction. Roster replacement/addition, channel unbinding and disbanding
  use hashed, one-use confirmation tokens bound to actor, guild, bot and
  channel. The parser drops the gateway's role list; the permission client
  reads current KOOK state. Team rows keep the selected PUBG shard.
- Create/bind setup first stores a hashed token scoped to bot, guild, channel
  and actor; confirmation atomically creates/binds and saves a recovery receipt.
  A channel revision invalidates old setup cards after another bind/unbind
  cycle. Roster preparation checks the source request's selected team again
  after player lookup.
- `PublicPubgPlayerResolver` batches 1–4 names through the shared API client
  at the fixed official endpoint, with redirects and hidden retries disabled.
  It preserves case, previews canonical API names, and cannot prepare a roster
  from missing/ambiguous/invalid results. It reads no private configuration.
- `PostgresPublicPubgAdmission` spaces requests globally across public
  connections (default 10 RPM), with bounded waits and provider exhaustion/reset
  and lower-limit header handling. `PUBLIC_PUBG_REQUESTS_PER_MINUTE` is controlled
  configuration; increases require verified provider approval/headers. A
  distinct key does not prove independent provider/account quotas.
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
  to it, documented button callbacks and bot-addressed guild-join events. Stored fields exclude display names,
  cached roles, attachments and verification tokens. Existing group bindings
  are pinned at reception and rechecked before processing/reply completion;
  unbound requests cannot inherit a newly bound team's context.
- `self_joined_guild` is committed before welcome target lookup. Fixed official
  guild/channel APIs select the configured welcome channel or default text
  channel and check its guild/type. Completion pins the target in the same
  outbox, and sending revalidates it. Welcome processing bypasses business/AI
  handlers and creates no tenant/team/access grant. Missing or foreign/voice/
  category destinations cannot redirect to another channel or a DM fallback.
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
Automatic welcome follows [KOOK's guild-join event](https://developer.kookapp.cn/doc/event/user)
and the [guild](https://developer.kookapp.cn/doc/http/guild)/[channel](https://developer.kookapp.cn/doc/http/channel)
read APIs. These lookup requests also require live endpoint-quota preflight.
Lookup/admission follows the official [PUBG request filters](https://documentation.pubg.com/en/making-requests.html)
and [rate limits](https://documentation.pubg.com/en/rate-limits.html). Live key
eligibility and quota feasibility remain preflight work.

## Source entry points

After `pnpm build:pubg-saas`, both commands below are dry-run and open no network
connection:

```sh
node apps/pubg-saas/dist/src/migrate-database.js
node apps/pubg-saas/dist/src/gateway.js
```

The separately authorized public runtime phase must supply its independent
`DATABASE_URL`, `KOOK_BOT_ACCOUNT_ID`, `KOOK_BOT_TOKEN` and `PUBLIC_PUBG_API_KEY`
outside Git. Appending
`--apply` runs the selected entry point. Apply schema migrations separately
before gateway startup; the gateway checks migration `0008_public_account_names.sql`
and never migrates automatically. The PG connection pool is bounded and has
connection/statement timeouts. SIGINT/SIGTERM stop intake and drain processing
before closing the pool.

`/pubg` or `/pubg help` shows guidance buttons. Guidance is read-only; state
changes use one-use confirmations. Names/labels retain case; quote those with spaces.

| Context | Command | Result |
| --- | --- | --- |
| Unbound guild channel | `/pubg create steam "Squad Name" Alice Bob` | Resolve 1–4 names, confirm creation and binding |
| Guild channel | `/pubg teams` | List only this guild's teams (up to 50) |
| Unbound guild channel | `/pubg bind <team-id>` | Confirm binding a team from this guild |
| Bound guild channel | `/pubg add Charlie` / `/pubg roster Alice Bob` | Confirm adding/replacing roster |
| Bound guild channel | `/pubg status` / `/pubg unbind` / `/pubg disband` | Status or confirmed removal |
| Bot DM | `/pubg claim steam Alice` / `/pubg account` / `/pubg unclaim` | Own self-declared association, status or removal |

Guild management requires fresh owner/Administrator permission. Player shards
are `steam`, `kakao`, `psn` and `xbox`; these paths never invoke an LLM. The initial
welcome card is sent on a verified bot guild-join event; `/pubg` remains the
manual entrance. Statistical queries and real KOOK acceptance remain Goal requirements.

## Local verification

Build the shared dependencies and package with `pnpm build:pubg-saas`, then
typecheck with `pnpm typecheck:pubg-saas`. The PostgreSQL integration test only
runs when `PUBG_SAAS_TEST_DATABASE_URL` points to a dedicated ephemeral test
database; it applies migrations and removes its synthetic rows. Do not point it
at a live or shared database. The 47-test SaaS suite passed on ephemeral
PostgreSQL 18 together with the workflow-selected private PUBG checks. It covers
restart/retry, admission bounds, destination pinning, callback mutation-receipt
recovery, a previously applied schema upgrade, and fixture WebSocket -> PG ->
channel/DM HTTP delivery. It also covers two-guild name-based onboarding,
revoked permission, cross-guild binding denial, roster edits/self-claim
conflicts, channel revisions and rebind during lookup. PUBG HTTP is mocked;
admission/header behavior uses real ephemeral PostgreSQL. No real KOOK/PUBG
credential or guild was used.
Welcome fixtures cover restart/retry, replay, independent guild backlog,
absent/foreign/non-text targets, fresh pre-send target validation and gateway
acknowledgement before slow target lookup. This proves the source protocol path,
not real KOOK onboarding or 200-guild eligibility.
Repository fixtures deliberately collide match/account IDs across Steam/Kakao,
check foreign telemetry/queue denial and forged/stale roster/DM access, and
verify valid legacy backfill plus atomic rollback on an unresolved shard.
Query authorization fixtures cover active-lease/fingerprint scope, concurrent
retry/session reuse, two guilds and multiple squads/channels in one guild,
duplicate labels, requester isolation, explicit DM selection, forged scope,
claim-versus-grant separation, removed membership, permission-check races,
roster/alias changes, TTL, grant revoke/regrant, same-team unbind/rebind and
fail-closed migration of legacy queued group events.
Shared edge fixtures now compare whole SQLite/PostgreSQL stat results against
nine independently checked golden cases, including KD, revives, squad rank,
06:00/half-open periods, zero matches and partial/unknown coverage. Damage
fixtures compare complete tool envelopes for kicks/punches/melee, retain derived
evidence event references, distinguish partial unavailable telemetry from known
zero, and serve versioned cache facts after reopening the separate stores.
The private Domain's 36 tests run without public PostgreSQL. These synthetic
parity gates do not replace the Goal's P6 deployment/restore independence drills.
