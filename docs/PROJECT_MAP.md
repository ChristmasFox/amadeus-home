# Project Map

本文件是当前 OpenClaw PUBG 架构的快速导航；详细状态见 `docs/PROJECT_STATE.md`。

| 路径 | 责任 | 运行边界 |
| --- | --- | --- |
| `plugins/pubg` | 原生 OpenClaw plugin、六个工具、bundled Skill | OpenClaw 进程内 |
| `packages/pubg-domain` | API、SQLite、查询/比较、Telemetry facts、迁移 | 被 plugin 直接调用 |
| `integrations/openclaw` | 脱敏 config、workspace、部署说明 | 外部 config/data 注入 |
| `infra/docker/casaos/openclaw` | 固定镜像和 CasaOS Compose 模板 | OrbStack ubuntu |
| `apps/product-radar` | 独立商品监控 | 独立 CasaOS app |
| `integrations/langbot` | 非 PUBG LangBot 自定义资产 | 独立服务，可选 |
| `integrations/n8n` | 非 PUBG workflow source | 独立服务，可选 |
| `scripts` | 构建、检查、迁移、部署、备份恢复 | 明确 apply 才写远端 |
| `docs` | Goal、架构、状态、验收证据 | Git source |
| `.agent` | 会话状态和 checkpoint | 不依赖聊天历史 |

## 请求路径

自然语言只由 OpenClaw 规划。plugin 的工具调用进入 Domain；Domain 不读取聊天、不做
关键词路由、不生成平台消息。Telegram 是本轮唯一 PUBG 入口，群聊默认关闭。

## 修改映射

- PUBG 规则、指标或 API：改 `packages/pubg-domain` 并补测试。
- 工具 schema/SDK 接线/Skill：改 `plugins/pubg` 并执行 native validate。
- OpenClaw 配置/镜像/迁移：改 `integrations/openclaw`、`infra/docker/casaos/openclaw`
  或对应脚本；不要直接改运行容器。
- Product Radar、LangBot、n8n：保持各自独立，不向 PUBG 引入依赖。
