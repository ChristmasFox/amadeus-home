# Project State

更新时间：2026-09-17（Asia/Shanghai）

## 当前目标

唯一执行目标是 OPENCLAW_PUBG_REFACTOR_GOAL.md：Telegram 私聊 → 唯一 OpenClaw/Kurisu
→ 当前 9Router → 原生 PUBG plugin → 独立 PUBG Domain → 官方 PUBG API/SQLite。旧多领域
实现和历史状态文档不再是可执行依据。

## 当前阶段

S0、S1、S2 已完成；S3/S4 正在收尾。代码已完成旧 PUBG 主链源码清理和 Product Radar
旧通知端点断开，尚未在本次收尾提交上执行生产切换。

## 已固定的实现

- OpenClaw：官方 ghcr.io/openclaw/openclaw:2026.9.4，插件加载目录 /app/extensions/pubg。
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

- Domain 8 tests、plugin 2 tests、Product Radar 51 tests；OpenClaw native config/plugin
  inspect 已通过。
- 真实旧数据迁移 smoke：1151 输入、267 唯一比赛、57 Telemetry feature；重复 apply
  不新增比赛，目标 SQLite migration_runs 仅一条。
- 迁移前后的真实 CasaOS checkpoint、镜像 digest、Telegram channel、OpenClaw/9Router
  agent loop 和最终私聊消息，待 S3/S4 写入本文件。

## 恢复与安全

生产 secrets 和业务数据不入库。切换脚本在 /DATA/AppData/openclaw/backups/<id> 保留
旧 compose、数据库、state/features、外部配置和新 SQLite 切换前副本。只记录恢复路径，
不执行旧架构回滚演练。canonical CasaOS target 是 OrbStack ubuntu，Compose 为
/var/lib/casaos/apps/openclaw/docker-compose.yml，正常启动使用 docker compose up -d --no-build。
