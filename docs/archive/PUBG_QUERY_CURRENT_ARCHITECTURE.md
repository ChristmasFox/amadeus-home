# PUBG Query Current Architecture

> 审计性质：只读架构审计。未修改代码、Prompt、Workflow、数据库、缓存或配置；未调用 PUBG 查询 Webhook；未创建、删除、激活或停用 Workflow。
>
> 审计日期：2026-09-01，时区：Asia/Shanghai。
>
> 本报告重点：追踪每一层的真实输入、输出、责任方，以及是否进入缓存和 PUBG API。

## 1. Executive Summary

当前实现属于**混合模式**：`LLM 可选 Function/Tool Calling + LangBot Plugin + n8n Workflow`，同时保留一条 `/pubg` 固定 Command 旁路；它不是纯 Command-driven、也不是强制 Tool-driven。

- KOOK 没有单独的 PUBG 关键词路由或固定 PUBG 意图分类器。
- 自然语言消息先进入 LangBot 的 `local-agent`，由 LLM 自主决定是否调用 `get_pubg_daily_stats`。
- LLM 不调用 Tool 时，n8n、缓存和 PUBG API 都不会执行；模型可以直接根据会话内容生成回答。
- LLM 调用 Tool 后，插件才向 n8n Webhook 发起请求；n8n 内部再决定是否读取玩家缓存、请求 Players API，以及请求 Match API。
- n8n 当前没有 LLM、AI Agent 或 Sub-workflow；时间解析、缓存判断、比赛聚合和格式化都在 JavaScript Code Node 中完成。
- 当前最大的“Cache Miss 但没有 API”现象有两条独立路径：
  1. **LLM 在进入 n8n 前跳过 Tool**，这实际上不是 n8n Cache Miss。
  2. **Tool 已调用，但 n8n 判断没有新的 Match ID**，于是只聚合已有缓存；或者 Players API 失败且没有 stale player cache，代码主动把待请求 Match ID 置为空。
- 当前缓存不是“问题答案缓存”，而是按玩家快照、Match ID 和会话上下文缓存的结构化数据缓存。
- 当前固定查询对象是四个硬编码 PUBG Steam 账号，不存在 KOOK 用户到 PUBG 账号的动态绑定。

由于 n8n REST API `/rest/workflows` 与 `/api/v1/workflows` 返回 `401`，当前真实 Workflow 是通过 n8n 容器内以 `readOnly: true` 打开的 `database.sqlite` 读取确认的；本地导出的 `pubg-daily-stats.workflow.json` 不是当前真实版本的唯一依据。

## 2. Current Architecture Diagram

### 2.1 完整数据流

```text
KOOK WebSocket message
    │
    │ 输入：KOOK 原始事件、频道/群组、发送者、消息文本
    ▼
LangBot KOOK Adapter
    │
    │ 输出：LangBot MessageEvent / MessageChain
    │      launcher_type = person 或 group
    │      launcher_id   = 私聊用户 ID 或群组 ID
    │      sender_id     = 当前发送者 ID
    ▼
RuntimeBot / BotManager
    │
    │ 输入：Bot 配置、通用响应规则、pipeline routing rules
    │ 输出：KOOK Pipeline UUID
    │
    │ 当前 PUBG Bot routing rules = []
    │ 当前默认 Pipeline = KOOK Pipeline
    ▼
KOOK Pipeline
    │
    ├─ GroupRespondRuleCheckStage
    ├─ BanSessionCheckStage
    ├─ PreContentFilterStage
    ├─ PreProcessor
    │    ├─ 建立/获取内存 Session
    │    ├─ 读取 Conversation memory
    │    ├─ 注入 System Prompt
    │    ├─ 加入当前日期提示
    │    └─ 加载可用 Tools
    │
    ▼
local-agent LLM: arthur-combo
    │
    ├──────────────────────────────────────────────┐
    │                                               │
    │ LLM 返回普通 assistant 文本                    │ LLM 返回 Tool Call
    │                                               │
    ▼                                               ▼
直接生成回答                                       get_pubg_daily_stats
    │                                               │
    │ 无 n8n                                         │ 输入：query、queryPlan、context、queryId
    │ 无 PUBG API                                    ▼
    │                                         LangBot PUBG Plugin
    │                                               │
    │                                               │ POST JSON
    │                                               ▼
    │                                   http://n8n:5678/webhook/pubg-daily-stats
    │                                               │
    │                                               ▼
    │                                      n8n PUBG Workflow
    │                                               │
    │    ┌──────────────────────────────────────────┴────────────────────┐
    │    │                                                               │
    │    ▼                                                               ▼
    │ Read PUBG Cache                                           Normalize Request
    │    │                                                               │
    │    └──────────────────────► Prepare Cache ◄────────────────────────┘
    │                                  │
    │                                  ▼
    │                         Needs Player Lookup
    │                          │                 │
    │         needsPlayerLookup=true             false
    │                          │                 │
    │                          ▼                 ▼
    │                  Lookup PUBG Players   Use Cached Players
    │                          │                 │
    │                          ▼                 │
    │                  Parse Player Lookup      │
    │                          └──────────┬──────┘
    │                                     ▼
    │                          Build Match Fetch Plan
    │                                     │
    │                                     ▼
    │                            Has New Match IDs
    │                              │             │
    │                     matchId 有值           matchId=null
    │                              │             │
    │                              ▼             │
    │                    Get PUBG Match（每个 ID） │
    │                              │             │
    │                              ▼             │
    │                    Extract Match Records   │
    │                              └──────┬──────┘
    │                                     ▼
    │                         Aggregate Today's Stats
    │                          │                 │
    │                          ▼                 ▼
    │                 Respond to LangBot   Prepare Context Row
    │                          │                 │
    │                          ▼                 ▼
    │                    Tool 返回 response   Upsert Context
    │
    │ 另外两条写缓存旁路：
    │  Parse Player Lookup → Prepare Player Cache Row → Upsert PUBG Player Cache
    │  Extract Match Records → Prepare Match Cache Row → Upsert PUBG Match Cache
    │
    ▼
Tool result: 只保留 n8n JSON 中的 response 字段
    │
    ▼
local-agent LLM 第二轮
    │
    │ 输入：原始对话 + assistant Tool Call + role=tool 的 response
    │ 输出：最终 assistant 文本
    ▼
ResponseWrapper / LongTextProcessStage / SendResponseBackStage
    │
    ▼
KOOK response
```

### 2.2 每一段的输入与输出

| 阶段 | 输入 | 输出 | LLM | PUBG API | 缓存行为 |
|---|---|---|---|---|---|
| KOOK Adapter | KOOK WebSocket 原始事件 | LangBot MessageEvent、MessageChain、sender/launcher 信息 | 否 | 否 | 否 |
| BotManager | Bot 配置、响应规则、routing rules | 选中的 Pipeline UUID | 否 | 否 | 否 |
| PreProcessor | 当前消息、Session、Pipeline 配置 | Conversation、System Prompt、Tool 列表、模型 | 否 | 否 | 读取内存 Session |
| 初始 local-agent 调用 | System Prompt、历史 Conversation、当前消息、Tools | assistant 文本或 Tool Call | 是 | 否 | 否 |
| PUBG Plugin | Tool 参数、LangBot Session、query_id | 发往 n8n 的 JSON；接收字符串 response | 否 | 间接 | 传递 context key |
| n8n Normalize Request | Webhook body | 标准化时间、queryPlan、四个玩家、contextKey | 否 | 否 | 否 |
| n8n Cache 层 | 全部 Data Table rows、标准化请求 | player cache 状态、match cache records、context 状态 | 否 | 否 | 读取 |
| n8n Player Lookup | player IDs、shard | PUBG Players API full response | 否 | 是 | 成功后写 player cache |
| n8n Match Lookup | Match ID、shard | PUBG Match API full response | 否 | 是 | 成功后写 match cache |
| n8n Aggregate | 已缓存比赛 + 本次获取比赛 | 格式化 response、summaries、contextPayload | 否 | 否 | 读取；生成 context |
| n8n Response | aggregate JSON | Webhook JSON | 否 | 否 | 否 |
| Tool 结果回传 | `body.response` | `role=tool` 字符串 | 否 | 否 | 否 |
| 最终 local-agent 调用 | 历史消息、Tool Call、Tool response | 最终 assistant 文本 | 是 | 否 | 写回内存 Conversation |
| KOOK 输出 | LangBot final response | KOOK 文本/分段消息 | 否 | 否 | 否 |

## 3. KOOK → PUBG Query Path

### 3.1 自然语言消息的真实路径

```text
KOOK WebSocket
→ LangBot KOOK Adapter
→ RuntimeBot
→ 通用群聊响应规则
→ KOOK Pipeline
→ PreProcessor
→ local-agent / arthur-combo
→ 可选 Tool Call: get_pubg_daily_stats
→ LangBot PUBG Plugin
→ n8n Webhook
```

当前 KOOK Bot 配置：

- Bot 名称：`KOOK`
- Bot UUID：`2f25e57b-6157-458d-99e4-db411ddc85d4`
- Adapter：`kook`
- Pipeline：`KOOK Pipeline`
- Pipeline UUID：`2cc265c7-0dd1-4221-b594-0a6b38d7c1d5`
- `pipeline_routing_rules`：`[]`

群聊通用响应规则中存在：

- `at: true`
- `prefix: ["arthur", "Arthur"]`
- `regexp: []`
- `random: 1`

这些是通用 Bot 响应条件，不是 PUBG 判断。也就是说，消息首先要满足 LangBot/KOOK 的通用响应规则，之后才可能进入 LLM。

### 3.2 `/pubg` 固定 Command 旁路

另外存在插件 Command：

```text
/pubg
→ PubgCommand
→ fetch_pubg_stats(
      query='今日战绩',
      query_plan={'operation': 'report', 'mode': 'competitive'}
  )
→ n8n Webhook
```

该路径：

- 不经过 LLM Tool Calling。
- 不进行自然语言意图识别。
- 固定使用 `今日战绩`。
- 固定使用 `operation=report`。
- 固定使用 `mode=competitive`。

### 3.3 属于哪一种路由模式

| 选项 | 当前是否存在 | 说明 |
|---|---:|---|
| A. 固定 Command | 是 | `/pubg` 旁路；固定查询今日战绩 |
| B. 关键词匹配 | 未发现 PUBG 专用关键词路由 | 通用响应规则不是 PUBG 意图判断 |
| C. 独立 LLM Intent Classification | 否 | 没有发现独立分类 LLM |
| D. LangBot Tool Calling | 是 | 自然语言路径的主要 PUBG 入口 |
| E. n8n AI Agent | 否 | n8n 中没有 AI Agent 节点 |
| F. Webhook | 是 | Plugin Tool 调用 n8n Webhook |
| G. 其他 | 是 | n8n Code Node 中有基于正则的业务解析 |

因此：

- “查询今日战绩”是谁判断为 PUBG 请求：正常情况下是 `local-agent` LLM 根据 System Prompt 和 Tool 描述决定调用 `get_pubg_daily_stats`。
- “昨天呢”是谁解析：LLM 负责决定是否调用 Tool；n8n `Normalize Request` 负责把 `昨天` 转换成时间范围。
- “跟前天比呢”是谁解析：LLM 可以把它作为 `compare` Tool 请求；n8n 只根据原始 query 的正则得到一个 `前天` 时间范围，不能表达两个比较周期。

## 4. n8n Workflows

### 4.1 Workflow 清单

通过真实 n8n 数据库搜索 Workflow 名称、节点 JSON、Webhook path 和 PUBG API URL，当前只发现一个 PUBG 相关 Workflow。

```text
Workflow 名称：PUBG 今日战绩
Workflow ID：pubg-daily-stats-20260830
Active：true / 1
当前 versionId：9f200dd9-a4aa-4c05-ac22-c35e82fe8622
Trigger：Webhook POST /webhook/pubg-daily-stats
节点数量：20
```

未发现：

- PUBG Sub-workflow。
- `Execute Workflow` 节点。
- n8n AI Agent 节点。
- n8n LLM/Chat Model 节点。
- 其他 Workflow 通过 PUBG endpoint 调用该 Workflow 的证据。

本地 `/Users/blacksidev/pubg-daily-stats.workflow.json` 的导出 `versionId` 为 `b8ae4fb1-4d7b-4de0-9d72-5dd0129de013`，与当前 n8n 数据库中的 `9f200dd9-a4aa-4c05-ac22-c35e82fe8622` 不同；本报告以真实运行数据库版本为准。

### 4.2 节点执行顺序与输入输出

#### 1. `PUBG Stats Webhook`

- Node ID：`b8ae4fb1-4d7b-4de0-9d72-5dd0129de001`
- Type：`n8n-nodes-base.webhook`。
- Purpose：接收 LangBot PUBG Plugin 的 POST 请求。
- 输入：Webhook body，通常包含 `chatInput`、`message`、`user_message_text`、`queryPlan`、`query_plan`、`context`、`queryId`。
- 输出：n8n Webhook item，供 `Normalize Request` 读取 `$json.body`。
- LLM：否。
- PUBG API：否。
- 缓存：不读、不写。
- Response mode：`responseNode`，由 `Respond to LangBot` 返回结果。

#### 2. `Normalize Request`

- Node ID：`b8ae4fb1-4d7b-4de0-9d72-5dd0129de003`
- Type：`n8n-nodes-base.code`。
- Purpose：把原始自然语言和 Tool 结构化参数转换成内部请求对象。
- 输入：Webhook body；优先读取 `chatInput`，其次 `message`、`user_message_text`；合并 `query_plan` 与 `queryPlan`。
- 输出：`chatInput`、`queryPlan`、`periodLabel`、`periodType`、`startMs`、`endMs`、`rangeStartMs`、`rangeEndBoundaryMs`、四个固定玩家、`playerIds`、`playerCacheKey`、`contextKey` 等。
- LLM：否；使用 JavaScript 正则和日期运算。
- PUBG API：否。
- 缓存：不读、不写。

#### 3. `Read PUBG Cache`

- Node ID：`b8ae4fb1-4d7b-4de0-9d72-5dd0129de013`
- Type：`n8n-nodes-base.dataTable`。
- Purpose：读取 `pubg_cache` Data Table 的全部行。
- 输入：无过滤条件的 Data Table get 请求。
- 输出：全部缓存 rows，包括 `cacheKey`、`cacheType`、`payload`、`refreshedAt`、`expiresAt`。
- LLM：否。
- PUBG API：否。
- 缓存：读全部；不是按当前问题做精确 Key 查询。

#### 4. `Prepare Cache`

- Node ID：`b8ae4fb1-4d7b-4de0-9d72-5dd0129de014`
- Type：`n8n-nodes-base.code`。
- Purpose：解析缓存 payload，构建 player cache、match cache 和 context cache 状态。
- 输入：`Normalize Request` 的请求对象 + `Read PUBG Cache` 全部 rows。
- 输出：`playerCacheValid`、`cacheStatus`、`freshPlayerPayload`、`stalePlayerPayload`、`cachedMatchRecords`、`cachedMatchCount`、`cacheAsOfAt`、`contextFresh`、`contextPayload`，以及可能被上下文覆盖后的 effective request。
- LLM：否。
- PUBG API：否。
- 缓存：读；不写。
- 重要条件：只有 `contextualFollowup && !periodExplicit && contextFresh` 时才应用 context cache。

#### 5. `Needs Player Lookup`

- Node ID：`b8ae4fb1-4d7b-4de0-9d72-5dd0129de015`
- Type：`n8n-nodes-base.if`。
- Purpose：判断是否需要刷新四个玩家的 Match ID 快照。
- 输入：`Prepare Cache` 输出的 `needsPlayerLookup`。
- 条件：`!!$json.needsPlayerLookup == true`。
- true 输出：进入 `Lookup PUBG Players`。
- false 输出：进入 `Use Cached Players`。
- LLM：否。
- PUBG API：节点本身不调用。
- 缓存：依据缓存状态分支。

#### 6. `Lookup PUBG Players`

- Node ID：`b8ae4fb1-4d7b-4de0-9d72-5dd0129de004`
- Type：`n8n-nodes-base.httpRequest`。
- Purpose：调用 PUBG Players API，获取四个账号及其关联 Match ID。
- 输入：`shard=steam`、`playerIds`。
- 请求：

  ```text
  GET https://api.pubg.com/shards/steam/players?filter%5BplayerIds%5D=<comma-separated account IDs>
  ```

- 输出：full response，包括 status code、headers、JSON body。
- LLM：否。
- PUBG API：是。
- 缓存：成功结果由后续 `Prepare Player Cache Row` 写入；本节点不直接写缓存。
- 超时：15 秒。
- HTTP 行为：`fullResponse=true`、`neverError=true`、JSON response。

#### 7. `Parse Player Lookup`

- Node ID：`b8ae4fb1-4d7b-4de0-9d72-5dd0129de005`
- Type：`n8n-nodes-base.code`。
- Purpose：解析 Players API，生成玩家快照和 Match ID 集合。
- 输入：Players API full response + `Prepare Cache` 的 stale payload。
- 输出：`playerSnapshots`、`foundPlayers`、`missingPlayers`、`matchIds`、`playerCachePayload`、`lookupError`、`usedStaleCache`。
- LLM：否。
- PUBG API：不直接调用。
- 缓存：生成待写入 player cache 的 payload；API 失败且存在 stale cache 时转为 stale 使用。
- 失败行为：有 stale player cache 时继续使用 stale；没有 stale 时输出空 `playerSnapshots` 和 `lookupError`。

#### 8. `Use Cached Players`

- Node ID：`b8ae4fb1-4d7b-4de0-9d72-5dd0129de016`
- Type：`n8n-nodes-base.code`。
- Purpose：从 fresh player cache 重建玩家快照和 Match ID 集合。
- 输入：`Prepare Cache` 的 `freshPlayerPayload`，以及标准化请求中的四个玩家。
- 输出：`playerSnapshots`、`matchIds`、`foundPlayers`、`missingPlayers`。
- LLM：否。
- PUBG API：否。
- 缓存：读；不写。

#### 9. `Build Match Fetch Plan`

- Node ID：`b8ae4fb1-4d7b-4de0-9d72-5dd0129de017`
- Type：`n8n-nodes-base.code`。
- Purpose：比较玩家快照中的 Match ID 与本地 Match cache，决定是否回源 Match API。
- 输入：玩家快照、`cachedMatchRecords`、`lookupError`、`usedStaleCache`。
- 核心逻辑：

  ```text
  missingMatchIds =
      lookupError && !usedStaleCache
        ? []
        : matchIds - cachedMatchIds
  ```

- 输出：有新 Match ID 时每个 ID 一个 item；没有新 ID 时输出一个 `matchId: null` item；同时输出 `newMatchCount`、`hasMissingMatches`、`cachedMatchCount`、`cacheStatus` 等。
- LLM：否。
- PUBG API：否。
- 缓存：读比较结果；不写。

#### 10. `Has New Match IDs`

- Node ID：`b8ae4fb1-4d7b-4de0-9d72-5dd0129de007`
- Type：`n8n-nodes-base.if`。
- Purpose：判断是否真正进入 Match API。
- 输入：`Build Match Fetch Plan` 的 item。
- 条件：`!!$json.matchId == true`。
- true 输出：进入 `Get PUBG Match`。
- false 输出：直接进入 `Aggregate Today's Stats`。
- LLM：否。
- PUBG API：节点本身不调用。
- 关键点：判断字段是 `matchId`，不是“当前问题有没有缓存答案”。

#### 11. `Get PUBG Match`

- Node ID：`b8ae4fb1-4d7b-4de0-9d72-5dd0129de008`
- Type：`n8n-nodes-base.httpRequest`。
- Purpose：按 Match ID 获取比赛详情。
- 输入：`shard`、`matchId`。
- 请求：

  ```text
  GET https://api.pubg.com/shards/steam/matches/<matchId>
  ```

- 输出：Match API full response。
- LLM：否。
- PUBG API：是，每个缺失 Match ID 一次。
- 缓存：成功后由后续节点写结构化 Match cache。
- 超时：20 秒。
- HTTP 行为：`fullResponse=true`、`neverError=true`、JSON response。

#### 12. `Extract Match Records`

- Node ID：`b8ae4fb1-4d7b-4de0-9d72-5dd0129de009`
- Type：`n8n-nodes-base.code`。
- Purpose：从 Match API response 提取已知四名玩家的结构化比赛摘要。
- 输入：Match API response + `Build Match Fetch Plan` 的计划对象。
- 输出：`matchId`、`createdAt`、`timestamp`、`matchType`、`gameMode`、`isCompetitive`、`isInRange`、`mapName`、`duration`、`patchVersion`、`players`。
- 玩家字段：`rank`、`kills`、`assists`、`damageDealt`、`dbnos`、`revives`、`headshotKills`、`timeSurvived`、`longestKill`。
- LLM：否。
- PUBG API：不直接调用。
- 缓存：有效 Match 会生成待写入 cache 的结构；错误 Match 设置 `cacheable=false`。

#### 13. `Aggregate Today's Stats`

- Node ID：`b8ae4fb1-4d7b-4de0-9d72-5dd0129de010`
- Type：`n8n-nodes-base.code`。
- Purpose：合并缓存比赛和本次获取比赛，按时间和竞技模式过滤，计算统计并格式化最终响应。
- 输入：`Prepare Cache` 的 cached matches、`Extract Match Records` 的比赛记录、`Build Match Fetch Plan` 的 queryPlan/时间范围/错误状态。
- 过滤：`isCompetitive=true`、game mode 在六种允许模式内、`timestamp >= startMs && timestamp < endMs`。
- 输出：`response`、`summaries`、`funRankings`、`metricBreakdown`、`contextPayload`、`matchCount`、`cacheStatus`、`newMatchesFetched` 等。
- LLM：否。
- PUBG API：否。
- 缓存：读取已有比赛；生成 context payload；由旁路写 context。

#### 14. `Respond to LangBot`

- Node ID：`b8ae4fb1-4d7b-4de0-9d72-5dd0129de012`
- Type：`n8n-nodes-base.respondToWebhook`。
- Purpose：把 Aggregate 输出作为 Webhook JSON 返回。
- 输入：`Aggregate Today's Stats` 的完整 JSON。
- 输出：完整 JSON，其中包括 `response`、统计和诊断字段。
- LLM：否。
- PUBG API：否。
- 缓存：否。
- 注意：插件只取返回 JSON 的 `response` 字段，其余结构化字段不会回传给 LLM。

#### 15. `Prepare Player Cache Row`

- Node ID：`b8ae4fb1-4d7b-4de0-9d72-5dd0129de018`
- Type：`n8n-nodes-base.code`。
- Purpose：把 Players API 结果转换为 Data Table row。
- 输入：`Parse Player Lookup` 的 `playerCachePayload`。
- 输出：`cacheKey`、`cacheType=playerLookup`、JSON 字符串 `payload`、`refreshedAt`、`expiresAt`。
- LLM：否。
- PUBG API：否。
- 缓存：准备写入，不负责实际 upsert。

#### 16. `Upsert PUBG Player Cache`

- Node ID：`b8ae4fb1-4d7b-4de0-9d72-5dd0129de019`
- Type：`n8n-nodes-base.dataTable`。
- Purpose：按 `cacheKey` upsert 玩家快照。
- 输入：Player cache row。
- 输出：Data Table upsert 结果。
- LLM：否。
- PUBG API：否。
- 缓存：写 `playerLookup`。

#### 17. `Prepare Match Cache Row`

- Node ID：`b8ae4fb1-4d7b-4de0-9d72-5dd0129de020`
- Type：`n8n-nodes-base.code`。
- Purpose：把每个有效 Match 记录转换为 Match cache row。
- 输入：`Extract Match Records` 输出。
- 输出：`cacheKey=match:<shard>:<matchId>`、`cacheType=match`、结构化 JSON `payload`、`refreshedAt`、`expiresAt`。
- LLM：否。
- PUBG API：否。
- 缓存：准备写入。

#### 18. `Upsert PUBG Match Cache`

- Node ID：`b8ae4fb1-4d7b-4de0-9d72-5dd0129de021`
- Type：`n8n-nodes-base.dataTable`。
- Purpose：按 Match cache key upsert 比赛摘要。
- 输入：Match cache row。
- 输出：Data Table upsert 结果。
- LLM：否。
- PUBG API：否。
- 缓存：写 `match`。

#### 19. `Prepare PUBG Context Row`

- Node ID：`b8ae4fb1-4d7b-4de0-9d72-5dd0129de022`
- Type：`n8n-nodes-base.code`。
- Purpose：把本次汇总结果转换为会话上下文缓存 row。
- 输入：`Aggregate Today's Stats` 的 `contextPayload` + `contextKey`。
- 输出：`cacheKey=contextKey`、`cacheType=context`、JSON 字符串 `payload`、`refreshedAt`、`expiresAt`。
- LLM：否。
- PUBG API：否。
- 缓存：准备写入。

#### 20. `Upsert PUBG Context`

- Node ID：`b8ae4fb1-4d7b-4de0-9d72-5dd0129de023`
- Type：`n8n-nodes-base.dataTable`。
- Purpose：按 `contextKey` 覆盖/更新最近一次上下文。
- 输入：Context cache row。
- 输出：Data Table upsert 结果。
- LLM：否。
- PUBG API：否。
- 缓存：写 `context`。

### 4.3 分支关系

```text
Prepare Cache
    └─ Needs Player Lookup
         ├─ true  → Lookup PUBG Players → Parse Player Lookup
         │                                      ├─ Build Match Fetch Plan
         │                                      └─ Prepare Player Cache Row → Upsert Player Cache
         └─ false → Use Cached Players
                                      │
                                      ▼
                           Build Match Fetch Plan
                                      ▼
                           Has New Match IDs
                                ├─ true  → Get PUBG Match → Extract Match Records
                                │                              ├─ Aggregate
                                │                              └─ Prepare Match Cache Row → Upsert Match Cache
                                └─ false → Aggregate
                                                   ├─ Respond to LangBot
                                                   └─ Prepare Context Row → Upsert Context
```

## 5. Time Parsing

### 5.1 负责时间理解的组件

当前真正决定业务时间范围的是 n8n `Normalize Request` JavaScript Code Node，而不是 DateTime Node。

- LLM：可以在 Tool 参数中填写 `period_hint`，也可以传 `operation` 等结构化信息。
- n8n `Normalize Request`：使用原始 `query` 的文本和 JavaScript 正则实际决定 `startLabel`、`endLabel`。
- `Aggregate Today's Stats`：不重新解析自然语言时间，只使用 `startMs`、`endMs` 过滤比赛。
- 时区：代码硬编码 `Asia/Shanghai`，Workflow settings 也为 `Asia/Shanghai`。
- 业务日边界：每天 `06:00` 到次日 `06:00`。

### 5.2 当前已支持的表达

| 用户表达 | 当前代码结果 |
|---|---|
| 今天、今日、今晚 | 当前业务日 |
| 昨天、昨日 | 当前业务日前一个业务日 |
| 前天 | 当前业务日前两个业务日 |
| 大前天 | 当前业务日前三个业务日 |
| `N天前` | 当前业务日前 N 个业务日，支持 1 至 3 位数字 |
| 本周、这周、本星期、本礼拜、周总结 | 当前周，周一至下周一 |
| 上周、上星期、上礼拜 | 上一个完整周，周一至当前周一 |
| 最近 7 天、近 7 天、过去 7 天 | 当前业务日往前 6 天至下一业务日 |
| `8月20日`、`8月20号` | 一个业务日：8 月 20 日 06:00 至 8 月 21 日 06:00 |
| `2026年8月20日` | 指定年份的一个业务日 |
| `2026-08-20`、`2026/08/20` | 指定日期的一个业务日 |
| 两个日期 | 转换为日期范围，结束日期通过加一天变成半开区间 |

日期没有明确年份时，代码会依据当前月日推断年份。以审计日期 2026 年 9 月 1 日为例，`8月20日` 会解析为 `2026-08-20`。

### 5.3 最终时间字段

`Normalize Request` 输出的主要字段：

```json
{
  "startMs": 0,
  "endMs": 0,
  "rangeStartMs": 0,
  "rangeEndBoundaryMs": 0,
  "rangeStartLabel": "YYYY-MM-DD",
  "rangeEndLabel": "YYYY-MM-DD",
  "periodLabel": "今日 / 昨日 / 上周总结 / ...",
  "periodType": "day / week / range",
  "isPartial": false,
  "rangeText": "YYYY-MM-DD 06:00 至 YYYY-MM-DD 06:00（北京时间）"
}
```

其中：

- `rangeStartMs`：开始业务日的 Unix milliseconds。
- `rangeEndBoundaryMs`：结束业务日边界的 Unix milliseconds。
- `startMs`：当前实现等于 `rangeStartMs`。
- `endMs`：`min(rangeEndBoundaryMs, nowMs)`；当前正在进行的业务日会被截断到当前时间。
- 比赛过滤使用左闭右开区间：`timestamp >= startMs && timestamp < endMs`。

### 5.4 已确认的时间问题

| 表达 | 实际行为 | 是否正确 |
|---|---|---:|
| 上周六 | 命中 `上周`，解析为整个上周，不解析星期六 | 否 |
| 昨晚 | 没有 `昨晚` 专用规则，通常回退为今日 | 否 |
| 昨天晚上 | 命中 `昨天`，解析整个昨天业务日，不限制晚上 | 否 |
| 8 月 20 日晚上 10 点以后 | 只解析 `8月20日`，忽略 `22:00` 与“以后” | 否 |
| 最近 20 场、最近 20 把 | 没有场次数窗口规则，通常回退为今日 | 否 |
| 本月、八月份 | 没有正式月份规则，通常回退为今日 | 否 |
| 上上周 | 没有规则，通常回退为今日 | 否 |
| 跟前天比 | 只能得到一个 `前天` period，不能表示昨天与前天两个 period | 否 |
| 八月二十日 | 当前正则只接受阿拉伯数字，不接受中文数字 | 否 |

### 5.5 `period_hint` 的实际作用

`period_hint` 会被保存在 `queryPlan` 中，也会被写入 context payload，但没有参与核心时间分支。

因此，如果 LLM 传入：

```json
{
  "query": "最近20场战绩",
  "period_hint": "最近20场"
}
```

而原始 `query` 没有命中 n8n 的时间规则，`Normalize Request` 仍可能把时间范围设成今日。`period_hint` 不是可靠的时间查询协议。

## 6. Cache

### 6.1 缓存存储位置

逻辑缓存：

```text
n8n Data Table
名称：pubg_cache
ID：5ZFCBuokb-pn1ey9
```

物理持久化：

```text
n8n SQLite database
表：data_table_user_5ZFCBuokb-pn1ey9
```

只读审计时观察到 154 行：

- `match`：135 行。
- `context`：17 行。
- `playerLookup`：1 行。
- `meta`：1 行。

未发现 PUBG 使用独立 Redis、PostgreSQL、JSON 文件或 `staticData` 缓存。

LangBot 的 `/DATA/AppData/langbot/data/langbot.db` 是 LangBot 配置、监控、插件等持久化数据库，不是当前 PUBG Match cache 的主要存储。

### 6.2 Cache Key

#### Player cache

```text
player-lookup:<sorted account IDs>
```

当前四个账号 ID 会排序后拼接，因此四个玩家集合共享一个 player lookup cache。

#### Match cache

```text
match:steam:<matchId>
```

一个 Match ID 一个缓存 row。

#### Context cache

```text
pubg-context:<launcher type>:<launcher id>
```

例如 `pubg-context:group:<groupId>` 或 `pubg-context:person:<personId>`。插件同时把 `senderId` 等信息放入 context payload，但 context Key 本身主要由 launcher type/id 决定。

### 6.3 Cache Value

#### Player value

```json
{
  "schemaVersion": 1,
  "fetchedAt": "ISO timestamp",
  "players": [
    {
      "accountId": "...",
      "playerName": "...",
      "displayName": "...",
      "found": true,
      "apiName": "...",
      "matchIds": ["...", "..."]
    }
  ],
  "rateLimit": {}
}
```

它缓存的是玩家是否存在和 PUBG API 返回的 Match ID 列表，不是最终回答。

#### Match value

```json
{
  "schemaVersion": 1,
  "matchId": "...",
  "shard": "steam",
  "createdAt": "...",
  "timestamp": 0,
  "matchType": "competitive",
  "gameMode": "squad",
  "isCompetitive": true,
  "mapName": "...",
  "duration": 0,
  "patchVersion": "...",
  "players": [
    {
      "accountId": "...",
      "playerName": "...",
      "rank": 1,
      "kills": 0,
      "assists": 0,
      "damageDealt": 0,
      "dbnos": 0,
      "revives": 0,
      "headshotKills": 0,
      "timeSurvived": 0,
      "longestKill": 0
    }
  ]
}
```

它不是 PUBG 原始完整 API response；未提取字段以后无法从 Match cache 恢复。

#### Context value

Context payload 包含：

- `periodLabel`
- `periodType`
- `reportTitle`
- `rangeStartLabel`
- `rangeEndLabel`
- `queryPlan`
- `focusPlayerNames`
- 玩家统计摘要
- `matchCount`
- `updatedAt`
- `expiresAt`

它不包含完整 Match ID 列表，也不包含完整原始聊天文本。

### 6.4 TTL

| 类型 | 代码 TTL | 实际用途 |
|---|---:|---|
| Player lookup | 60 秒 | 60 秒内复用四个玩家的 Match ID 快照 |
| Match | 14 天 | 代码只保留/考虑最近 14 天比赛摘要 |
| Context | 12 小时 | 供短期追问复用上次 period、摘要和 focus player |

这些 TTL 是应用层手工写入和检查的 `expiresAt`，不是 Data Table 原生 TTL。Data Table row 不会因为 TTL 自动消失；代码会根据时间把它视为 fresh、stale 或不纳入当前 match records。

### 6.5 Cache HIT 流程

```text
Read PUBG Cache：读取全部 rows
→ Prepare Cache：找到 player cache
→ player payload 存在且 expiresAt > now
→ cacheStatus=fresh
→ Needs Player Lookup=false
→ Use Cached Players
→ 读取 player snapshot 中已有 Match IDs
→ 与 cachedMatchRecords 的 Match IDs 比较
→ 没有 missingMatchIds
→ Has New Match IDs=false
→ 跳过 Get PUBG Match
→ Aggregate 直接使用已有 Match cache
```

注意：这是“玩家快照命中 + Match ID 没有新增”，不是“当前问题答案命中”。

### 6.6 Cache MISS / STALE 流程

#### Player cache 过期或不存在

```text
playerCacheValid=false
→ Needs Player Lookup=true
→ Lookup PUBG Players
→ Parse Player Lookup
→ 成功：获得最新 Match IDs
→ 比较 Match cache
→ 只请求本地不存在的 Match IDs
```

#### Player API 失败但有 stale player cache

```text
Lookup PUBG Players failed
→ Parse Player Lookup 发现 stalePlayerPayload
→ usedStaleCache=true
→ 使用过期玩家 Match ID 列表
→ 仍可能请求未缓存 Match ID
→ response 中添加玩家列表同步失败警告
```

#### Player API 失败且没有 stale player cache

```text
Lookup PUBG Players failed
→ playerSnapshots=[]
→ matchIds=[]
→ lookupError=查询 PUBG 玩家失败...
→ Build Match Fetch Plan:
     lookupError && !usedStaleCache ? missingMatchIds=[]
→ Has New Match IDs=false
→ 不执行 Get PUBG Match
→ Aggregate 空数据
```

这是第二条已确认的“没有继续查询 Match API”路径。

### 6.7 当前 Cache 设计的关键语义

当前没有以下 Key：

```text
player + date
question text
normalized query
operation + period + metrics
```

所以：

- “缓存中不存在这个问题的答案”不是当前 n8n 的判断条件。
- n8n 只关心“玩家快照中有哪些 Match ID”以及“这些 Match ID 的结构化比赛摘要是否已经在本地”。
- 如果一个目标日期没有对应 Match 记录，但玩家快照也没有该日期的 Match ID，当前流程无法凭日期直接调用 Match API。
- PUBG Match endpoint 需要 Match ID；当前没有按日期查询 Match 的 API endpoint。

### 6.8 已观察到的执行证据

历史执行记录与当前 Workflow 版本中观察到：

- `643`、`648`、`650`、`651`：player cache fresh，未执行 Player API，也未执行 Match API，直接聚合缓存。
- `649`：player cache stale，执行 Player API，新增 Match ID 为 0，因此未执行 Match API。
- `628`：执行 Player API，发现 3 个新 Match ID，执行 Match API。
- `633`、`634`：Player API 超时，使用 stale player cache，仍发现 2 个新 Match ID，执行 Match API。
- `635`、`638`、`642`：执行 Player API，但新 Match ID 为 0，未执行 Match API。

这些记录证明“Player API 是否执行”和“Match API 是否执行”是两个独立判断。

### 6.9 错误处理

- n8n HTTP Request Node 使用 `neverError=true`，所以 HTTP 错误进入后续 Code Node 分析，而不是一定中断 Workflow。
- Player API 失败时优先使用 stale player cache。
- Player API 失败且无 stale cache 时生成 `lookupError`，但仍可进入 Aggregate。
- Match API 失败时 `Extract Match Records` 输出 `cacheable=false` 的错误记录；最终汇总仍可能只使用其他缓存记录。
- Plugin 的 HTTP/JSON 异常会返回：`暂时无法获取 PUBG 战绩，请稍后再试。`。
- LangBot Pipeline 运行时异常按当前配置使用 failure hint；这与“没有比赛数据”的业务响应是不同错误层次。

## 7. PUBG API Layer

### 7.1 当前实际 Endpoint

#### Players API

```text
GET https://api.pubg.com/shards/steam/players?filter%5BplayerIds%5D=<accountIds>
```

用途：

- 检查四个固定账号是否存在。
- 获取每个账号的 `relationships.matches.data` Match ID 列表。

请求参数：

- `shard=steam`。
- `filter[playerIds]`：四个硬编码 accountId，以逗号拼接。
- Header：`Accept: application/vnd.api+json`。

当前没有日期、时间、最近 N 场等 API 参数。

#### Match API

```text
GET https://api.pubg.com/shards/steam/matches/<matchId>
```

用途：

- 获取指定 Match ID 的比赛属性、Participant、Roster。

请求参数：

- `shard=steam`。
- `matchId`：必须由 Players API 的 Match 列表或缓存提供。
- Header：`Accept: application/vnd.api+json`。

### 7.2 当前使用的 API 字段

比赛级字段：

- Match ID。
- `createdAt`。
- `matchType`。
- `gameMode`。
- `mapName`。
- `duration`。
- `patchVersion`。

Participant/排名字段：

- `playerId`。
- `kills`。
- `assists`。
- `damageDealt`。
- `DBNOs`。
- `revives`。
- `headshotKills`。
- `timeSurvived`。
- `longestKill`。
- `winPlace`。
- Roster `stats.rank` 作为备用排名来源。

### 7.3 当前可以回答的内容

| 内容 | 当前是否可以 | 备注 |
|---|---:|---|
| 场次 | 是 | 统计过滤后的 Match rows |
| kills | 是 | Participant `kills` 汇总 |
| deaths | 部分 | 代码用 `rank===1` 视为未死亡，否则视为死亡 |
| KD | 是 | `kills / deaths`；0 死且有击杀显示 `∞` |
| assists | 是 | Participant `assists` |
| damage | 是 | `damageDealt` 汇总 |
| placement | 是 | `winPlace` 或 Roster rank |
| win | 是 | `rank===1` 计为吃鸡 |
| top10 | 是 | `rank<=10` 计为前十 |
| match 时间 | 是 | `createdAt` |
| map | 是 | `mapName` 映射为中文地图名 |
| game mode | 是 | `gameMode` 映射为中文 |
| weapon | 否 | 未提取、未缓存、未格式化 |
| teammate 关系 | 否 | 只识别四个固定账号，未建立队友关系模型 |
| telemetry | 否 | 未调用 Telemetry，也未发现相关 endpoint |
| Season Stats | 否 | 未使用 |
| Lifetime Stats | 否 | 未使用 |
| 最近 N 把 | 否 | 没有 N 场 query schema 和窗口逻辑 |
| 单局最高伤害 | 否 | 当前 ranking 是玩家汇总维度 |
| 单局最多击杀 | 否 | 当前 ranking 是玩家汇总维度 |
| 逐日趋势 | 否 | 当前只按整个 query period 汇总 |

### 7.4 竞技模式过滤

代码只把以下模式视为允许的竞技模式：

```text
solo
solo-fpp
duo
duo-fpp
squad
squad-fpp
```

并要求：

```text
matchType === 'competitive'
```

Tool Prompt 还声明排除 casual、arcade、TDM 和 bot，但 n8n Code 中没有独立的 bot 字段判断；代码层真正明确执行的是 `matchType=competitive` 和允许的 `gameMode`。因此“bot 一定被排除”不能仅由当前代码完全证明。

### 7.5 数据丢失点

`Extract Match Records` 不保存完整 PUBG API response，只保存预定义字段。被丢弃的 API 字段以后无法从 Match cache 恢复；如果要回答 weapon、telemetry 或更细粒度的 Match 问题，当前缓存不能直接提供数据。

## 8. LLM / Agent Layer

### 8.1 当前模型

- Model：`arthur-combo`。
- Model UUID：`4d608fdb-126b-42cd-a8a5-be1349629713`。
- Provider：`9Router`。
- Capabilities：`vision`、`func_call`、`reasoning`。
- Context length：1,000,000。
- Fallback model：未配置。
- Pipeline runner：`local-agent`。
- Pipeline `max-round`：10000。
- Runtime 中 `local-agent` Tool-call loop hard cap：128 轮。

底层实际被 9Router 路由到哪个外部模型：`UNKNOWN`。当前能确认的是 LangBot Model entity 和 Provider 配置。

### 8.2 System Prompt

当前 `KOOK Pipeline` 的主要 System Prompt 核心内容是：

```text
You are a helpful assistant.
使用可用工具获取实时信息，并以工具返回为准，不要臆测；如果问题与某个工具相关，直接调用该工具。

【PUBG 输出规则】
当调用 get_pubg_daily_stats 后，工具返回内容就是已经排版好的最终 KOOK 回复。
必须只输出工具返回内容本身，不得总结、改写、翻译、补充标题、重新计算、调整顺序或添加用户 @。
必须保留工具返回的换行、emoji、Unicode 框线字符和三反引号代码块；严禁把框线内容转换成 Markdown 管道表格。
用户可能说 KDA，但 PUBG 结果统一使用 KD；助攻只按工具返回展示。
```

PreProcessor 还会动态追加当前日期提示，内容大意是：

```text
Current date: YYYY-MM-DD (...).
Resolve relative time references based on this date, not your training cutoff.
For time-sensitive information, verify with a search tool if available rather than answering from memory.
```

这段日期提示是通用 LLM grounding，不等于 PUBG 的 06:00 业务日解析；真正的 PUBG 时间范围仍由 n8n `Normalize Request` 决定。

### 8.3 PUBG Tool 描述

Tool 名称：`get_pubg_daily_stats`。

Tool 描述明确要求：

- PUBG、绝地求生、吃鸡战绩、KD/KDA、历史比赛、排名、玩家指标必须调用 Tool。
- 短追问也要调用 Tool。
- 完整 query 必须传入，包括日期、代词和追问措辞。
- 可选结构化字段包括 `operation`、`metrics`、`period_hint`、`mode`、`group_by`、`ranking`。
- Tool 返回值已经是最终 KOOK 回复，不应改写。

Tool 参数：

```text
query       required string
operation   report | per_player | rank | compare | trend
metrics     kd | kills | assists | damage | dbnos | revives | rank | wins | top10 | survival_time
period_hint string
mode        competitive
group_by    player | ranking | match | team
ranking     strongest | weakest | steadiest | kills | damage | assists | dbnos | revives | all
```

### 8.4 Tool 是否真的强制调用

不是。

PreProcessor 会把 Tool schema 提供给模型，`local-agent` 的执行逻辑是：

```text
第一次 LLM 返回
→ 如果有 final_msg.tool_calls：执行 Tool loop
→ 如果没有 tool_calls：直接把 assistant 文本作为回答
```

Tool Prompt 的“必须调用”是模型指令，不是运行时硬门槛。

因此当前存在真实路径：

```text
用户 PUBG 问题
→ local-agent LLM
→ 未返回 tool_calls
→ 直接输出“不知道/没有数据”等文本
→ 不进入 Plugin
→ 不进入 n8n
→ 不读取 Data Table
→ 不调用 PUBG API
```

### 8.5 Tool 列表加载

Pipeline 配置：

```text
enable-all-tools: true
tools: []
```

在当前 LangBot 源码中，`enable-all-tools=true` 时不会把空 `tools` 当成“禁用全部”，而是加载可用 Tools。因此 `get_pubg_daily_stats` 可以被 `arthur-combo` 看到。

Pipeline extensions 也设置为 `enable_all_plugins=true`。当前线上 PUBG Plugin 已启用。

### 8.6 每次 LLM 调用的职责

#### 第一次 LLM 调用

- Model：`arthur-combo`。
- System Prompt：Pipeline Prompt + 当前日期提示 + Tool schema 描述。
- User input：当前用户消息，以及已有 Conversation 内容。
- Tools：所有可用 Tool，包含 `get_pubg_daily_stats`。
- Memory：当前 LangBot 内存 Conversation。
- Expected output：普通 assistant 文本，或者带参数的 Tool Call。
- 实际职责：同时理解问题、判断是否属于 PUBG、决定是否查数据、生成 Tool 参数。

#### Tool 执行

- 不是 LLM 调用。
- Plugin 将 Tool 参数转换成 n8n POST body。
- n8n 返回 JSON。
- Plugin 只提取 `response` 字符串。

#### Tool 后第二次 LLM 调用

- 输入：原始历史 + assistant Tool Call + `role=tool` response。
- Expected output：最终 assistant 文本。
- System Prompt 要求原样保留 Tool 结果，但这仍然是 Prompt 约束，不是代码硬约束。

### 8.7 是否存在“一次 LLM 同时负责全部职责”

是，部分存在。

- LLM 负责理解自然语言。
- LLM 负责判断是否调用 PUBG Tool。
- LLM 负责填写可选 queryPlan。
- LLM 负责 Tool 后的最终话术。
- n8n 负责真正的缓存、API、时间解析和统计。

因此“是否查 API”由 LLM 的 Tool Call 决定；而“查哪些 API”由 n8n 的缓存分支决定。这是两个不同层次的决策。

## 9. Conversation Context

### 9.1 LangBot Session 保存方式

Conversation 由 LangBot `SessionManager` 保存在进程内内存，不是 PUBG 专用数据库。

Session key 包含：

```text
instance_uuid
workspace_uuid
placement_generation
bot_uuid
launcher_type
launcher_id
```

Session key 不包含 `sender_id`。

因此：

- 私聊通常按 person launcher ID 保存。
- 群聊按 group launcher ID 保存。
- 同一个群内不同发送者共享同一个 Session/Conversation。
- `sender_id` 会作为 Session 属性和请求 context 字段存在，但不会把群内每个用户分成不同 Conversation。

### 9.2 Conversation 内容

local-agent 请求消息大致构造成：

```text
query.prompt.messages
    + query.messages
    + current user message
```

Tool 调用以后，以下消息会被追加给下一轮 LLM：

- assistant 的 Tool Call message。
- `role=tool` 的工具结果。
- Tool 后 assistant 的最终消息。

在当前实现中，最终会把当前用户消息和 `query.resp_messages` 写回 Conversation。

由于插件只返回 `body.response`，Conversation 中通常保存的是排版后的文字回答，而不是 n8n 返回的完整 `summaries`、`matchCount`、`cacheStatus` 或 `contextPayload` JSON。

### 9.3 保存时间与容量

从 LangBot 配置和 SessionManager 代码确认：

- Session idle TTL：86400 秒，即 24 小时。
- 每个 Session 最多 20 个 Conversation。
- 每个 Conversation 最多 100 条消息。
- Pipeline 的 `expire-time`：0；没有单独的外部 Conversation 过期机制。
- LangBot 进程重启后，进程内 Conversation memory 会丢失。
- Monitoring 数据库会保存监控记录，但没有发现它被重新作为实时 Conversation memory 注入 LLM。

### 9.4 n8n Context cache

n8n 还有独立的 context cache：

```text
pubg-context:<launcher type>:<launcher id>
TTL：12 小时
```

它保存：

- 上一次 period。
- 上一次 queryPlan。
- 上一次玩家统计摘要。
- focus player。

它不保存：

- 完整聊天文本。
- 完整 Match ID 列表。
- 每局详细 Match records。

只有当后续请求满足：

```text
contextualFollowup == true
&& periodExplicit == false
&& contextFresh == true
```

`Prepare Cache` 才会应用 context cache 的时间和 queryPlan。

### 9.5 连续追问能力判断

用户：

```text
昨天战绩怎么样？
```

机器人回答后：

```text
哪一把伤害最高？
```

当前模型可能从上一条排版文本理解“哪一把”，但系统没有可靠的结构化 Match 引用：

- Conversation 里主要是自然语言回答。
- n8n context 不保存 Match ID 列表。
- Aggregate 没有单局伤害排序操作。
- Tool schema 中虽然有 `group_by=match`，但 n8n 实现没有对应的 Match-level ranking。

所以这类追问无法保证正确。

### 9.6 历史回答是否可能被当成事实

是，存在可能。

System Prompt 要求“相关问题调用 Tool”和“不要根据记忆猜测”，但运行时没有强制检查。若模型没有调用 Tool，它可以直接使用历史 assistant/tool 文本作为上下文回答。

当前无法从某一条历史用户消息单独证明它究竟是：

- LLM 跳过了 Tool；
- Tool 调用了但 n8n 返回空聚合；
- PUBG API 超时；
- stale cache 导致数据不完整；
- 监控记录遗漏。

这些具体历史事件结论为 `UNKNOWN`，需要对应 query 的完整 LLM/tool trace 才能区分。

## 10. Example Query Traces

以下是**不改变任何数据、不实际调用 Webhook 的静态推演**。时间示例以审计日期 2026-09-01、Asia/Shanghai、当前时间已经过 06:00 为基准：

```text
今日业务日：2026-09-01 06:00 至 2026-09-02 06:00
昨日业务日：2026-08-31 06:00 至 2026-09-01 06:00
前日业务日：2026-08-30 06:00 至 2026-08-31 06:00
```

每个案例的初始 LLM 都存在两个结果：

- 若 LLM 不返回 Tool Call：到此结束，n8n/API 均为 NO。
- 若 LLM 按 Tool Prompt 调用：继续进入下方 n8n 路径。

### CASE 1：查询今日战绩

```text
User: 查询今日战绩
↓
KOOK Adapter
↓
KOOK Pipeline / PreProcessor
↓
local-agent 初始 LLM
↓
get_pubg_daily_stats(query=查询今日战绩, operation=report, mode=competitive)
↓
PUBG Plugin
↓
n8n Webhook
↓
Normalize Request
  start = 2026-09-01 06:00
  end boundary = 2026-09-02 06:00
  endMs = 当前时间（今日为 partial）
↓
Read PUBG Cache → Prepare Cache
↓
Needs Player Lookup
  ├─ player cache fresh → Use Cached Players
  └─ player cache stale/empty → Players API → Parse Player Lookup
↓
Build Match Fetch Plan
↓
Has New Match IDs
  ├─ 有新 ID → Match API × N → Extract
  └─ 无新 ID → 跳过 Match API
↓
Aggregate Today's Stats
  → 统计 2026-09-01 06:00 之后的竞技比赛
↓
Respond to LangBot
↓
Tool response
↓
local-agent 最终 LLM
↓
KOOK
```

PUBG API：条件执行。缓存和 API 数据完整时，路径可以正确得到今日汇总；若 LLM 跳过 Tool，则无法查询。

### CASE 2：昨天战绩怎么样？

```text
User: 昨天战绩怎么样？
↓
KOOK Adapter → Pipeline → PreProcessor → local-agent
↓
get_pubg_daily_stats(query=昨天战绩怎么样？)
↓
PUBG Plugin → n8n Webhook
↓
Normalize Request
  period = 昨日
  start = 2026-08-31 06:00
  end = 2026-09-01 06:00
↓
Read Cache → Prepare Cache
↓
Player cache 分支
↓
Build Match Fetch Plan
↓
新 Match ID？
  ├─ 是 → Match API
  └─ 否 → 只用 Match cache
↓
Aggregate → Respond
↓
Tool result → 最终 LLM → KOOK
```

PUBG API：条件执行。对“昨日汇总”本身，当前时间解析可以正确；数据是否完整取决于 Player 快照和 Match cache。

### CASE 3：前天呢？

```text
User: 前天呢？
↓
KOOK Adapter → Pipeline → Conversation memory → local-agent
↓
按 Tool Prompt，LLM 应调用 get_pubg_daily_stats
↓
query=前天呢？
↓
n8n Normalize Request
  period = 前天
  start = 2026-08-30 06:00
  end = 2026-08-31 06:00
↓
Read Cache → Prepare Cache → Player branch
↓
Build Match Fetch Plan → Has New Match IDs
↓
可能执行 Match API，也可能直接聚合缓存
↓
Aggregate → Respond → Tool result
↓
最终 LLM → KOOK
```

由于 `前天` 是明确支持的相对日期，n8n 的日期范围可正确；但“前天呢”是否进入 n8n 仍取决于 LLM 是否真的发出 Tool Call。

### CASE 4：昨天哪一把伤害最高？

```text
User: 昨天哪一把伤害最高？
↓
Pipeline → local-agent 初始 LLM
↓
get_pubg_daily_stats(
  query=昨天哪一把伤害最高？,
  operation=rank,
  ranking=damage
)
↓
n8n Normalize Request
  period = 昨日
  start = 2026-08-31 06:00
  end = 2026-09-01 06:00
↓
Cache / Player API / Match API 条件分支
↓
Aggregate Today's Stats
  asksDamageKing=true
  rankingMode=damage
  findRankingResult('damage')
↓
输出：玩家维度的“伤害王”
↓
Tool result → 最终 LLM → KOOK
```

PUBG API：条件执行。

最终不能正确回答“哪一把”，因为当前 `damage` ranking 比较的是玩家在整个时间范围内的总伤害/场均伤害，不是 Match row 内的单局伤害；响应不会给出最高伤害的 Match ID。

### CASE 5：最近 20 场哪把杀人最多？

```text
User: 最近20场哪把杀人最多？
↓
Pipeline → local-agent
↓
get_pubg_daily_stats(
  query=最近20场哪把杀人最多？,
  operation=rank,
  ranking=kills
)
↓
n8n Normalize Request
  未命中“最近 N 场”规则
  未命中日期/周/最近 7 天规则
  fallback = 今日
↓
Cache / Player API / Match API 条件分支
↓
Aggregate
  rankingMode=kills
  对玩家汇总 kills 排序
↓
返回“击杀王”玩家，而不是最近 20 把中的某一把
↓
最终 LLM → KOOK
```

PUBG API：条件执行。

最终不能正确回答：

- 时间范围不是最近 20 场，而是今日。
- 没有最近 N 场窗口。
- 没有 Match-level kills ranking。

### CASE 6：8 月 20 号晚上 10 点以后战绩怎么样？

```text
User: 8月20号晚上10点以后战绩怎么样？
↓
Pipeline → local-agent → get_pubg_daily_stats
↓
n8n Normalize Request
  识别日期：2026-08-20
  start = 2026-08-20 06:00
  end = 2026-08-21 06:00
  忽略“晚上10点以后”
↓
Cache / Player API / Match API 条件分支
↓
Aggregate
  统计整个 2026-08-20 业务日
↓
Respond → Tool result → 最终 LLM → KOOK
```

PUBG API：条件执行。

最终不能正确回答“22:00 以后”，因为当前时间 Schema 只有业务日边界，没有小时/分钟下界。

### CASE 7：先问昨天，再问跟前天比

#### 第一个问题

```text
User: 昨天战绩怎么样？
↓
local-agent → get_pubg_daily_stats
↓
n8n Normalize Request
  period = 昨日
  2026-08-31 06:00 至 2026-09-01 06:00
↓
Cache / API 条件分支
↓
Aggregate → Respond
↓
写入：
  LangBot 内存 Conversation
  n8n context cache
↓
KOOK response
```

#### 第二个问题

```text
User: 跟前天比呢？
↓
local-agent 读取上一轮 Conversation
↓
若调用 Tool：query=跟前天比呢？, operation=compare
↓
n8n Normalize Request
  asksCompare=true
  识别“前天”
  periodExplicit=true
  period = 前天
  2026-08-30 06:00 至 2026-08-31 06:00
↓
因为 periodExplicit=true，不应用上一轮 context 的“昨天”范围
↓
Aggregate operation=compare
  比较的是“前天周期内的玩家”，不是“昨天 vs 前天”
↓
Respond → Tool result → 最终 LLM → KOOK
```

最终不能保证正确回答“昨天与前天的比较”。当前 Query Schema 只能表达一个 period，不能表达 `periodA` 与 `periodB` 两个独立时间窗口。

如果 LLM 没有调用 Tool，第二个问题也可能直接基于上一轮回答生成文本；具体某一次请求是否跳过 Tool：`UNKNOWN`。

### CASE 8：缓存当前没有，但 PUBG API 理论上可以查询

静态例子：

```text
User: 2026年8月20日战绩怎么样？
前提：目标日期的 Match 摘要不在当前 Match cache
```

#### 情况 A：玩家快照可获得目标 Match ID

```text
User → local-agent → get_pubg_daily_stats
↓
n8n Normalize Request
  2026-08-20 06:00 至 2026-08-21 06:00
↓
Player cache stale/empty
↓
Players API
↓
返回目标日期对应 Match ID
↓
Build Match Fetch Plan
  target Match ID 不在 Match cache
↓
Has New Match IDs=true
↓
Match API × N
↓
Extract → Aggregate → Respond
↓
Tool result → 最终 LLM → KOOK
```

这种情况下，缓存没有 Match 摘要，但 API 会被调用。

#### 情况 B：fresh player snapshot 没有目标 Match ID

```text
User → local-agent → Tool
↓
n8n Normalize Request
↓
player cache fresh
↓
Use Cached Players
  使用旧的 Match ID 列表
↓
目标日期的 Match ID 不在 snapshot
↓
Build Match Fetch Plan 看不到目标 Match ID
↓
missingMatchIds=[]
↓
Has New Match IDs=false
↓
不调用 Match API
↓
Aggregate 找不到该日期记录
↓
返回“暂未找到已收录的竞技比赛”等空结果
```

#### 情况 C：Players API 失败且无 stale player cache

```text
Tool → n8n
↓
Players API failed
↓
无 stale player cache
↓
playerSnapshots=[]
↓
Build Match Fetch Plan 强制 missingMatchIds=[]
↓
不调用 Match API
↓
Aggregate 空数据
```

关键结论：PUBG API 的 Match endpoint 需要 Match ID。当前 Workflow 没有“按日期直接查询比赛”的 API 路径；如果玩家快照没有给出 Match ID，单凭“缓存没有目标日期”不能推导出可执行的 Match API 请求。

## 11. Root Cause of “Cache Miss but No API Query”

### 11.1 第一条路径：LLM 在进入 n8n 之前跳过 Tool

这是当前最容易被误认为“缓存没有命中”的路径，但严格来说它**没有进入 n8n**：

```text
用户提出 PUBG 问题
↓
LangBot local-agent 初始 LLM
↓
LLM 没有返回 tool_calls
↓
local-agent 将普通 assistant 文本直接作为回答
↓
不执行 get_pubg_daily_stats
↓
不进入 PUBG Plugin
↓
不调用 n8n Webhook
↓
不读取 pubg_cache
↓
不调用 Players API / Match API
```

直接原因已经在运行时代码中确认：Tool schema 和 Prompt 只是提供给模型的调用指引；`local-agent` 的执行逻辑只有在初始消息包含 `tool_calls` 时才进入 Tool loop。没有 `tool_calls` 时没有独立的 PUBG 路由器、强制 Tool gate 或数据源校验器来拦截普通文本。

因此，模型可能把以下内容作为回答依据：

- 当前用户消息。
- LangBot Conversation 中的历史 assistant 文本。
- 历史 `role=tool` 文本。
- 通用 System Prompt 对“没有数据”的措辞约束。

这条路径可以解释“模型根据聊天上下文回答不知道/没有数据”，但仅凭 n8n 的执行记录无法证明某一次具体用户请求是否走了这条路径；某次请求的实际 Tool 选择需要对应的 LangBot LLM/tool trace。

### 11.2 第二条路径：Tool 已调用，但没有新的 Match ID

这是 n8n 内部真实存在的路径。当前 n8n 并不判断“这道问题的答案是否在缓存中”，而是判断“玩家快照中的 Match ID 是否有本地没有的 ID”：

```text
Tool Call
↓
PUBG Plugin → n8n Webhook
↓
Read PUBG Cache
  读取 pubg_cache 全部 rows
↓
Prepare Cache
  得到 cachedMatchRecords、player cache 状态、context 状态
↓
Use Cached Players 或 Parse Player Lookup
  得到 playerSnapshots.matchIds
↓
Build Match Fetch Plan
  missingMatchIds = matchIds - cachedMatchIds
↓
没有 missingMatchIds
↓
输出 matchId=null 的计划 item
↓
Has New Match IDs：matchId == null
↓
跳过 Get PUBG Match
↓
Aggregate Today's Stats 只聚合已有 Match cache
↓
Respond to LangBot
```

`Has New Match IDs` 的判断字段是 `matchId`，不是以下任何一种条件：

- 当前自然语言问题是否是一个新问题。
- 目标日期是否存在答案缓存。
- 当前 period 是否有完整数据。
- 当前统计所需的字段是否存在。

所以会出现下面这种具体情况：

```text
目标日期的 Match 摘要不存在
且玩家 snapshot 也没有目标日期对应的 Match ID
↓
missingMatchIds=[]
↓
不请求 Match API
↓
Aggregate 得到空结果或“暂未找到已收录比赛”
```

这不是“发现缓存 miss 后回源失败”，而是当前 Workflow 没有拿到可用于 Match endpoint 的 Match ID，因此直接把流程判定为没有待请求比赛。

### 11.3 第三条路径：Players API 失败且没有 stale player cache

代码对玩家发现失败采用了 fail-soft 行为：

```text
Needs Player Lookup=true
↓
Lookup PUBG Players
  HTTP 错误 / 超时 / 非成功响应
↓
Parse Player Lookup
  没有 stale player cache
↓
playerSnapshots=[]
lookupError=...
↓
Build Match Fetch Plan
  lookupError && !usedStaleCache → missingMatchIds=[]
↓
Has New Match IDs=false
↓
不调用 Match API
↓
Aggregate 继续输出空数据或带错误提示的 response
```

这里 Match API 不执行不是因为 Match cache 命中，而是因为 Player API 失败后没有任何 Match ID 可以安全地请求。当前 Workflow 没有在这一分支中使用历史 Match ID 目录，也没有按日期反查 Match ID 的替代路径。

### 11.4 为什么“缓存没有目标日期”不能自动触发 PUBG Match API

当前使用的 PUBG API 分成两步：

1. Players API：返回玩家关联的 Match ID 列表。
2. Match API：必须拿到某个具体 Match ID 后，才能查询该比赛详情。

当前没有发现以下能力：

- 按玩家和日期直接返回比赛的 PUBG endpoint。
- 按自然语言 period 直接请求比赛的 API 参数。
- 可由 n8n 使用的独立 Match ID 索引或历史目录。
- 根据缓存缺口自动推导 Match ID 的其他数据源。

因此，当前数据层的可执行条件实际是：

```text
已知 Match ID
&& Match ID 不在本地 match cache
→ 可以调用 Match API
```

而不是：

```text
目标 period 没有缓存答案
→ 一定可以调用 Match API
```

目标 Match ID 为什么没有出现在当前玩家 snapshot 中，单凭只读缓存和 Workflow 代码不能进一步确认。可能原因包括 snapshot 时效、上游返回范围、账号数据状态或其他 API 行为；这些属于 `UNKNOWN`，需要对应时刻的 Players API 原始响应和执行 trace 才能区分。

### 11.5 为什么最终表现为“模型不知道/没有数据”

当前有多个因素叠加：

1. **Tool 不是运行时强制调用**：LLM 可以在 n8n 之前直接回答。
2. **n8n 的空结果仍然是正常 Webhook 响应**：Aggregate 不一定抛出异常，而是生成空统计或提示文本。
3. **Plugin 只返回 `response` 字段**：`summaries`、`matchCount`、`cacheStatus`、`newMatchesFetched`、`lookupError` 等结构化诊断字段不会进入下一轮 LLM。
4. **Context 不保存完整 Match ID 列表**：后续模型即使看到上一次回答，也没有可靠的比赛证据引用。
5. **最终 LLM 仍参与输出**：即使 System Prompt 要求原样输出 Tool response，最终是否调用 Tool以及如何处理无数据，仍不是一个独立的权威数据门禁。

因此当前用户看到的“不知道/没有数据”可能来自不同层次：

| 用户可见结果 | 实际可能路径 | 是否进入 n8n | 是否调用 PUBG API |
|---|---|---:|---:|
| 模型直接说不知道 | 初始 LLM 跳过 Tool | 否 | 否 |
| 暂未找到已收录比赛 | Tool 调用，玩家快照无目标 ID | 是 | 可能调用 Players API；不调用 Match API |
| 查询失败/暂时无法获取 | Plugin 或 n8n HTTP/JSON 异常 | 可能 | 可能 |
| 有结果但不完整 | stale player cache 或部分 Match API 失败 | 是 | 可能 |

当前响应文本没有把这些状态统一编码成一个可供上层判断的 `data_status`。这使“无数据”“缓存缺失”“API 失败”“LLM 未查”在体验层容易混为一谈。

### 11.6 根因结论

最核心的真实根因不是单一 Cache Node，而是**查询决策分散在两个没有强制契约的层次**：

```text
第一层：LLM 是否调用 Tool
第二层：n8n 是否拥有新的 Match ID
```

第一层决定是否进入数据层，第二层决定是否进入 Match API。两层之间没有统一的“用户问题 → 可执行查询计划 → 数据完整性状态”协议，所以“没有 Tool Call”“没有答案缓存”“没有 Match ID”“Players API 失败”最终都可能表现成类似的自然语言空结果。

## 12. Current Limitations

以下均基于当前读取到的真实配置、代码、Workflow 和缓存结构；没有把尚未验证的推测写成事实。

### 12.1 查询入口和身份

- 自然语言入口依赖 LLM 自主决定是否调用 Tool，不是确定性 PUBG 路由。
- `/pubg` 旁路只能固定查询“今日战绩”，不能承载任意自然语言时间和统计需求。
- 当前请求使用四个硬编码 PUBG Steam account ID。
- 没有发现 KOOK 用户、KOOK 发送者与 PUBG account ID 之间的动态绑定流程。
- 群聊 Session 以 launcher/group 为主键，同一群内不同发送者可能共享 Conversation；这会增加上下文和数据归属混淆风险。

### 12.2 时间和 Query Schema

- 时间解析主要依赖 n8n `Normalize Request` 中的 JavaScript 正则，不由一个独立时间解析服务负责。
- `上周六` 会落入“上周”规则，不能精确到星期六。
- `昨晚` 没有专用时间段规则，通常回退到今日；`昨天晚上` 会覆盖整个昨天业务日。
- `晚上 10 点以后` 的小时、分钟和“以后”没有进入最终 `startMs`/`endMs`。
- `最近 20 场/把` 没有比赛数量窗口，通常无法表达为最近 N 个 Match。
- 本月、上上周、中文数字日期等表达没有正式规则。
- Query Schema 只能稳定表达一个 period；不能表达 `periodA` 与 `periodB` 的比较。
- `group_by=match` 虽出现在 Tool schema 中，但当前 n8n 聚合没有实现单局级别的排名输出。

### 12.3 数据发现、缓存和 API

- Cache key 不是 `player + date` 或 `normalized query`；当前没有问题答案缓存。
- Player cache 的 60 秒 fresh 语义只表示玩家 Match ID 快照新旧，不表示目标时间范围的数据完整。
- Match cache 的 14 天应用层 TTL 只作用于代码判断；Data Table 没有原生 TTL 自动清理。
- `Read PUBG Cache` 每次读取 Data Table 全部 rows，再由 Code Node 分组筛选；没有观察到按 key/period 的精确读取。
- Match API 只能按已知 Match ID 调用；玩家 snapshot 没有目标 ID 时，没有按日期回源的替代路径。
- Players API 失败且无 stale cache 时，代码会主动生成空 Match fetch plan，导致 Match API 不执行。
- Match cache 只保留预定义的结构化摘要，不保留完整原始 API response。
- 当前明确使用的是 Players API 和 Match API；没有使用 Season Stats、Lifetime Stats 或 Telemetry。

### 12.4 统计能力和回答准确性

- 当前汇总主要是玩家维度：场次、击杀、伤害、排名、KD 等。
- `哪一把伤害最高`、`哪一把杀人最多` 等 Match-level 问题不能由当前聚合正确完成。
- 当前 `deaths` 是由排名推导的业务字段，不是直接的 PUBG Participant death 字段；其语义需要谨慎解释。
- weapon、telemetry、队友关系等数据没有被提取和缓存。
- 多日趋势、最近 N 把、跨 period 比较没有对应的稳定数据模型。
- “无比赛”“缓存不完整”“API 失败”“使用 stale cache”没有统一的机器可读状态向上游暴露。

### 12.5 Conversation 和 LLM

- LangBot Conversation 主要保存自然语言消息和排版后的 Tool response，不保存完整的 n8n 结构化统计结果。
- n8n context cache 保存上一次摘要和 period，但不保存完整 Match ID 列表及逐局数据。
- 历史 assistant/tool 文本可能被 LLM 当作当前回答的上下文；没有代码级事实来源门禁。
- Tool Prompt 要求调用 Tool 和原样输出，但不是运行时不可绕过的策略。
- 9Router 后实际外部模型身份未从当前本地配置确认，记为 `UNKNOWN`。

### 12.6 仍无法仅凭只读材料确认的事项

- 某一次用户消息究竟是否被初始 LLM 调用了 Tool：`UNKNOWN`；需要该轮 LangBot 原始 LLM/tool trace。
- 某个历史日期的 Match ID 为什么不在 Players API snapshot：`UNKNOWN`；需要该时刻的 Players API 原始响应、请求参数和时间戳。
- 9Router 最终转发到的具体外部模型：`UNKNOWN`；需要 Provider/Router 侧的运行时日志或管理配置。
- n8n SQLite 的宿主机挂载路径：`UNKNOWN`；已确认容器内真实数据库和表，但当前报告不把未确认的主机路径写成事实。

## 13. Risk / Priority

### P0

- **无强制数据查询门禁**：PUBG 问题可以在不调用 Tool、不读取缓存、不调用 PUBG API 的情况下直接由 LLM 回答，存在“看似回答、实际无数据依据”的根本正确性风险。
- **数据缺失时可能静默跳过 Match API**：目标日期没有本地 Match 摘要且当前玩家 snapshot 没有对应 Match ID 时，Workflow 会输出空结果，而不是明确区分“无法发现 Match ID”和“没有比赛”。
- **Match-level 问题可能返回错误粒度的答案**：用户问哪一把最高时，当前实现按玩家汇总维度排序，可能把“谁的总伤害/击杀最高”包装成单局答案。
- **固定账号导致身份归属风险**：如果产品预期是“当前 KOOK 用户查询自己的战绩”或群内不同用户分别查询，当前四个硬编码账号和无绑定机制会造成错误归属；若业务明确就是固定四人战队查询，则这是已知产品边界而非实现意外。

### P1

- **自然语言时间语义不可靠**：上周六、昨晚、具体小时、最近 N 把等表达会被扩大、忽略或回退到今日。
- **连续追问缺少结构化引用**：`昨天怎么样？` 后问 `哪一把？` 时，没有可靠的 period、Match ID 和上一结果集合引用。
- **比较语义不完整**：`跟前天比呢？` 只能得到一个前天 period，不能稳定生成昨天 vs 前天的双窗口比较。
- **缓存状态与数据状态混淆**：上层只看到 `response` 字符串，难以区分 fresh、stale、空结果、API 失败和未调用 Tool。
- **群聊上下文共享**：同一群的 Session 可能包含不同发送者的历史，追问时存在引用错位和账号归属风险。

### P2

- **Workflow 职责过于集中**：一个 20 节点 Workflow 同时处理请求规范化、时间解析、缓存读取、玩家发现、比赛回源、数据抽取、聚合、格式化和上下文写入。
- **缓存读取粒度粗**：每次读取全部 Data Table rows，再在 Code Node 中解析，随 Match cache 增长会增加执行和解析成本。
- **TTL 是应用层约定**：Data Table rows 不会自动过期，清理和有效性完全依赖 Workflow 代码。
- **代码和 Tool schema 存在能力错位**：Tool 声明了 `compare`、`trend`、`group_by=match` 等能力，但 n8n 内部并未完整实现相应语义。
- **本地导出与 live version 不一致**：`pubg-daily-stats.workflow.json` 的 version ID 与当前 n8n active version 不同，离线阅读容易误判运行行为。
- **可观测性不足**：Plugin 丢弃了 n8n 诊断字段；没有在当前链路中确认统一的 query、cache、API、LLM 决策 trace。

### P3

- **数据覆盖有限**：没有 weapon、telemetry、Season Stats、Lifetime Stats 等能力。
- **原始数据不可恢复**：Match cache 只存摘要，后续新增指标可能需要重新获取或重新设计存储。
- **统计语义仍可标准化**：deaths、KD、排名、竞技模式和 bot 过滤需要统一数据字典和测试样例。
- **缺乏面向自然语言的回归矩阵**：当前未发现覆盖相对日期、绝对日期、时间段、最近 N 把、比较、单局排名和追问的系统化验证集。

## 14. Relevant Files / Workflow IDs / Nodes

### 14.1 n8n Workflow

```text
名称：PUBG 今日战绩
Workflow ID：pubg-daily-stats-20260830
Active：true
Active version：9f200dd9-a4aa-4c05-ac22-c35e82fe8622
Trigger：POST /webhook/pubg-daily-stats
节点数：20
```

当前 Workflow 节点资源：

1. `PUBG Stats Webhook` — `b8ae4fb1-4d7b-4de0-9d72-5dd0129de001`
2. `Normalize Request` — `b8ae4fb1-4d7b-4de0-9d72-5dd0129de003`
3. `Read PUBG Cache` — `b8ae4fb1-4d7b-4de0-9d72-5dd0129de013`
4. `Prepare Cache` — `b8ae4fb1-4d7b-4de0-9d72-5dd0129de014`
5. `Needs Player Lookup` — `b8ae4fb1-4d7b-4de0-9d72-5dd0129de015`
6. `Lookup PUBG Players` — `b8ae4fb1-4d7b-4de0-9d72-5dd0129de004`
7. `Parse Player Lookup` — `b8ae4fb1-4d7b-4de0-9d72-5dd0129de005`
8. `Use Cached Players` — `b8ae4fb1-4d7b-4de0-9d72-5dd0129de016`
9. `Build Match Fetch Plan` — `b8ae4fb1-4d7b-4de0-9d72-5dd0129de017`
10. `Has New Match IDs` — `b8ae4fb1-4d7b-4de0-9d72-5dd0129de007`
11. `Get PUBG Match` — `b8ae4fb1-4d7b-4de0-9d72-5dd0129de008`
12. `Extract Match Records` — `b8ae4fb1-4d7b-4de0-9d72-5dd0129de009`
13. `Aggregate Today's Stats` — `b8ae4fb1-4d7b-4de0-9d72-5dd0129de010`
14. `Respond to LangBot` — `b8ae4fb1-4d7b-4de0-9d72-5dd0129de012`
15. `Prepare Player Cache Row` — `b8ae4fb1-4d7b-4de0-9d72-5dd0129de018`
16. `Upsert PUBG Player Cache` — `b8ae4fb1-4d7b-4de0-9d72-5dd0129de019`
17. `Prepare Match Cache Row` — `b8ae4fb1-4d7b-4de0-9d72-5dd0129de020`
18. `Upsert PUBG Match Cache` — `b8ae4fb1-4d7b-4de0-9d72-5dd0129de021`
19. `Prepare PUBG Context Row` — `b8ae4fb1-4d7b-4de0-9d72-5dd0129de022`
20. `Upsert PUBG Context` — `b8ae4fb1-4d7b-4de0-9d72-5dd0129de023`

未发现与该 Workflow 关联的 PUBG Sub-workflow、`Execute Workflow`、n8n AI Agent 或 n8n LLM 节点。

本地导出文件：

- `pubg-daily-stats.workflow.json`：已读取，但其 version ID 为 `b8ae4fb1-4d7b-4de0-9d72-5dd0129de013`，不是当前 active version 的依据。

### 14.2 LangBot / PUBG Plugin

Bot 和 Pipeline：

```text
Bot：KOOK
Bot UUID：2f25e57b-6157-458d-99e4-db411ddc85d4
Pipeline：KOOK Pipeline
Pipeline UUID：2cc265c7-0dd1-4221-b594-0a6b38d7c1d5
Runner：local-agent
Model：arthur-combo
Model UUID：4d608fdb-126b-42cd-a8a5-be1349629713
```

实际相关文件：

- `pubg-langbot-plugin/components/tools/pubg_stats.yaml`：`get_pubg_daily_stats` Tool 名称、描述、参数 schema 和调用约束。
- `pubg-langbot-plugin/components/tools/pubg_stats.py`：Tool 执行入口、n8n POST、异常处理、只提取返回 JSON 的 `response`。
- `pubg-langbot-plugin/components/pubg_client.py`：PUBG Plugin 到 n8n 的客户端/请求封装。
- `pubg-langbot-plugin/components/commands/pubg.py`：`/pubg` 固定 Command，固定发起“今日战绩”查询。
- `pubg-langbot-plugin/components/commands/pubg.yaml`：固定 Command 的声明配置。
- `pubg-langbot-plugin/manifest.yaml`：Plugin 元数据和组件注册。
- `pubg-stats.lbpkg`：Plugin 打包产物，属于部署/分发相关资源。

仅作为凭据结构参考读取的文件：

- `pubg-api-credential.placeholder.json`：占位凭据格式；不把其中内容视为运行时真实密钥。

### 14.3 Cache / Runtime 数据

```text
Data Table：pubg_cache
Data Table ID：5ZFCBuokb-pn1ey9
物理表：data_table_user_5ZFCBuokb-pn1ey9
观察行数：154
```

已确认的 n8n 容器内持久化数据库为 `database.sqlite`；宿主机挂载路径未在当前只读材料中进一步确认，记为 `UNKNOWN`。

LangBot 持久化数据库：

- `/DATA/AppData/langbot/data/langbot.db`：LangBot 配置、监控和插件相关持久化；不是当前 PUBG Match cache 的主要存储。

缓存类型和 key：

- `playerLookup`：`player-lookup:<sorted account IDs>`，TTL 60 秒。
- `match`：`match:steam:<matchId>`，TTL 14 天。
- `context`：`pubg-context:<launcher type>:<launcher id>`，TTL 12 小时。

### 14.4 仍需运行时材料才能确认的资源

- 某一条用户请求的完整 LangBot 初始 LLM response、Tool Call 和第二轮 response：`UNKNOWN`，需要 LangBot trace/监控详情。
- 9Router 的最终模型路由结果：`UNKNOWN`，需要 Provider/Router 侧日志或管理配置。
- n8n SQLite 的宿主机绝对路径：`UNKNOWN`，需要查看 CasaOS/n8n 容器挂载配置；本报告没有为了确认而修改配置。

## 15. Suggested Refactor Direction

本节只给高层方向，不修改代码、Workflow、Prompt、数据库、缓存或配置。

### 15.1 建立统一查询协议

建议把自然语言先转换成明确的 Query Schema，再进入数据层。至少应能表达：

```text
intent
player scope
time range / period list
relative time resolution
last N matches
metrics
group_by
ranking target
comparison
follow-up reference
```

尤其要区分：

- 一个 period 与两个 period 的比较。
- 玩家汇总排名与 Match 汇总排名。
- 日期范围与时间点范围。
- “没有数据”“尚未查询”“查询失败”“数据不完整”。

### 15.2 将“是否查数据”从 LLM 自由选择改为可验证门禁

高层目标应是：

```text
KOOK message
→ 确定性入口/意图识别
→ LLM Planner 输出结构化 Query
→ Query 校验
→ 数据层执行
```

LLM 可以负责自然语言理解和查询计划，但不应在没有数据来源结果时直接生成 PUBG 事实回答。最终回答层应接收带状态和证据引用的数据结果，而不是只接收一段无法区分来源的文本。

### 15.3 设计真正的 read-through data layer

建议将缓存语义拆成可观察状态：

```text
FRESH HIT
STALE HIT
MISS → 回源
SOURCE UNAVAILABLE
PARTIAL
EMPTY RESULT
```

玩家发现、Match ID 目录和 Match 详情应分别建模。对于 Match API 必须依赖 Match ID 的事实，应明确记录“ID 未发现”与“ID 已发现但详情未缓存/获取失败”是两类不同状态。

### 15.4 保留可追溯的原始和规范化数据

建议分层保存：

```text
PUBG raw response
→ normalized match record
→ query-specific aggregate
→ rendered answer
```

这样可以在不重新依赖 LLM 的情况下支持新的统计字段、Match-level ranking、最近 N 把和趋势分析，并可追溯每个答案使用了哪些 Match ID。

### 15.5 把连续追问建模为结构化引用

Context 不应只保存上一段排版文本。高层上应保存：

- 上次解析后的 Query Schema。
- 实际使用的时间范围。
- 结果中的 Match ID 集合或结果集引用。
- 数据来源状态和更新时间。
- 当前用户/群组与 PUBG 账号的绑定范围。

这样“昨天怎么样”之后的“哪一把伤害最高”才能引用同一结果集，而不是让模型从自然语言历史回答中猜测。

### 15.6 拆分 n8n Workflow 职责

目标方向可以是：

```text
LLM Planner
→ normalized query
→ identity resolver
→ cache/data layer
→ player discovery
→ match fetch
→ analysis/statistics
→ answer renderer
→ context/evidence store
```

拆分不等于必须增加 n8n Sub-workflow；重点是让每层输入输出和失败状态明确，避免一个 Workflow 同时承担解析、回源、统计、格式化和会话写入。

### 15.7 先建立只读回归验证矩阵

在任何实现变更前，应针对以下类型建立可重复的输入/输出检查：

- 今天、昨天、前天、上周六、具体日期、具体小时。
- 最近 N 场和指定时间范围。
- 单局最高伤害/击杀与玩家汇总排名。
- 两个 period 的比较。
- 连续追问和群聊多用户上下文。
- Cache fresh、cache miss、stale、Players API 失败、Match API 失败。
- LLM 未发 Tool Call 时是否被数据门禁拦截。

本阶段不执行这些改造；它们只是后续确认后的高层方向。

> 本阶段审计结论：当前系统的真实行为已经还原到入口、Tool、n8n 分支、缓存、PUBG API、LLM 和 Conversation 层；未对任何运行资源做修改，等待下一阶段确认。
