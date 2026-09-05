# PUBG Query Engine V3 — Architecture

V3.2 review branch and data boundaries are documented in `V3.2_ARCHITECTURE.md`. The V3 QuerySubgraph below remains the shared historical query path; `review_match` is additive and does not replace it.

## 1. Runtime Diagram

```text
KOOK Message
    │
    ▼
LangBot KOOK Adapter
    │
    ▼
LangBot Plugin: pubg_query_gateway_v3 EventListener
    │  POST /v3/route
    ▼
Mastra Runtime: Domain Router
    │  explicit PUBG signal OR sender-isolated active PUBG context
    │  route=mandatory
    ▼
Mastra Workflow: pubg-query-runtime-v3
    │
    ├─ domain-router-and-planner
    │    ├─ read structured Context
    │    ├─ optional Mastra Agent structured output
    │    └─ deterministic validated fallback Planner
    │
    ├─ selector-and-context-resolver
    │    ├─ explicit selector first
    │    ├─ ResultSet reference resolution
    │    └─ absolute time boundary resolution
    │
    ├─ ensure-pubg-data
    │    └─ POST n8n Data Gateway v3
    │
    ├─ deterministic-query-engine
    │    ├─ filter / last N
    │    ├─ group player / match / day / team
    │    ├─ aggregate / rank / compare / trend
    │    └─ Chicken Index / evidence / data status
    │
    └─ resultset-and-renderer
         ├─ persist ResultSet
         ├─ persist structured Context
         └─ render vertical KOOK message
    │
    ▼
n8n PUBG Data Gateway v3
    │
    ├─ Read V2 Sync State
    ├─ Read V2 Match Store
    ├─ Determine coverage/freshness
    ├─ if insufficient: Execute Sync v3
    ├─ return normalized records + coverage + source
    └─ no factual answer generation
    │
    ▼
n8n PUBG Sync Matches v3
    │
    ├─ Players API discovery
    ├─ compare local Match IDs
    ├─ Match API for missing IDs
    ├─ normalize participant statistics
    ├─ upsert Match Store
    └─ upsert Sync State
    │
    ▼
PUBG Developer API
    │
    ├─ Players API
    └─ Match API
```

## 2. Responsibility Boundaries

| Stage | Owner | Input | Output | LLM | PUBG API | Cache/Store |
| --- | --- | --- | --- | --- | --- | --- |
| Domain route | LangBot Plugin + Mastra Router | 原始消息、sender identity、Context | `mandatory`/`pass` | 不回答事实 | 否 | 读 Context |
| Plan | Mastra Planner | 自然语言、当前时间、时区、能力、结构化 Context | Canonical Query v3 | 可选，仅结构化规划 | 否 | 否 |
| Validate | Zod `CanonicalQuerySchema` | Planner/provided plan | 合法 Query 或 `INVALID_QUERY` | 否 | 否 | 否 |
| Context resolve | Mastra workflow + Context Store | Query、sender-scoped Context | selector/ResultSet/reference | 否 | 否 | 读 ResultSet/Context |
| Time resolve | TypeScript resolver | relative selector、`now`、timezone | ISO8601 `time_range` | 否 | 否 | 否 |
| Ensure data | n8n Data Gateway | canonical Query、subject、clock | records、coverage、source | 否 | 必要时通过 Sync | 读 Match/Sync State |
| Sync | n8n Sync Workflow | team/player IDs、sync request | normalized Match records、Sync State | 否 | Players + Match | 写 Match/Sync State |
| Calculate | deterministic Query Engine | Query、records、coverage | Structured Result、Evidence | 否 | 否 | 否 |
| ResultSet | Mastra Runtime + JSON Store | Structured Result | `resultSetId`、rows、match IDs | 否 | 否 | 写 ResultSet |
| Render | TypeScript renderers | Structured Result + resolved Query | KOOK text | 否；没有 Answer LLM | 否 | 否 |

## 3. Mandatory Routing

当 EventListener 调用 `/v3/route` 得到 `route=mandatory` 时，它直接调用 `/v3/query` 并阻止 LangBot 默认 pipeline 继续处理该消息。这样 PUBG 事实问题不会停在“LLM 不调用 Tool”路径上。

Tool 路径仍然保留：当 LangBot local-agent 主动调用 `get_pubg_stats_v3` 时，Tool 直接进入 `/v3/query`。两条入口共享同一个 Mastra Runtime，不存在第二套统计逻辑。

## 4. Mastra Workflow Steps

Runtime workflow ID：`pubg-query-runtime-v3`。

1. `domain-router-and-planner`：按 `platform + launcherType + launcherId + senderId + domain` 建立 session；读取 Context；生成并验证 Query。
2. `selector-and-context-resolver`：应用显式 selector、ResultSet 引用和结构化上下文；将相对时间 canonicalize 为绝对范围。
3. `ensure-pubg-data`：把 canonical Query 和当前 clock 交给 DataProvider；对当前周期执行 freshness/coverage 检查。
4. `deterministic-query-engine`：只使用本地证据计算结果；不接受 LLM 代算。
5. `resultset-and-renderer`：保存 ResultSet/Context，再选择 renderer 输出用户消息。

## 5. n8n Workflow Relationships

```text
Mastra Runtime
    │ POST pubg-data-gateway-v3
    ▼
PUBG Data Gateway v3
    │ if Needs Read Through Sync = true
    └──── POST pubg-sync-matches-v3
                         │
                         ▼
                  PUBG Sync Matches v3
                         │
                         ├─ PUBG Players API
                         ├─ PUBG Match API
                         └─ pubg_cache upsert
```

V3 n8n Workflow 不承担自然语言理解、Conversation Memory、最终回答或统计解释。

## 6. Important Semantics

- 默认没有显式玩家 selector 时，subject 是配置化 `default_team`，不是固定写在 Query Protocol 内的四个 ID。
- 默认 team report 按 KD 降序返回全部四名玩家。
- `last_n_matches` 以 team participated matches 为定义：只要该 Match 含 subject 的任一玩家就计为一场，按 Match timestamp 倒序取 N 场。
- `strongest` 使用 Performance Score；`weakest` 使用 Chicken Index；“KD 最高”仍是普通 `rank(metric=kd)`。
- `NO_MATCHES` 只有 coverage 完整时产生；coverage 不完整时必须是 `COVERAGE_GAP` 或其他明确失败状态。
- Conversation 文本不是事实数据库；follow-up 只通过结构化 Context/ResultSet 引用事实。
