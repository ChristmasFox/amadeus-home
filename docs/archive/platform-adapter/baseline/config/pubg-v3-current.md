# PUBG Query Engine V3 — Current Baseline

更新时间：2026-09-02（Asia/Shanghai）

## 当前结论

当前线上链路已经切换到 Mastra + TypeScript Runtime v3；n8n 继续负责 PUBG API、同步、重试和 Data Table 编排。V2 Workflow、V2 Plugin、`pubg_cache` 和历史 Match 数据仍保留，作为回滚与数据兼容边界。

## Live Runtime

| 资源 | 当前值 |
| --- | --- |
| Runtime | `pubg-query-engine-v3` |
| Runtime image | `local/pubg-query-engine-v3:3.0.3` |
| Health | `healthy` |
| HTTP | `5310` |
| Runtime state | `/DATA/AppData/pubg-query-engine-v3/data/state.json` |
| Runtime state 内容 | 结构化 Context 与 ResultSet；不保存 LLM 最终回答作为事实源 |
| Mastra official storage | 未配置；Mastra workflow 使用自定义 JSON Store 持久化事实引用 |

## Live n8n

| Workflow | ID | Active | Published version | Trigger |
| --- | --- | --- | --- |
| `PUBG Data Gateway v3` | `pubg-data-gateway-v3-20260902` | `true` | `caa0a304-63ef-4152-bd49-16cbf6392e3f` | POST Webhook `pubg-data-gateway-v3` |
| `PUBG Sync Matches v3` | `pubg-sync-matches-v3-20260902` | `true` | `467e7a17-282d-44fc-874c-8604b7159adb` | POST Webhook `pubg-sync-matches-v3` |

V2 保留资源：

- `PUBG Query Gateway v2`
- `PUBG Sync Matches v2`
- `PUBG 今日战绩`

## Data Table

| 项目 | 当前值 |
| --- | --- |
| Name | `pubg_cache` |
| Data Table ID | `5ZFCBuokb-pn1ey9` |
| 物理用途 | V2/V3 共用的 Match Store、Discovery/Sync State 与历史兼容数据 |
| 主要 `cacheType` | `playerLookup`、`match`、`context`、`meta` |
| Schema | `cacheKey`、`cacheType`、`payload`、`refreshedAt`、`expiresAt` |
| 当前快照行数 | 运行时返回 142 条 Match 记录（最终线上查询） |
| 基线 Match 行 | 135（基线快照） |

V3 通过 n8n Data Gateway 访问此表；没有删除或清空旧表。Match payload 使用 V3 normalized schema 写回 V2 表，以便保持现有数据资产与 V2 回滚能力。

## Default Team

配置文件：`pubg-query-engine-v3/teams/default-team.json`

默认没有显式玩家选择器的 PUBG 查询使用 `default_team`，当前为：

- `SG_LabmemNo007`
- `SG_LabmemNo008`
- `SG_LabmemNo004`
- `kim_kkl`

默认 `report` 返回全部有配置的四名玩家；有活动玩家按 KD 降序排列，没有活动的玩家保留为 `NO_ACTIVITY`，不会被伪装成零表现。

## LangBot / Plugin

当前 LangBot 镜像：`langbot-local:4.10.8-kook-fix-ssh10`。

当前安装的插件为 `local/pubg-stats` v3，包含：

- `get_pubg_stats_v3` Tool
- `/pubg` Command
- Group/Person EventListener 形式的强制 PUBG Query Gateway

插件只显示 Runtime 返回的 `response`，同时在插件内部保留完整结构化结果（`status`、`resultSetId`、`data`、`coverage`、`source`、`trace`）。

## KOOK 状态

LangBot 已使用 `langbot-local:4.10.8-kook-fix-ssh10` 重启。补丁将 KOOK WebSocket 的有限 3 次重试改为持续重连，并将两处指数退避限制为最多 30 秒，同时增加断线清理。插件运行时在 2026-09-02 19:07（Asia/Shanghai）明确加载 `local/pubg-stats`，其 v3 artifact 包含 `get_pubg_stats_v3`、`/pubg` Command 和强制 EventListener。

2026-09-02 的只读/线上探测确认：

- `user/me`：HTTP 200、KOOK code 0
- `gateway/index`：HTTP 200、KOOK code 0
- WebSocket：成功收到压缩 HELLO
- `langbot` 容器存在到外部 TLS 443 的活动 TCP 连接
- 真实用户入站消息尚未获得，不能以 Bot 自发消息代替真人入站烟测

## Snapshots

重要 baseline/export 位于：

- `docs/pubg-query-engine-v3/baseline/live-n8n-current/`
- `docs/pubg-query-engine-v3/baseline/config/`
- `docs/pubg-query-engine-v3/baseline/plugin-source/`
- `docs/pubg-query-engine-v3/baseline/matches.json`

以上快照均不应包含 API Key、KOOK Token 或其他 credential。
