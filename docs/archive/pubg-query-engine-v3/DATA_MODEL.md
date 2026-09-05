# PUBG Query Engine V3 — Data Model

V3.2 adds a separate Telemetry Feature Store and `MatchReviewFacts`; it does not alter the existing Match Store schema. See `V3.2_DATA_MODEL.md` for the full review data model and compact persistence rule.

## 1. Storage Boundary

第一阶段继续使用现有 n8n Data Table：

- Name：`pubg_cache`
- ID：`5ZFCBuokb-pn1ey9`
- 访问入口：n8n `Data Gateway v3` / `Sync Matches v3`
- V3 Runtime 不直接访问 n8n `database.sqlite`

当前表同时承载旧 V2 数据和 V3 normalized payload，采用 side-by-side 迁移，不删除旧 Match 数据。

## 2. Data Table Columns

| Column | 语义 |
| --- | --- |
| `cacheKey` | 记录主键/逻辑键，Match、Sync State、Discovery 等使用不同前缀 |
| `cacheType` | `match`、`playerLookup`、`context`、`meta` 等类型 |
| `payload` | JSON 字符串，V3 Match Store 使用 normalized record |
| `refreshedAt` | 最近成功写入时间 |
| `expiresAt` | 兼容旧 TTL/过期字段；历史 Match 的事实生命周期不再等同于查询回答 TTL |

## 3. Normalized Match

```ts
interface NormalizedMatch {
  schemaVersion: number;
  matchId: string;
  shard: string;
  createdAt: string | null;
  timestamp: number;
  matchType: string;
  gameMode: string;
  isCompetitive: boolean;
  mapName: string;
  duration: number;
  patchVersion: string;
  players: NormalizedPlayer[];
}
```

The V3.2 Worker uses the normalized Match as its base summary, then stores versioned derived review facts in `/DATA/AppData/pubg-query-engine-v3/data/features.json`. Ordinary QuerySubgraph requests do not read or populate that store.

## 4. Normalized Player

```ts
interface NormalizedPlayer {
  accountId: string;
  playerName: string;
  displayName: string;
  rank: number | null;
  kills: number;
  assists: number;
  damage: number;
  dbnos: number;
  revives: number;
  headshotKills: number;
  survivalTime: number;
  longestKill: number;
  deaths: number | null;
  deathSemantics: 'explicit' | 'placement_proxy' | 'unknown';
}
```

`deaths` 当前由 API 可用字段或 rank proxy 归一化；如果是 proxy，Result/Evidence 会保留 `deathSemantics`，不宣称它是 PUBG 官方独立死亡统计。

## 5. Sync State

Sync State 记录 discovery 与同步边界，包括：

- 当前 shard/team 的 Player discovery 状态
- 最近发现的 Match IDs
- 最近成功同步时间
- coverage 起止边界
- failed Match IDs
- source/API 错误状态

V3 Sync 流程：

```text
Players API discovery
    ↓
Match ID set
    ↓ compare local Match Store
missing Match IDs
    ↓
Match API fetch
    ↓
normalize
    ↓
upsert Match rows + Sync State
```

## 6. Context Store

Runtime 状态文件：`/DATA/AppData/pubg-query-engine-v3/data/state.json`。

```ts
interface SessionContextRecord {
  schemaVersion: 3;
  sessionId: string;
  activeDomain: 'pubg' | null;
  lastQuery: CanonicalQuery | null;
  lastSelector: Selector | null;
  lastResultSetId: string | null;
  lastSubject: Subject | null;
  references: Record<string, unknown>;
  updatedAt: string;
  expiresAt: string;
}
```

Session key 包含：

```text
platform : launcherType : launcherId : senderId : domain
```

因此同一 KOOK 群中的不同 sender 不共享 PUBG ResultSet。

## 7. ResultSet

```ts
interface ResultSetRecord {
  id: string;
  queryId: string;
  sessionId: string;
  resolvedQuery: CanonicalQuery;
  resolvedSelector: Selector;
  playerIds: string[];
  matchIds: string[];
  rows: QueryRow[];
  aggregates: Record<string, unknown>;
  rankings: QueryRow[];
  coverage: Coverage;
  status: DataStatus;
  source: SourceInfo;
  createdAt: string;
  expiresAt: string;
}
```

ResultSet 是 follow-up 的事实引用，不是短期回答缓存。默认 ResultSet TTL 为 24 小时；Context TTL 默认 12 小时，可通过环境变量配置。

## 8. Repository/Data Layer

TypeScript Runtime 只依赖 `DataProvider.ensureData()`，不在业务节点中直接 parse 全表。当前 n8n Data Gateway 仍受 Data Table 精确查询能力限制，部分节点需要读取 Match 行后在 Code Node 中做归一化和 selector coverage 计算，这是已记录的技术债；未来可以将 DataProvider 替换为 PostgreSQL Repository，不改变 Query Core/Schema/Renderer。

## 9. Facts vs Presentation

- Match Store：历史数据事实，尽量 immutable。
- Context：查询引用和用户身份，不保存自然语言回答作为事实。
- ResultSet：一次结构化查询的证据快照。
- Renderer output：KOOK 展示字符串，不反向写入事实 Store。
