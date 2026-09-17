# OpenClaw PUBG 真实验收记录

更新时间：2026-09-17（Asia/Shanghai）

## 运行环境

- OpenClaw `2026.9.4`，请求 route `nine_router/arthur-combo`；轨迹记录的有效响应模型为 `gpt-5.6-luna`。
- 本次最终镜像：`local/openclaw-pubg:git-02d6d0421015-20260917090121`，自定义镜像 ID 为
  `sha256:7ca712a295b86520a0ba2f75295aa99e0de6e70acf550859917cae203d214ffe`；基础官方镜像固定为
  `ghcr.io/openclaw/openclaw:2026.9.4@sha256:cc596b846506a5f4cfcee111394a2725f375f01cca2ebb492a161fd1b747f101`。
- OpenClaw 进程实际加载的 PUBG 工具恰为：
  `pubg_resolve_players`、`pubg_search_matches`、`pubg_query_stats`、
  `pubg_compare_stats`、`pubg_get_match`、`pubg_get_review_facts`。
- bundled Skill `pubg` 已加载且有有效 description；最终容器日志中 `Skipping invalid skill` 次数为 0。
- Telegram 原生 channel probe：`configured=true`、`running=true`、`connected=true`、`lifecycle=ready`、
  `mode=polling`、`lastError=null`。

原始 OpenClaw JSON、工具轨迹索引和最终汇总均在仓库外 checkpoint：
`/DATA/AppData/openclaw/backups/openclaw-pubg-20260917-091502/`。其中
`acceptance-index.json` 汇总 17 个实际回合，`acceptance-summary.json` 保留工具参数、结果状态和最终可见回答；不把这些业务数据或 secrets 纳入 Git。

## 12 类场景

| 类别 | 实际回合 | 工具证据 | 结果 |
| --- | --- | --- | --- |
| 今日详细战绩 | `01_today_detailed` | `resolve_players → query_stats`；结果 `no_matches` | PASS：明确无比赛，没有把未知覆盖当 0 场 |
| 昨天我的 KD | `02_yesterday_alias_kd` | `resolve_players → query_stats`，显式 `[2026-09-16,2026-09-17)` | PASS：别名 007 正确解析，KD=3.25 |
| 接续“前天呢” | `03_followup_before_yesterday` | 同一 OpenClaw session 直接 `query_stats`，范围为 2026-09-15 | PASS：继承实体且日期正确，KD=2.33 |
| 今天与昨天比较 | `04_today_vs_yesterday` | 单次 `compare_stats`，两个显式自然日 segment | PASS：样本、击杀、场均伤害和零分母限制可复核 |
| 最近一周按日趋势 | `05_week_daily_trend` | 单次 `query_stats`，`groupBy=day`、显式 7 日范围 | PASS：返回按日比赛/击杀/伤害和覆盖状态 |
| 最近两周 22 点前后 | `06_22_clock_compare`、`06_clock_strict` | 首次 11 次查询暴露跨日宽区间歧义；修 Skill 后 29 次严格半开区间查询 | PARTIAL：边界处理已修正；严格回合真实遇到 18 个 `SOURCE_UNAVAILABLE`，拒绝生成不完整的 14×2 最终表，未填 0 |
| 指定地图/模式两人比较 | `07_map_mode_two_players` | `search_matches(mapName=Neon_Main, gameMode=squad) → query_stats(resultSetId)` | PASS：同一结果集比较 007/008，避免跨样本比较 |
| 最近一把复盘 | `08_latest_review` | `search_matches → get_match → get_review_facts` | PASS：真实 Match API + Telemetry facts，含 `FIGHT_ANALYTICS_VALID` 和 evidence refs |
| 列表后“第二把” | `09a_list_matches`、`09b_second_match` | 列表产生 result set；连续追问复用同一 session/result 引用，未重新猜 ID | PASS：返回第二把真实 matchId、地图、模式、名次 |
| 战绩/内存/CL30 边界 | `10a_stats_first`、`10b_unrelated_memory`、`10c_cl30_followup` | 仅首回合调用 PUBG；内存与 CL30 回合均无 PUBG tool call | PASS：不把无关硬件请求误路由到 PUBG，也不假称修改成功 |
| 错误/来源缺失 | `11_missing_match_error`、`13_source_gap` | 不存在 Match 返回 `error/not_found/retryable=false`；已有比赛复盘返回 Telemetry `MISS` | PASS：错误和 Telemetry 缺失均显式暴露；基础事实与缺失细节分开 |
| 未安装 Homelab 能力 | `12_uninstalled_homelab` | 无工具调用 | PASS：明确能力边界，不假称执行安装 |

`01`、`04`、`06_clock_strict`、`12` 是独立改写的保留表达；这些具体句子未写入 bundled Skill。Skill 只提供通用的工具边界、半开区间、结果集和证据规则。

## 数据与旧链核验

- 迁移 dry-run：旧输入 1151 行，267 个唯一比赛，884 个重复输入，0 个 invalid，57 个 Telemetry feature。
- 首次 apply：写入 267 场、57 features；重复 apply 不新增比赛；当前 SQLite 为 267 matches、748 match_players、58 telemetry_features、1 migration_runs。
- 最终 CasaOS checkpoint：`/DATA/AppData/openclaw/backups/openclaw-pubg-20260917-091502/`。
- `langbot` Telegram bot 为 disabled，KOOK 独立 bot 保留；`pubg-stats` 和 `kurisu-gateway` plugin settings 均 disabled。
- 6 个旧 PUBG n8n workflow 均为 inactive；旧 PUBG/OpenClaw compose 定义和容器均已退休；Product Radar owner 为 `disabled`。
- 最终 OpenClaw、Product Radar、9Router、n8n 和保留的 LangBot 独立服务均在运行；PUBG 路径不依赖 LangBot、Mastra、n8n 或旧 Runtime。

## Telegram 外部阻塞

Telegram token、allowlist 和原生 polling 连接均已验证，但验收时 `lastInboundAt=null`、`lastOutboundAt=null`，没有可用的自然入站消息或独立测试账号。因此没有伪造“真实私聊查询 + 连续追问已送达”，也没有把 gateway/webchat agent 回合当作 Telegram 闭环证据。

按 Goal 第 10/11 节，这使“Telegram 私聊真实闭环”仍为 BLOCKED；其余可执行的重构、迁移、旧链清理、真实 9Router/OpenClaw 场景和业务数据链均已完成并留存证据。
