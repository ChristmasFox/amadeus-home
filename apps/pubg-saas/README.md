# PUBG KOOK SaaS source

This package implements public persistence, authorization and the current KOOK
transport slice from `docs/PUBG_KOOK_SAAS_V0_1_GOAL.md`: PostgreSQL migrations
and a `PubgRepositoryPort` adapter, a trusted group-message parser, fresh guild
permission checks, transactional squad/channel/roster management with one-use
confirmations, and direct-message scoped self-declared account claims. The KOOK
gateway, durable ingress, processing loop and channel/direct-message outbox
are wired into an executable source entry point. Name-based commands/cards
cover create/bind/list/roster changes, status/unbind/disband, and private
self-claim/status/unclaim. Public lookup reuses the shared API client with
independent PostgreSQL request admission. Automatic guild-invite welcome uses
durable system-event intake plus verified guild/channel metadata. Every trusted
human text message reaches a bounded AI SDK `ToolLoopAgent`, whether it is
ordinary chat or a PUBG question. The model can answer directly or call several
constrained tools; each PUBG tool call is independently authorized and executes
only validated plans through the shared deterministic Domain. A separate
PostgreSQL-backed worker syncs registered rosters and prefetches versioned
telemetry. Channel history keeps at most twelve recent turns for twelve hours,
including speaker labels and trusted quote references; direct-message history is
isolated by actor. Provider/tool errors create a safe reply and content-free
diagnostic. KOOK daily send-budget exhaustion is recorded on the outbox row and
reported separately from Agent errors. Live human-actor button flows and
developer-account quota eligibility remain unverified.

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
- `PublicQueryAuthorizer` rechecks the durable ingress lease, current KOOK
  member/tenant/team binding, and roster for every tool invocation. The Agent
  receives no tenant/team/user IDs; tool parameters express only business query
  slots. The executor resolves aliases only inside the authorized roster and
  preserves Domain coverage, `asOf`, partial results, and evidence references.
  Unsupported teammate-kill claims remain unavailable. Model usage and safe
  failure codes are persisted by event. Its `TeamContext` uses official names from the
  shared PUBG account directory when available, stable account IDs as fallback,
  and scoped confirmed aliases.
  Every tool invocation is authorized independently; each actor's follow-up
  query state remains in that actor's trusted session. Channel history supplies
  speaker labels only and never grants authority. Live KOOK membership/filter
  semantics need real-guild acceptance. Official endpoint references: [guild/member APIs](https://developer.kookapp.cn/doc/http/guild)
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
- Shared match rows merge account facts instead of replacing another team's
  rows, and each repository returns only accounts in its registered roster.
  Sync discovery state remains team-scoped; a roster change clears it so the
  new roster resolves already-cached match details. The worker persists
  team-config-scoped telemetry, shares player lookup admission with the
  gateway, caps response bodies, rejects redirects and arbitrary hosts, and
  never sends the PUBG key to the telemetry CDN.
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
- `PublicPubgPlayerResolver` batches 1–8 names through the shared API client
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
- `KookIngressQueue` is the runtime's sole gateway ingress. It accepts every
  trusted text message from a non-bot group member, plus DMs addressed to the
  bot, documented button callbacks and bot-addressed guild-join events. A
  constrained model classifier selects account declaration, admin delegation,
  team rename, statistics query, legacy command or silent/unsupported intent;
  it has no IDs or write tools. The classifier is capped at 800 input characters
  and 100 output tokens. Durable per-user/channel/tenant/bot rate limits run
  before model calls; explicit legacy commands use the deterministic parser only
  when the classifier is unavailable or returns no valid structured output.
  Stored fields exclude display names, cached roles, attachments and verification
  tokens. Existing group bindings are pinned at reception and rechecked before
  processing/reply completion; unbound requests cannot inherit a newly bound
  team's context.
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

## Privacy and retention

Users can send `/pubg privacy` in a DM or group, including an unbound group, to
see the current data-use statement. The public gateway clears processed ingress
content immediately and runs the bounded retention sweep on the 60-second
ingress-maintenance cadence. Query sessions/results expire after 12 hours;
usage records expire after 30 days; terminal message-inbox/outbox records
expire after 7 days. Team roster and PUBG public-fact cache are retained to
serve an active team; `/pubg unclaim` removes only the user's PUBG account
claim, while an administrator can replace a roster, unbind a channel, or
disband a team. The statement also discloses that natural-language text and its
prior structured plan are sent to the configured public inference provider.
Retention delivery requires the public gateway runtime to be running; it has
not been installed on a production host.

Each team can opt in to a default leaderboard metric with `/pubg preference
kills` (supported values: `damage`, `kills`, `kd`, `matches`, `avg_damage`). A
fresh server administrator check and one-use confirmation are required. The
setting applies only when a leaderboard query omits its metric; explicit query
metrics take precedence. `/pubg preference` shows the setting and
`/pubg preference delete` removes it. The stored value and updater's KOOK user
identifier remain until deleted or the team is disbanded.

Team-scoped query aliases use `/pubg alias set "Player Name" Captain` and
`/pubg alias delete Captain`; `/pubg alias list` shows the active aliases.
Alias changes require a fresh server administrator check and one-use
confirmation. Alias matching remains deterministic inside the authorized team
roster. Aliases are removed when their member leaves the roster or when the
team is disbanded; unbinding a channel leaves them intact.

## Source entry points

After `pnpm build:pubg-saas`, these entry points are side-effect-free without
arguments and open no network connection:

```sh
node apps/pubg-saas/dist/src/migrate-database.js
node apps/pubg-saas/dist/src/gateway.js
node apps/pubg-saas/dist/src/public-sync-worker.js
```

The public runtime requires its independent `DATABASE_URL`,
`PUBLIC_PUBG_API_KEY`, and, for KOOK ingress, `KOOK_BOT_ACCOUNT_ID` plus
`KOOK_BOT_TOKEN`, all outside Git. Natural conversation requires
`MODEL_BASE_URL`, `MODEL_ID` and `MODEL_API_KEY`; all three must be configured
together. Fixed commands still work when AI is unconfigured, while ordinary
messages receive a safe connection-error reply and a recorded diagnostic.
Append `--apply`
to start an entry point. The worker also accepts `--once` for a bounded single
cycle:

```sh
pnpm --filter @agent/pubg-saas worker -- --apply --once
```

Apply schema migrations separately before starting either runtime; the gateway
and worker require migration `0016_agent_authorization_outcomes.sql` and never migrate
automatically. Ingress defaults are 10 requests/user/minute, 60/channel/minute,
120/tenant/minute and 300/bot/minute; set `KOOK_MAX_REQUESTS_PER_USER_PER_MINUTE`,
`KOOK_MAX_REQUESTS_PER_CHANNEL_PER_MINUTE`, `KOOK_MAX_REQUESTS_PER_TENANT_PER_MINUTE`
and `KOOK_MAX_REQUESTS_PER_BOT_PER_MINUTE` to tune them. KOOK REST sends pause
on documented route/global rate headers and defer 429s through durable outbox
retry. Its separate daily message allowance is developer-account-wide and must
be verified with other bots' usage during live preflight; this single bot cannot
observe that aggregate. Outbound channel and DM sends reserve a durable daily
message slot in PostgreSQL before calling KOOK. `KOOK_DAILY_MESSAGE_BUDGET`
defaults to 200 per SaaS bot and resets at noon Asia/Shanghai. Raise it only
after checking developer-account eligibility and leaving capacity for other
bots under the same account. Explicit API rejections release the reservation;
ambiguous transport failures retain it until the next quota window. See
[KOOK's daily message quota](https://developer.kookapp.cn/doc/http/message).
The worker defaults to 5-minute cycles, 500 discovered matches
and 20 telemetry fetches per team per cycle. These are operating defaults, not
a 200-team capacity claim. Pools, API/telemetry response bodies and telemetry
concurrency are bounded. SIGINT/SIGTERM stop intake and close pools.

The isolated synthetic 200-team benchmark accepts
`PUBG_SAAS_BENCH_QUERIES_PER_TEAM` from 1 to 50 (default 1). Setting it to 30
replays 6,000 scoped query tasks against synthetic matches in a burst; it
measures database/query behavior without KOOK, PUBG or model calls. It also
simulates 200 concurrent teams contending for the PostgreSQL global PUBG
admission row, applies a synthetic provider 429/reset window, and verifies that
all contenders observe the pause and the new provider rate limit. The admission
phase does not issue HTTP requests. This burst does not pace traffic across a
day or establish a production SLO. The benchmark refuses non-loopback hosts and
databases other than `pubg_test`, and drops its unique schema when the run exits.

Each completed sync cycle writes one JSON log event with duration, teams and
telemetry counters, aggregate due/delayed/leased/expired queue counts, the
oldest due age, and process RSS/heap bytes. Queue telemetry contains no tenant
or team identifiers. A queue-snapshot read failure is marked in the event and
does not discard the completed cycle. These logs provide scrapeable signals;
host alert rules and measured M204 resource limits remain deployment work.
The worker also serves `GET /healthz` on container loopback only, and Compose
marks it unhealthy if the process stops responding. The health response has no
database, queue, tenant or team details and is not published to the host.

`/pubg` or `/pubg help` shows guidance buttons. Guidance is read-only; state
changes use one-use confirmations. Names/labels retain case; quote those with spaces.

| Context | Command | Result |
| --- | --- | --- |
| Unbound guild channel | `/pubg create steam "Squad Name" Alice Bob` | Resolve up to 8 names, confirm creation and binding |
| Guild channel | `/pubg teams` | List only this guild's teams (up to 50) |
| Unbound guild channel | `/pubg bind <team-id>` | Confirm binding a team from this guild |
| Bound guild channel | `/pubg add Charlie` / `/pubg roster Alice Bob` | Confirm adding/replacing roster |
| Bound guild channel | `/pubg status` / `/pubg unbind` / `/pubg disband` | Status or confirmed removal |
| Bot DM | `/pubg claim steam Alice` / `/pubg account` / `/pubg unclaim` | Own self-declared association, status or removal |

Guild management requires fresh owner/Administrator permission. Player shards
are `steam`, `kakao`, `psn` and `xbox`; management paths never invoke an LLM.
The initial welcome card is sent on a verified bot guild-join event; `/pubg`
remains the manual entrance. Stats, leaderboard, self-stats, friendly-fire,
review and natural-language follow-up queries are implemented. Real KOOK
acceptance, prompt benchmark and scale/restore gates remain Goal requirements.

For an isolated live KOOK acceptance without a PUBG key, the Gateway supports
the explicit pair `PUBG_SAAS_ACCEPTANCE_MODE=isolated` and
`PUBG_SAAS_SYNTHETIC_PUBG_PLAYERS=1` only when `NODE_ENV` is not `production`.
This resolves only `P3SyntheticAlpha`, `P3SyntheticBravo`,
`P3SyntheticCharlie` and `P3SyntheticDelta` to fixed synthetic Steam account
IDs; unknown names remain missing and never fall through to PUBG. These fixture
accounts have no real PUBG matches or statistics. Production rejects this mode.

## Local verification

Build the shared dependencies and package with `pnpm build:pubg-saas`, then
typecheck with `pnpm typecheck:pubg-saas`. Set `PUBG_SAAS_TEST_DATABASE_URL` to
a dedicated isolated test database before `pnpm test:pubg-saas`; tests create
synthetic schemas/rows and clean them up. Never point it at a live or shared
database. On 2026-10-13, all 75 SaaS tests passed with isolated PostgreSQL 18
and no skips; `pnpm typecheck:pubg` and `pnpm typecheck:pubg-saas` passed, and
`pnpm test:pubg` passed all 68 private
identity/presentation/Domain/plugin tests. The suite covers
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
The repository acceptance also proves roster revocation waits for a bounded
authorized read, persisted telemetry renders through the KOOK team-damage
response, and `@agent/pubg-domain/core` does not load `node:sqlite` or the
legacy importer. The private Domain's 36 tests run without public PostgreSQL. These synthetic
parity gates do not replace the Goal's P4 deidentified prompt benchmark, P5
200-team resource/latency tests, P6 restore/independence drills or real KOOK
test-guild acceptance. Worker integration uses fake PUBG API and telemetry CDN
responses; no provider key or live guild was used.
