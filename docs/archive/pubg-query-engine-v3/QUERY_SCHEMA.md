# PUBG Query Engine V3 — Canonical Query Schema

V3.2 keeps schema version `3` and adds `operation=review_match` plus `matchSelector`. See `V3.2_SCHEMA.md` for selector resolution, callback tokens and review profiles; all existing V3 operations retain the semantics below.

## Version

- Schema version：`3`
- Zod runtime schema：`pubg-query-engine-v3/src/schema/query.ts`
- JSON Schema：`pubg-query-engine-v3/pubg-query.schema.json`
- 所有进入 Query Engine 的 Query 必须先通过 `CanonicalQuerySchema`。

## Canonical Shape

```json
{
  "version": 3,
  "queryId": "q_xxx",
  "domain": "pubg",
  "subject": {
    "type": "team",
    "ids": ["default_team"],
    "label": "四人组"
  },
  "operation": "report",
  "selector": {
    "type": "relative_period",
    "value": "yesterday",
    "label": "昨天"
  },
  "segments": [],
  "groupBy": "player",
  "metrics": ["matches", "kills", "damage", "kd"],
  "filters": {"competitiveOnly": true},
  "orderBy": {"metric": "kd", "direction": "desc"},
  "limit": null,
  "reference": {
    "selectorExplicit": true,
    "subjectExplicit": false,
    "useResultSet": false,
    "inheritedFromContext": false,
    "planner": "deterministic_fallback"
  },
  "presentation": {"compact": false}
}
```

## Subject

支持：

- `team`：通常为 `default_team`；Runtime 在进入 n8n 前展开成真实 account IDs。
- `player`：单个配置玩家。
- `players`：多个配置玩家。

未知玩家返回 `UNKNOWN_PLAYER`，不会把名字交给 PUBG API 后再猜。

## Operations

| Operation | 确定性语义 |
| --- | --- |
| `report` | 按默认展示规则汇总；team/player report 默认按 KD 降序 |
| `detail` | 输出指定 subject 或 Match 的详细数据 |
| `rank` | 按 `orderBy.metric` 排名，例如 KD、kills、damage、assists |
| `strongest` | 按 Performance Score 降序，仅对有活动玩家排名 |
| `weakest` | 按 Chicken Index 降序，仅对有活动玩家排名 |
| `compare` | 比较 `segments` 中两个或多个 selector；不是在一个 period 内比较玩家 |
| `trend` | 按 day 分组生成 daily series 与确定性 change |
| `list` | 输出 Match-level 列表 |
| `review_match` | 唯一 Match 后进入 ReviewSubgraph；多局先 Picker，不自动选择 |

## Selectors

| Type | 用途 |
| --- | --- |
| `time_range` | 已解析的 absolute `start`/`end` |
| `relative_period` | Planner 中间表示，例如 `today`、`yesterday`、`last_week`、具体日期文本 |
| `recent_days` | 最近 N 个业务日 |
| `last_n_matches` | 最近 N 场，不属于时间解析 |
| `result_set` | 引用上一查询的 `resultSetId` |

Review-only `matchSelector` values are `latest`, `earliest`, `ordinal`, `ordinal_from_end`, `filtered`, `ranked`, `active_match`, `previous` and `next`. Telemetry is deferred until this selector resolves exactly one Match.

时间 selector 最终由 Resolver 转成带时区的 ISO8601 边界；LLM 不负责 Unix timestamp 计算。

## Selector Precedence

1. 当前消息显式提供时间/selector：优先使用。
2. 当前消息没有 selector，但同一 sender 的有效 PUBG Context 存在：继承最近结构化 selector/result set。
3. 两者都没有：默认 `today`，业务日开始 `06:00`，时区 `Asia/Shanghai`，结束为当前 clock。

普通 assistant 文本不参与事实 selector 解析。

## Grouping and Ranking

- `groupBy=player`：每个配置玩家一行。
- `groupBy=match`：每个 Match 一行，包含 `matchId`、时间、地图、模式和参与者指标。
- `groupBy=day`：按业务日聚合。
- `groupBy=team`：按 unique Match 聚合一次，避免四个玩家 matches 相加。

“昨天哪一把伤害最高？”必须生成 `operation=rank`、`groupBy=match`、`orderBy.metric=damage`；“昨天谁伤害最高？”才是 `groupBy=player`。

## Metrics

当前可计算：

`matches`、`kills`、`assists`、`damage`、`avg_damage`、`kd`、`deaths`、`wins`、`top10`、`rank`、`dbnos`、`revives`、`headshot_kills`、`survival_time`、`longest_kill`、`performance_score`、`chicken_index`。

当前明确不支持：

`weapon`、`telemetry`、`season_stats`、`lifetime_stats`。

unsupported capability 返回 `UNSUPPORTED_CAPABILITY`，不进入 API 猜测或 LLM 编答。

## Compare

```json
{
  "operation": "compare",
  "segments": [
    {"label": "昨天", "selector": {"type": "relative_period", "value": "yesterday"}},
    {"label": "前天", "selector": {"type": "relative_period", "value": "day_before_yesterday"}}
  ],
  "selector": {"type": "relative_period", "value": "day_before_yesterday"},
  "groupBy": "player"
}
```

Follow-up “跟前天比呢？”会保留上一结构化查询的语义，并形成两个 period segment。

## ResultSet Follow-up

上一查询保存：`lastQuery`、`lastSelector`、`lastResultSetId`、`lastSubject`。

例如：

```text
昨天战绩怎么样？
→ rs_100

哪一把伤害最高？
→ selector.type=result_set, resultSetId=rs_100,
   operation=rank, groupBy=match, metric=damage
```

ResultSet 只保存结构化 rows、Match IDs、coverage、source 和 query；rendered 文本不是事实源。
