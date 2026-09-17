# Project State

更新时间：2026-09-17（Asia/Shanghai）

## 当前目标

唯一执行目标是 OPENCLAW_PUBG_REFACTOR_GOAL.md：Telegram 私聊 → 唯一 OpenClaw/Kurisu
→ 当前 9Router → 原生 PUBG plugin → 独立 PUBG Domain → 官方 PUBG API/SQLite。旧多领域
实现和历史状态文档不再是可执行依据。

## 当前阶段

S0、S1、S2、S3 已完成；S4 的所有可执行项已完成。唯一未闭环项是 Telegram 自然入站
私聊验收：原生 channel 已连接，但没有测试账号或自然入站，不能伪造送达。

## 已固定的实现

- OpenClaw：官方 ghcr.io/openclaw/openclaw:2026.9.4，插件加载目录 /app/extensions/pubg。
- Gateway UI：CasaOS 端口 `18789` 当前绑定 `0.0.0.0`，局域网入口为
  `http://192.168.5.3:18789/`；Control UI 仍需使用外部保存的 gateway token 完成认证。
- provider：现有 9Router，模型 route nine_router/arthur-combo，不换模型绕过验收。
- Telegram：OpenClaw native channel；私聊 numeric allowlist 来自外部配置，群聊关闭。
- Plugin：pubg_resolve_players、pubg_search_matches、pubg_query_stats、
  pubg_compare_stats、pubg_get_match、pubg_get_review_facts。
- Domain：packages/pubg-domain 只接收结构化 selector，确定性返回 status/coverage/
  asOf/metricVersion/queryResolved/evidenceRefs；SQLite 位于 OpenClaw data volume。
- Product Radar：仍是独立应用，默认 notification owner 为 disabled；不会调用已退休
  PUBG/通知端点。

## 迁移与退休清单

- 迁移输入：旧 n8n SQLite、旧 state/features；目标 /DATA/AppData/openclaw/data/pubg.sqlite。
- 迁移器默认 dry-run，--apply 才写入，matchId/feature 幂等。
- 需在 live apply 中停用：LangBot Telegram bot、PUBG plugin settings、PUBG n8n
  gateway/sync/daily workflow，以及旧日报 producer。
- 需保留运行但不参与 PUBG 的服务：9Router；LangBot、n8n、Product Radar 是否运行由其
  各自独立业务决定，不能反向成为 PUBG 依赖。
- 旧 Runtime/插件/工作流/facade/generator 已从 Git 当前树删除；历史不复制到新 legacy 目录。

## 已有证据

- Domain 9 tests、plugin 3 tests、Product Radar 51 tests；OpenClaw native config/plugin
  inspect、bundled Skill preflight 已通过。
- 真实旧数据迁移：1151 输入、267 唯一比赛、57 初始 Telemetry feature；重复 apply
  不新增比赛，目标 SQLite migration_runs 一条；运行态按需新增到 58 features。
- 最终 CasaOS checkpoint：`/DATA/AppData/openclaw/backups/openclaw-pubg-20260917-091502`；
  镜像、Telegram probe、OpenClaw/9Router agent loop 和旧链停用证据见
  `docs/reports/OPENCLAW_PUBG_ACCEPTANCE.md`。

## 恢复与安全

生产 secrets 和业务数据不入库。切换脚本在 /DATA/AppData/openclaw/backups/<id> 保留
旧 compose、数据库、state/features、外部配置和新 SQLite 切换前副本。只记录恢复路径，
不执行旧架构回滚演练。canonical CasaOS target 是 OrbStack ubuntu，Compose 为
/var/lib/casaos/apps/openclaw/docker-compose.yml，正常启动使用 docker compose up -d --no-build。
