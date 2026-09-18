# Amadeus 迁移清单

更新时间：2026-09-18（Asia/Shanghai）

## 当前源代码

- `plugins/pubg`：PUBG 的原生 OpenClaw plugin。
- `plugins/amadeus`：Product Radar、媒体整理、NAS、HomeLab、日报、KOOK 群成员和 owner 通知工具。
- `packages/pubg-domain`：独立 PUBG Domain、SQLite 和一次性数据迁移器。
- `apps/product-radar`：独立商品监控服务；事件只写 channel-free owner outbox。
- `integrations/openclaw`：OpenClaw 配置、workspace、briefing source 和 Codex hook。
- `infra/docker/casaos/openclaw`、`infra/docker/casaos/product-radar`：CasaOS 部署模板。
- `infra/macos`：NAS 只读/休眠命令的宿主机脚本。

旧 LangBot、n8n、旧 Runtime、旧 facade、旧平台 sender、KOOK watchdog 和旧业务 plugin
已从当前执行树删除。历史报告可用于审计，但不再是部署 source 或 fallback。

## 迁移边界

- OpenClaw/Kurisu 是唯一 agent runtime 和规划入口。
- Telegram、WhatsApp 和未来渠道只做入口；主动通知只投递 WhatsApp owner DM。
- Product Radar、日报、媒体执行结果、Codex 完成/失败和 HomeLab 事件都使用统一的
  channel-free outbox，由 OpenClaw owner worker 负责幂等投递。
- 媒体整理继续由独立 `media-organizer-adapter` 执行；plugin 只做 preview/execute
  policy 和结果呈现，不直接移动媒体文件。

## 仓库外数据

生产切换前，脚本会把 OpenClaw 现状、Product Radar env、PUBG SQLite、workspace、
LangBot/n8n app 定义及外部数据库移动到
`/DATA/AppData/openclaw/backups/<checkpoint>`。备份不入 Git；旧服务路径在切换后不再存在，
但可从该 checkpoint 恢复读取。

## Secrets

Bot token、API key、owner identity、SSH key、密码、`.env`、证书和真实业务数据永远不入库。
提交前运行 `pnpm check:secrets`；生产应用只从 CasaOS `/DATA/AppData` 的外部 secret/config
恢复。
