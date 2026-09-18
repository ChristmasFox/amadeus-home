# Project Map

本文件是当前 Amadeus/OpenClaw 架构的快速导航；详细状态见 `docs/PROJECT_STATE.md`。

| 路径 | 责任 | 运行边界 |
| --- | --- | --- |
| `plugins/pubg` | PUBG 原生 plugin、六个工具、bundled Skill | OpenClaw 进程内 |
| `plugins/amadeus` | Amadeus 原生工具、briefing、owner outbox worker | OpenClaw 进程内 |
| `packages/pubg-domain` | PUBG API、SQLite、查询/比较和 Telemetry facts | 被 PUBG plugin 直接调用 |
| `apps/product-radar` | 商品监控、匹配、watch scheduler 和事件 outbox | 独立 CasaOS app |
| `integrations/openclaw` | 脱敏 config、workspace、Codex hook | CasaOS OpenClaw |
| `infra/docker/casaos/openclaw` | 固定镜像和 OpenClaw Compose 模板 | OrbStack `ubuntu` |
| `infra/docker/casaos/product-radar` | Product Radar Compose 模板 | OrbStack `ubuntu` |
| `infra/macos` | NAS 宿主机命令 | macOS SSH target |
| `scripts/deploy-openclaw.sh` | 预检、备份、选择性构建、切换和验收 | `--apply --build-auto`；全量才用 `--build` |

## 请求路径

自然语言只由 OpenClaw 规划。plugin 通过结构化 tool 调用 Domain 或明确的外部服务；
Domain 不读取聊天、不做关键词路由、不生成平台消息。Telegram/WhatsApp 是入口，主动
通知只通过 WhatsApp owner outbox。

## 修改映射

- PUBG 规则、指标或 API：改 `packages/pubg-domain` 并补测试。
- PUBG 工具 schema/SDK 接线/Skill：改 `plugins/pubg`。
- 非 PUBG 工具、通知、日报和外部服务 policy：改 `plugins/amadeus`。
- 商品监控业务：改 `apps/product-radar`，保持 channel-free outbox。
- OpenClaw 配置/镜像/迁移：改 `integrations/openclaw`、`infra/docker/casaos/openclaw`
  或 `scripts/deploy-openclaw.sh`；不要直接改运行容器。
- 历史 `docs/archive`、`docs/reports` 只保留审计证据，不得作为当前执行路径。
