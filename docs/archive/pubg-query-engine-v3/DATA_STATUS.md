# PUBG Query Engine V3 — Data Status and Coverage

## 1. Status Enum

| Status | 允许的事实语义 |
| --- | --- |
| `OK` | 需要的 selector 已有足够完整覆盖，结果可计算 |
| `NO_MATCHES` | coverage 已确认完整，但 selector 内确实没有 Match |
| `PARTIAL` | 部分 Match/字段可用，结果可能不完整 |
| `COVERAGE_GAP` | 本地数据不足以判断 selector 是否完整或是否没有 Match |
| `SOURCE_UNAVAILABLE` | 需要外部数据，PUBG/n8n 数据源不可用且本地不足 |
| `INVALID_QUERY` | Query 未通过 schema 或 ResultSet 引用无效 |
| `UNKNOWN_PLAYER` | subject 指向未配置玩家 |
| `UNSUPPORTED_CAPABILITY` | 当前能力注册表不支持，例如 weapon/telemetry |
| `STALE` | 数据源失败，但本地已足够覆盖请求，返回旧数据并显式标 stale |

## 2. Coverage Object

```json
{
  "status": "OK",
  "complete": true,
  "localComplete": true,
  "queryCovered": true,
  "coverageStart": "2026-08-01T00:00:00.000Z",
  "coverageEnd": "2026-09-02T00:00:00.000Z",
  "checkedAt": "2026-09-02T00:00:00.000Z",
  "failedMatchIds": [],
  "sourceUnavailable": false,
  "freshness": "fresh"
}
```

字段含义：

- `complete`：Store/Sync State 对目标范围是否完整。
- `localComplete`：不回源时本地是否完整。
- `queryCovered`：本次 selector 是否被实际 records 覆盖。
- `failedMatchIds`：Match API 部分失败的具体 ID。
- `freshness`：`fresh`、`stale` 或 `unknown`。

## 3. Read-through Decision

```text
Query
  ↓
Check selector coverage + freshness
  ├─ historical + complete → local query, no unnecessary API
  ├─ today/current/rolling and stale → invoke Sync
  ├─ missing history but discovery can improve → Sync → fetch → query
  └─ source unavailable
       ├─ local queryCovered=true → STALE
       └─ local queryCovered=false → SOURCE_UNAVAILABLE/COVERAGE_GAP
```

`last_n_matches` 需要足够数量的 team-participated Match；如果本地数量不足，不能把当前已有少量 Match 当成完整的“最近 N 场”。

## 4. Failure Semantics

### Players API

- 失败 + local data 足够：继续查询，`STALE` 或按现有覆盖返回。
- 失败 + local data 不足：`SOURCE_UNAVAILABLE` 或 `COVERAGE_GAP`。
- 不得渲染为 `NO_MATCHES`。

### Match API

- 全部成功：按 coverage 返回 `OK`。
- 部分失败：保留成功 Match，`PARTIAL`，并记录 `failedMatchIds`。
- 全部失败且无本地覆盖：`SOURCE_UNAVAILABLE`。

## 5. Result Contract

每次 Query 返回：

```json
{
  "status": "OK",
  "data": {},
  "coverage": {},
  "source": {
    "store": "n8n",
    "syncInvoked": false,
    "playerApiCalls": 0,
    "matchApiCalls": 0,
    "localMatchCount": 6
  },
  "evidence": {
    "matchIds": [],
    "playerIds": [],
    "fields": [],
    "calculation": "deterministic_query_engine_v3"
  }
}
```

Renderer 只能依据 `status`、`coverage`、`source` 和 `data` 生成消息。

## 6. Prohibited Collapses

- Cache miss ≠ no data。
- API failure ≠ no matches。
- Unknown coverage ≠ zero matches。
- Partial records ≠ complete report。
- Conversation history ≠ PUBG fact source。
- Unsupported metric ≠ 可由 LLM 猜测的字段。
