# amadeus-home

这是一个以 Git 为唯一 source of truth 的 HomeLab monorepo。当前 PUBG 主链是：

Telegram/WhatsApp 聊天 → OpenClaw/Kurisu 原生渠道适配 → PUBG plugin 适配层 → 独立 `@agent/pubg-domain`
→ 官方 PUBG API 与 SQLite。

OpenClaw 负责自然语言理解、会话、模型路由、人格和工具循环；PUBG plugin 只做
SDK 适配，领域层只返回确定性事实。PUBG 不依赖 LangBot、Mastra、n8n、旧 Runtime、
额外 HTTP 服务或 Docker socket。

## 目录

- `plugins/pubg/`：唯一业务 plugin，注册六个原生工具并携带 PUBG Skill。
- `packages/pubg-domain/`：官方 API client、SQLite、查询/比较、Telemetry 事实和迁移器。
- `integrations/openclaw/`：脱敏配置、跨渠道 workspace 人格和部署说明。
- `infra/docker/casaos/openclaw/`：固定 OpenClaw 版本的 CasaOS 模板。
- `apps/product-radar/`：独立商品监控应用，不是 PUBG 运行依赖。
- `integrations/langbot/`、`integrations/n8n/`：仍独立运行的非 PUBG 资产。
- `docs/`、`.agent/`：架构、状态、验收和可恢复 checkpoint。

## 本地验证

需要 Node 24.16+、pnpm 11 和 Python 3：

```sh
./scripts/bootstrap.sh --check
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm check:secrets
```

只验证 PUBG：

```sh
pnpm build:pubg
pnpm typecheck:pubg
pnpm test:pubg
pnpm --filter @agent/pubg-plugin exec openclaw plugins validate --entry ./dist/index.js --json
```

开发 workflow 会根据 Git 改动选择 FAST、PUBG/Runtime 或 RELEASE；默认不构建镜像、不
重启服务：

```sh
pnpm workflow:plan
pnpm workflow:verify
pnpm test:workflow
```

## CasaOS 部署

长期服务运行在 OrbStack Linux machine `ubuntu` 的 CasaOS。OpenClaw 的 canonical
Compose 路径是 `/var/lib/casaos/apps/openclaw/docker-compose.yml`，持久化数据是
`/DATA/AppData/openclaw`。生产 secret、Telegram owner、队伍配置和数据库都在仓库外。

默认只预览。一次性切换在确认代码已提交后执行：

```sh
./scripts/deploy-openclaw.sh --dry-run
./scripts/deploy-openclaw.sh --apply --build --cleanup
./scripts/doctor.sh
```

脚本会先建立仓库外 dated checkpoint，再迁移旧比赛/Telemetry 数据，停用旧 PUBG
Telegram/n8n producer，启动唯一 OpenClaw，检查 Telegram channel 和 SQLite；不会把
旧服务的数据库或 secrets 写入 Git。详见 [OpenClaw 部署说明](integrations/openclaw/README.md)
和 [当前状态](docs/PROJECT_STATE.md)。

## 安全与恢复

Bot token、API key、密码、证书、`.env` 和业务数据永不入库。使用 `scripts/backup.sh`
备份 OrbStack `ubuntu` 的 AppData，使用 `scripts/restore.sh` 先预览再恢复。修改
CasaOS 时只使用明确的 `--apply`；不要在 macOS host Docker 中部署持久服务。

新会话入口依次读取：

```text
README.md
docs/ARCHITECTURE.md
docs/PROJECT_STATE.md
docs/CURRENT_TASK.md
.agent/state.md
```

旧 Kurisu/Mastra/PUBG 设计文档已经被当前 Goal 取代，仅作为 Git 历史，不是可执行入口。
