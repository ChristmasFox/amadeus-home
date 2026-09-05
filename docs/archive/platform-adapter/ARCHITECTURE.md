# Multi-Platform Adapter Layer V1

## Scope

本阶段首先以 mock 方式实现平台边界；2026-09-02 已在 LangBot 中配置并启用 Telegram 传输，未改变 PUBG Query Engine V3 的查询语义。凭据不写入本文档。

## Current Runtime

```text
KOOK event
   │
   ▼
LangBot KookAdapter
   │  NormalizedBotMessage v1
   ▼
LangBot PUBG Bridge
   │  POST /v3/route 或 /v3/query
   ▼
Mastra PUBG Runtime
   ├─ domain router
   ├─ context/session resolver
   ├─ PUBG planner
   ├─ selector resolver
   ├─ n8n data provider
   ├─ deterministic query engine
   ├─ ResultSet/context persistence
   └─ PresentationModel + platform renderer
   │
   ▼
BotResponse (text messages)
   │
   ▼
LangBot KookAdapter reply/sender
   │
   ▼
KOOK
```

未来平台只需要提供：

```text
Platform event
   ▼
PlatformAdapter.normalize()
   ▼
NormalizedBotMessage
   ▼
同一 Mastra PUBG Runtime
   ▼
PlatformRenderer + PlatformSender
```

当前 live 验证版本（2026-09-02，Asia/Shanghai）：

- Runtime image：`local/pubg-query-engine-v3:3.1.0-adapter`
- Runtime image ID：`sha256:863a43161a47efa17bc2e6e2437e221e478017f5bdeeb0ffdfbedcef18f85e47`
- Runtime health：`healthy`
- Plugin：`local/pubg-stats` `3.1.1`，`initialized`，`enabled=true`
- Plugin install task：`14`
- Plugin package：`docs/platform-adapter/pubg-stats-platform-v1.1.lbpkg`
- Plugin package SHA-256：`15c0a13b177e6ec45ca6560b6dd6d2d3246bafee34264fe9e113dd739630d6e9`

## Dependency Direction

```text
Platform Adapter / Sender
          ▼
Platform Core Contracts
          ▼
Mastra Generic Runtime
          ▼
PUBG Query Schema / Query Core
          ▼
n8n Data Provider
          ▼
PUBG API + Match Store
```

PUBG Domain 不导入 KOOK 或 Telegram adapter；Runtime 只消费标准消息契约。

LangBot 命令和 Tool 通过 `pubg-langbot-plugin-v3/components/platform/registry.py` 的通用会话入口构造标准消息；只有真实 KOOK EventListener 在 `components/platform/kook.py` 读取 KOOK 原始事件字段。

## Live Baseline

- Query Engine：`local/pubg-query-engine-v3:3.1.0-adapter`，健康检查端口 `5310`。
- LangBot：`langbot-local:4.10.8-kook-fix-ssh10`。
- Plugin：`local/pubg-stats` `3.1.1`，`initialized`，`enabled=true`。
- n8n Data Gateway：`pubg-data-gateway-v3-20260902`，Active。
- n8n Sync：`pubg-sync-matches-v3-20260902`，Active。
- V2/V3 快照：`docs/platform-adapter/baseline/`。
- 现有 V3 业务测试基线：38/38 PASS；本次加入平台测试后为 44/44 PASS。

## Non-Goals

- 源码仍保留 Telegram fixture/mock 测试；真实 Telegram transport 由 LangBot 内置适配器承载，当前使用 polling，未配置 webhook。
- 2026-09-02 已完成 Telegram 私聊和群聊真实入站/回复烟测；KOOK 真人入站仍需单独验证，不能用 Telegram 结果替代。
- 不实现 WeChat transport。
- 不迁移 n8n 数据工作流。
- 不修改默认四人组、KD 排名、Chicken Index 或 Selector 语义。
