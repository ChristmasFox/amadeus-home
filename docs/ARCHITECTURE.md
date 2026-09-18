# Architecture

更新时间：2026-09-18（Asia/Shanghai）

## PUBG 主链

```text
Telegram / WhatsApp / future OpenClaw channel
       │ native channel transport and delivery
       ▼
OpenClaw 2026.9.4 / Kurisu workspace
       │ current 9Router route: nine_router/arthur-combo
       │ model-owned planning, session, memory and final response
       ▼
plugins/pubg (native OpenClaw plugin + conversation adapter)
       │ channel/session context normalized at the boundary
       │ six bounded tools; no LLM; no HTTP hop
       ▼
packages/pubg-domain
       ├─ official PUBG API client with bounded retry/concurrency
       ├─ SQLite cache/result/session/migration repository
       ├─ deterministic query, comparison and time selection
       └─ on-demand Telemetry facts/review evidence
```

OpenClaw 的 plugin 目录是 `/app/extensions/pubg`，数据卷是
`/DATA/AppData/openclaw/data`。API key、队伍配置和 Telegram token 通过外部文件只读
挂载；OpenClaw 不挂载媒体目录、整个 home 或 Docker socket。

## 边界

### Domain

`packages/pubg-domain` 不导入 OpenClaw、Mastra、LangBot、Telegram 或任何旧 app。
它接收已校验的结构化 selector，返回 `ok/partial/no_matches/error`、coverage、
`asOf`、metricVersion、queryResolved 和 evidenceRefs。KD 的分母为 deaths，零死亡
返回 null 与原因；缺失不是零。比赛按 matchId 去重，时间范围使用显式 IANA timezone
和半开区间。

### Plugin

`plugins/pubg` 使用实际锁定版本支持的原生 `defineToolPlugin`，只注册：

`pubg_resolve_players`、`pubg_search_matches`、`pubg_query_stats`、
`pubg_compare_stats`、`pubg_get_match`、`pubg_get_review_facts`。

schema 限制列表、分页、时间和输出大小；身份来自 OpenClaw tool context，插件参数不能
覆盖 Telegram/WhatsApp session 身份。最终中文表达由 OpenClaw 生成，事实数字不能被改写。

插件的 `src/adapters/` 是渠道适配边界：当前 OpenClaw adapter 只归一化
Telegram/WhatsApp 及未来渠道的可信 session/channel metadata；Domain 只接收
platform-neutral 的 session 和结构化 selector。新增渠道不需要修改 Domain 或统计核心。

### 独立应用

`apps/product-radar` 是独立商品监控服务，默认通知 owner 为 disabled；它不调用
PUBG、OpenClaw 或退休通知端点。LangBot 和 n8n 仅保留非 PUBG 自己的资产，不能作为
PUBG 启动依赖。

## 部署与恢复

canonical runtime 是 OrbStack `ubuntu` 内 CasaOS：

- Compose：`/var/lib/casaos/apps/openclaw/docker-compose.yml`
- AppData：`/DATA/AppData/openclaw`
- host 管理端口：`127.0.0.1:18789`
- 基础镜像：`ghcr.io/openclaw/openclaw:2026.9.4`，按已核验 ARM64 digest 固定
- provider：现有 `9router:20128/v1`，模型 route 为 `arthur-combo`

`scripts/deploy-openclaw.sh --apply --build --cleanup` 是一次性迁移入口：

1. 检查外部旧数据库、API key、队伍和身份文件。
2. 创建 dated checkpoint。
3. 写入外部 OpenClaw config/workspace/secrets。
4. 先 dry-run 再 apply 导入旧 n8n/Data Table、state 和 Telemetry features；重复运行幂等。
5. 停用旧 Telegram consumer、旧 PUBG n8n workflow 和非本轮 producer，然后启动 OpenClaw。
6. 验证 plugin、SQLite、Telegram channel 和 health；可选地移除旧 PUBG app 定义/容器。

备份用于数据保护，未进行旧架构回滚演练；任何恢复须依据 checkpoint 明确执行。
