# Project Map

本文件是当前 Amadeus/OpenClaw 架构的快速导航；详细状态见 `docs/PROJECT_STATE.md`。

| 路径 | 责任 | 运行边界 |
| --- | --- | --- |
| `plugins/pubg` | PUBG 原生 plugin、确定性工具、bundled Skill | 私有 OpenClaw 进程内 |
| `plugins/amadeus` | Amadeus 原生工具、VPS 通知、owner outbox worker | OpenClaw 进程内 |
| `packages/pubg-domain` | PUBG API、确定性统计/查询/Telemetry domain | 被独立 plugin/app 构建并调用 |
| `apps/pubg-saas` | Public Postgres schema, KOOK SaaS query app and independent sync worker | Public app source; not deployed |
| `apps/product-radar` | 商品监控、匹配、watch scheduler 和事件 outbox | 独立 CasaOS app |
| `integrations/openclaw` | 脱敏 config、workspace、Codex hook | CasaOS OpenClaw |
| `infra/docker/casaos/openclaw` | 固定镜像和 OpenClaw Compose 模板 | OrbStack CasaOS |
| `infra/docker/casaos/product-radar` | Product Radar Compose 模板 | OrbStack CasaOS |
| `infra/macos` | NAS 宿主机命令 | macOS SSH target |
| `scripts/deploy-openclaw.sh` | 预检、备份、选择性构建、切换和验收 | 显式 `--apply` |

## Existing private PUBG request path

```text
OpenClaw native channel event
  -> plugins/pubg (trusted channel/identity adapter and native tool schemas)
  -> packages/identity (private canonical Person/account bindings)
  -> packages/pubg-domain (PUBG API client, deterministic query/review logic)
  -> private SQLite match, telemetry-feature, sync, result-set and context data
  -> packages/presentation (validated contracts/renderers)
```

The private plugin owns OpenClaw integration, external team/API-key path
resolution, and the one configured private PUBG team. The Domain owns
platform-neutral match normalization, query/stat calculations, PUBG time
selectors, telemetry analysis, evidence references and coverage/unknown states.
The SQLite repository owns private persistence. `packages/identity` has its own
private SQLite store and is not a public SaaS user registry.

## Public KOOK PUBG target boundary

The selected Goal adds a separate `apps/pubg-saas` application and
`infra/pubg-saas` deployment unit. KOOK transport and verified event metadata,
tenant/team authorization, public identity, AI planning, public PostgreSQL and
the public ingestion worker belong to that application/deployment. The public
application may depend on a built `packages/pubg-domain` artifact, but it must
not call the private plugin, OpenClaw, private SQLite, private identity store,
private worker, private credentials or household-only service endpoints.

The initial P0 inventory found that neither `apps/pubg-saas` nor
`infra/pubg-saas` existed. P1 added a generic async `PubgRepositoryPort` and a
scope-pinned SQLite adapter for private use. Early P2 source now contains a
Postgres schema/migration and an adapter with registered-roster/shard-filtered match selection
and tenant/team/bot/user/channel/session scoped conversation storage. Match
facts use official shard + match ID; derived telemetry and prefetch state use
tenant/team + team-config digest + shard/match/parser/feature scope, with
membership-constrained reads and fail-closed legacy shard backfill. A migration
evicts unowned historical shared telemetry cache rows because their source team
and configuration cannot be established. One
synthetic stat golden and nine independent edge cases now pass through both
SQLite and Postgres repositories, covering KD/revives/squad rank, 06:00 periods,
zero/partial/unknown and comparison ratios. Damage/kick/punch/melee envelopes,
derived evidence and versioned facts also survive independent store reopening;
trusted KOOK group/direct-message parsing, fresh guild owner/Administrator
checks, and transactional squad/channel/roster management with actor-bound
one-use confirmations are also implemented. Direct-message account claims are
stored as self-declared and protected by user-scoped uniqueness and unclaim
confirmation. P3 source includes a fixture-driven gateway session core with
durable sequence/resume state and a bound-channel inbox/outbox queue with
lease-based retry, plus the Node WebSocket factory and fixed KOOK group-message
REST client. The executable source runtime uses durable, bounded addressed
ingress before sequence acknowledgement, serial leased processing, and one
channel/DM reply outbox. Name-based create/bind/list/roster changes, status and
private self-claim handlers reuse the shared PUBG API client with independent
public credentials and PostgreSQL request admission/header backoff. Setup
tokens pin channel revisions. Actor-bound `return-val` callbacks recheck
guild admin and recover exact-event mutation receipts after a crash while
rejecting a new click. Bot guild-join events now drive verified-channel welcome
cards through the same durable ingress/outbox without privileged setup.
The public query authorizer derives context from an active stored ingress
lease, fresh channel/guild membership and database ownership. DM grants remain
explicit; ambiguous teams require selection. Server-created TTL sessions
isolate requester/channel/team and pin roster/alias and binding generations;
revocation/regrant and same-team rebind cannot revive old context. The
executable handler now serves deterministic and AI-planned queries through one
validated executor. A separate PostgreSQL-backed worker ingests official match
data and team-scoped telemetry through the shared Domain. Its durable queue uses
team-scoped leases, fencing tokens, bounded retries and concurrency. KOOK ingress
has per-user/channel/tenant/bot request windows; outbound sends honor response
bucket/global limits, persist 429 deadlines, and reserve a daily PostgreSQL
budget that resets at noon Asia/Shanghai (default 200 messages per SaaS bot).
Shared match rows merge participant facts while repository reads return only
current team members. The synthetic 200-team benchmark passes with bounded local
pool use.
M1 source/offline acceptance remains passed and the app is undeployed. The
independent Compose/Image source unit is under `infra/pubg-saas/`; its pinned
base manifests, private database network, per-process caps, least-privilege
Postgres roles and secret-file URL entrypoint passed rendered-config checks.
Encrypted backup/decrypt/restore was exercised against the isolated PostgreSQL
18 fixture: 35 public tables matched, restored role boundaries passed, and the
disposable database/roles were cleaned. The `public` schema TOC restore defect
was fixed. A six-hour UTC systemd backup job and guarded seven-day retention
source are present but uninstalled; its one-shot job passed against the isolated
PostgreSQL fixture. Image build, clean Linux/cloud recovery, scheduled operation,
tested egress restrictions and public/private stop-isolation remain open. A P3
live smoke passed KOOK gateway auth, one labeled outbox delivery and sequence-1
resume; full human-user flows need a test actor and a second channel. The daily
budget integration suite passes, but developer-account eligibility and other
bots' quota use remain unverified. The
deidentified prompt benchmark and measured M204 resource/quota feasibility
remain open. The P4 benchmark runner is in
`apps/pubg-saas/tests/nl-query-provider.benchmark.ts`; it needs an external
owner-only 100–200-case prompt file and test-provider credentials before it can
produce accuracy/token/P50/P95 evidence.
The worker also emits aggregate queue state/age and process RSS/heap in each
cycle log without tenant identifiers; host alert rules and M204 thresholds are
still open.

## Request paths and guardrails

自然语言只由 OpenClaw 为私有 runtime 规划；公共应用的自然语言入口由其 AI SDK
planner 处理。两边通过结构化应用调用共享 Domain；Domain 不读取聊天、不做关键词路由、
不生成平台消息。私有主动通知只通过 WhatsApp owner outbox。

- Public requests need a trusted scope resolved by the KOOK application from a
  verified gateway event and persisted ownership. LLM output and caller-supplied
  tenant/team IDs are not authorization.
- `TeamContext` carries tenant ID, team ID and the validated team roster.
  `PubgDomainService` checks that its repository adapter is pinned to the same
  scope. Public callers still need the KOOK application to derive this context
  after authorization; the Domain does not authenticate platform users.
- The private plugin continues to resolve its one protected team and
  `@agent/identity` accounts at its own boundary. It must not gain a public DB
  or depend on a public service.
- Both deployment images embed their own pinned build of the shared Domain;
  source reuse does not imply shared runtime state or synchronized releases.
- Synthetic parity evidence lives in
  `packages/pubg-domain/tests/fixtures/shared-domain-golden.json`,
  `shared-edge-cases.json` and their private/public tests. They lock deterministic
  stat/coverage/time and damage/cache evidence; live deployment independence
  remains unproven until the P6 deployment/restore drills pass.
- The shared service awaits repository operations. Private OpenClaw tool
  contracts pass through the SQLite adapter and private PUBG regression suite;
  the PostgreSQL adapter and multi-tenant authorization tests pass on an
  isolated test database. Runtime/deployment independence remains unproven
  until the P6 drills pass.
- The P0 source inventory was taken from `main` at `3f4cac2` on 2026-10-13.
  The bounded `listMatches` child-row query and its SQLite plan regression test
  were added during P0/P1 execution; they do not change or inspect live data.

## 修改映射

- PUBG 规则、指标或 API：改 `packages/pubg-domain` 并补测试。
- PUBG 工具 schema/SDK 接线/Skill：改 `plugins/pubg`。
- 非 PUBG 工具、通知、VPS 和外部服务 policy：改 `plugins/amadeus`。
- 商品监控业务：改 `apps/product-radar`，保持 channel-free outbox。
- OpenClaw 配置/镜像/迁移：改 `integrations/openclaw`、`infra/docker/casaos/openclaw`
  或 `scripts/deploy-openclaw.sh`；不要直接改运行容器。
- 历史 `docs/archive`、`docs/reports` 只保留审计证据，不得作为当前执行路径。
