# Project Map

本文件是当前 Amadeus/OpenClaw 架构的快速导航；详细状态见 `docs/PROJECT_STATE.md`。

| 路径 | 责任 | 运行边界 |
| --- | --- | --- |
| `plugins/pubg` | PUBG 原生 plugin、确定性工具、bundled Skill | 私有 OpenClaw 进程内 |
| `plugins/amadeus` | Amadeus 原生工具、VPS 通知、owner outbox worker | OpenClaw 进程内 |
| `packages/pubg-domain` | PUBG API、确定性统计/查询/Telemetry domain | 被独立 plugin/app 构建并调用 |
| `apps/pubg-saas` | Public Postgres schema/migrations and scoped Domain repository | Public app source; not deployed |
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
Postgres schema/migration and an adapter with roster-filtered match selection
and tenant/team/bot/user/channel/session scoped conversation storage. One
synthetic stat golden now passes through both SQLite and Postgres repositories;
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
Live test-guild acceptance,
edge-case parity, query/AI/worker integration and deployment remain
implementation work. See the Goal's phase gates before describing the public
service as ready.

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
  `packages/pubg-domain/tests/fixtures/shared-domain-golden.json` and its test.
  It locks a deterministic query result; public-adapter parity remains unproven
  until a public adapter exists and passes the same fixture.
- The shared service now awaits its repository operations. The existing private
  OpenClaw tool contracts continue to pass through the SQLite adapter; a
  PostgreSQL-backed implementation and multi-tenant authorization tests are
  pending.
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
