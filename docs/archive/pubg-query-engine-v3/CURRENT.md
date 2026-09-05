# PUBG Query Engine V3.2 — Current Baseline

更新时间：2026-09-03（Asia/Shanghai）

## 当前结论

V3.2 已在 V3/V3.1 之上以 additive extension 交付。PUBG Domain 继续共用 Identity、Context、Planner、Schema Validator、Selector Resolver 和 ResultSet；Operation Router 只在 `operation=review_match` 时进入 ReviewSubgraph，普通战绩查询仍走原 QuerySubgraph。

Telemetry 只在比赛唯一确定后读取。Raw Telemetry 不进入 LLM Context；Worker 会先完成 parse、normalize、feature extraction，再把结构化 `MatchReviewFacts` 交给 Review Analyzer/Presentation。

## Live Runtime

| 资源 | 当前值 |
| --- | --- |
| Runtime | `pubg-query-engine-v3` |
| Runtime image | `local/pubg-query-engine-v3:3.2.2-accuracy` |
| Health | `healthy` |
| HTTP | `5310` |
| Health response | `review: v3.2` |
| Runtime state | `/DATA/AppData/pubg-query-engine-v3/data/state.json` |
| Feature Store | `/DATA/AppData/pubg-query-engine-v3/data/features.json` |
| Selection Store | `/DATA/AppData/pubg-query-engine-v3/data/selections.json` |
| PUBG API credential | 只读挂载 `/run/secrets/pubg_api_key`，运行时使用 `PUBG_API_KEY_FILE` |
| Parser / feature version | `telemetry-parser-3` / `review-features-3` |

当前 secret 文件权限为 `0600`，compose 不把 API key 放入环境变量；签名 telemetry asset URL 也不会携带 PUBG API credential。

## Data Footprint

线上当前有 6 条版本化 Feature Store 记录，覆盖 3 个真实 Match ID；活动版本是 `telemetry-parser-3` / `review-features-3`。V3.2 持久化的是派生事实、统计和 evidence 引用，不持久化完整 normalized event stream：

- 压缩前：`45,596,728` bytes；备份：`/DATA/AppData/pubg-query-engine-v3/backups/features-before-compaction-20260903.json`
- 当前：`2,499,450` bytes；6 条记录的 `combat.events` 均为空，fights、operations、weapons、vehicles、heavyWeapons、specialEvents 保留

若 Parser/Feature 语义变化，使用 `matchId + parserVersion + featureVersion` 产生新缓存键，不覆盖旧格式。

## Live n8n

| Workflow | ID | Active | Trigger |
| --- | --- | --- | --- |
| `PUBG Data Gateway v3` | `pubg-data-gateway-v3-20260902` | `true` | POST Webhook `pubg-data-gateway-v3` |
| `PUBG Sync Matches v3` | `pubg-sync-matches-v3-20260902` | `true` | POST Webhook `pubg-sync-matches-v3` |

V2 资源仍保留：`PUBG Query Gateway v2`、`PUBG Sync Matches v2`、`PUBG 今日战绩`。

## Default Team

配置文件：`pubg-query-engine-v3/teams/default-team.json`

- `SG_LabmemNo007`
- `SG_LabmemNo008`
- `SG_LabmemNo004`
- `kim_kkl`

没有显式玩家选择器时，QuerySubgraph 和 ReviewSubgraph 都使用同一 `default_team`，不会各自复制身份或队伍解析。

## LangBot / Plugin

当前安装 artifact：`docs/pubg-query-engine-v3/pubg-stats-v3.2.1-accuracy.lbpkg`，manifest 版本 `3.2.1`，插件名 `local/pubg-stats`。LangBot Plugin Runtime 日志已确认 mount/init 成功。

插件提供：

- `get_pubg_stats_v3` Tool
- `/pubg` Command
- KOOK/Telegram 普通消息 EventListener
- Telegram callback ACK、短 token callback 转发和异步 Review resume

## Platform Status

- Telegram Bot API 配置已验证有效，bot 为 `Arthur_amadeus_bot`；Telegram Adapter、Inline Keyboard、callback chat binding 已通过 fixture/live runtime 检查。
- KOOK `user/me`、`gateway/index`、WebSocket HELLO 和持续重连已验证。
- Telegram/KOOK 真实非 Bot 入站及实际客户端显示仍需要外部成员事件；不能用 Bot 自发消息代替。

## Snapshots and Rollback

- V3.1 源码快照：`docs/pubg-query-engine-v3/v3.1-snapshot-20260903`
- Engine 部署备份：`/DATA/AppData/pubg-query-engine-v3/backups/v3.1-before-v3.2-20260903`
- Accuracy patch 部署备份：`/DATA/AppData/pubg-query-engine-v3/backups/accuracy-patch-v3.2.2-before-deploy-20260903`
- Feature compaction backup：`/DATA/AppData/pubg-query-engine-v3/backups/features-before-compaction-20260903.json`
- LangBot 部署备份：`/DATA/AppData/langbot/backups/pubg-v3.2-before-20260903`

回滚只恢复镜像/插件引用，不删除 `pubg_cache`、Match Store、Context、ResultSet 或 Feature Store 备份。详见 `V3.2_ROLLBACK.md`。
