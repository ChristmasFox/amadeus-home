# Migration Inventory

更新时间：2026-09-05（Asia/Shanghai）

## 已迁移的系统定义

| 区域 | 内容 |
| --- | --- |
| apps/agent-runtime | Mastra/PUBG V3 server、query engine、planner、telemetry、review、platform adapter、WhatsApp、tests、Dockerfile、部署 compose |
| apps/telemetry-worker | Telemetry public facade 与说明 |
| apps/whatsapp-adapter | WhatsApp public facade 与说明 |
| packages/contracts | 共享 contract facade |
| packages/platform-core | platform core facade |
| packages/pubg-domain | V3 facade 与 V2 Python domain/tests |
| packages/presentation | presentation facade |
| integrations/langbot/plugins | pubg-stats V2/V3、organize-emby、macOS NAS control 及测试 |
| integrations/langbot/patches | KOOK、Telegram polling、message conversion、PUBG picker、WhatsApp patch/resource |
| integrations/n8n/workflows | V3、V2 legacy、PUBG daily stats、organize-emby、credential placeholder |
| docs/archive | CasaOS、PUBG V3、Platform Adapter 和脱敏 baseline 历史资料 |
| infra | Docker/CasaOS、Cloudflare、macOS 迁移模板 |
| scripts | bootstrap、doctor、backup、restore、secret scan、插件构建和 workflow 工具 |
| .agent | 会话状态、任务规则、checkpoint |

## 明确排除

- 第三方 LangBot 本体；
- node_modules、编译产物 dist、Python cache、.pyc；
- LangBot .lbpkg 构建产物；
- 日志、临时目录和真实比赛压缩数据；
- .env、secret files、证书、token、API key、数据库密码；
- Postgres / n8n / LangBot / Redis 的运行时 volume；
- 原始含真实密钥的 9router 与 aria2 compose。

## 兼容版本基线

- LangBot：当前运行定制版本基于 4.10.8；
- Mastra：@mastra/core 1.63.2；
- Node：>=22；
- pnpm：9.9.x；
- Telemetry parser：telemetry-parser-4；
- Review features：review-features-4；
- n8n sandbox：当前 compose 使用 1.1.1 API/runner service；
- HomeLab 服务镜像版本与路径以 infra/docker/ 模板及目标 CasaOS 实例为准。

## 来源与审计

迁移遵循“只复制明确在本任务范围内的代码和配置”原则。生成目录、容器层和机器
本地状态没有作为源码归档；运行时基线中的敏感值已经以 placeholder 或
<redacted> 形式处理。提交前使用 pnpm check:secrets 再次扫描。
