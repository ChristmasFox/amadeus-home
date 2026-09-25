# amadeus-home

这是一个以 Git 为唯一 source of truth 的 HomeLab monorepo。当前唯一 Agent 主链是：

\`\`\`text
Telegram / WhatsApp / future channels
        → OpenClaw/Kurisu
        → native PUBG + Amadeus plugins / Skills
        → deterministic Domain or direct external service
\`\`\`

OpenClaw 负责自然语言理解、会话、模型路由、调度、人格和工具循环；业务插件只做边界适配，
确定性逻辑留在 Domain 或明确的外部服务。旧 LangBot、n8n、旧 Runtime、关键词路由和
第二个 Agent 不再是运行依赖。

主 Agent 使用 OpenClaw `tools.profile="full"`，WhatsApp owner session 可以调用完整的
OpenClaw 工具面和已加载 native plugins；工具自身的 owner 检查与宿主 approval gate 仍然有效。

## 目录

- \`plugins/pubg/\`：唯一 PUBG 原生 OpenClaw plugin，六个受限工具和 Skill。
- \`packages/pubg-domain/\`：官方 PUBG API、SQLite、查询/比较、Telemetry 事实和迁移器。
- \`plugins/amadeus/\`：Product Radar、媒体安全流程、NAS、HomeLab、只读 VPS、KOOK lookup、
  NASDAQ-100/标普500市场观测、Identity 和 owner notification 的原生 OpenClaw plugin。
- \`apps/product-radar/\`：独立商品监控服务；业务事件只写 channel-free owner outbox。
- \`integrations/openclaw/\`：脱敏配置、workspace、Skills 和部署说明。
- \`infra/docker/casaos/\`：固定版本 OpenClaw/Product Radar 的 CasaOS 模板。
- \`infra/macos/nas-control.sh\`：NAS 只读状态/磁盘和 owner-only sleep 的受限 SSH 入口。
- \`docs/\`、\`.agent/\`：架构、当前状态、目标、验收和可恢复 checkpoint。

旧 \`integrations/langbot/\`、\`integrations/n8n/\`、watchdog、旧通知 bridge 和对应
CasaOS app 定义在本轮切换后从 Git 移除；运行时数据只留在仓库外 dated checkpoint。

## 本地验证

需要 Node 24.16+、pnpm 11 和 Python 3：

\`\`\`sh
./scripts/bootstrap.sh --check
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm check:secrets
\`\`\`

开发 workflow 默认只做本地验证，不构建镜像、不重启服务：

\`\`\`sh
pnpm workflow:plan
pnpm workflow:verify
pnpm test:workflow
\`\`\`

## Amadeus 版本管理

产品版本唯一记录在根目录 `VERSION`，当前正式发布版本为 `1.5.3`。每次只执行 `bump patch` 并递增
`0.0.1`；patch 位为 `0..9`，到 9 时进位到 minor（`0.9.9 -> 0.10.0`），minor 位为 `0..99`，到 99 且
patch=9 时进位到 major（`0.99.9 -> 1.0.0`）。部署完成通知的正文来自
`RELEASE_NOTES.md`；它是单次发布说明，不是累计 changelog，每次递增都必须替换旧正文，只保留
本次部署的新增或修复。部署前会校验版本标题、正文非空，并拒绝把运行时名称写进通知。

```sh
./scripts/amadeus-version.sh show
./scripts/amadeus-version.sh bump patch  # 唯一递增入口：1.4.1 -> 1.4.2；patch/minor 按上面的边界进位
./scripts/amadeus-version.sh check
```

不再使用或手工指定 `bump minor`、`bump major`。

每次递增后先替换 `RELEASE_NOTES.md` 的首行版本和正文，只写本次更新内容，不重复上一版本说明。部署通知标题固定为
`Amadeus <版本> · 世界线收束`，部署脚本会统一在正文末尾追加一次 `El Psy Kongroo.`；
`RELEASE_NOTES.md` 不要自行重复写这句。

## CasaOS 部署

长期服务运行在 OrbStack Linux machine \`ubuntu\` 的 CasaOS。OpenClaw canonical Compose
路径是 \`/var/lib/casaos/apps/openclaw/docker-compose.yml\`，持久化数据是
\`/DATA/AppData/openclaw\`。生产 secrets、身份、数据库和媒体数据都在仓库外。

默认只预览；一次性迁移必须使用显式 apply：

\`\`\`sh
./scripts/deploy-openclaw.sh --dry-run
# 推荐：按 live image 的 Git commit 自动只构建受影响镜像
./scripts/deploy-openclaw.sh --apply --build-auto
# workspace/config/compose-only 改动：复用现有镜像
./scripts/deploy-openclaw.sh --apply --no-build
# 明确要求全量双镜像发布时才使用
./scripts/deploy-openclaw.sh --apply --build
./scripts/doctor.sh
\`\`\`

部署脚本默认不会因为任意改动重建两个镜像：

- \`--build-auto\` 比较当前 Git 与线上镜像 tag 中的 commit；只要 \`plugins/pubg\`、
  \`plugins/amadeus\`、\`packages/pubg-domain\` 或 OpenClaw Dockerfile 变化才构建 OpenClaw，
  只有 \`apps/product-radar\` 变化才构建 Product Radar。
- \`--no-build\` 复用线上两个 immutable image；如果检测到业务源代码比镜像更新，会直接拒绝，
  不会静默上线旧代码。
- \`--build-openclaw\`、\`--build-radar\` 可只构建一个镜像；\`--build\` 保留为明确的全量双镜像发布。

所有 apply 仍会备份外部状态、执行匹配的验证、更新 Compose 并使用
\`docker compose up -d --no-build\`；不会在 macOS host Docker 部署持久服务，也不会把
backup、token、API key 或业务数据写入 Git。

媒体整理仍遵循明确单项的 \`scan → preview → 同一会话显式确认 → execute\`；不批量猜测、
不覆盖、不删除现有媒体库。详见 \`organize-emby-media\` Skill。

## 安全与恢复

Bot token、API key、密码、证书、\`.env\` 和业务数据永不入库。切换前会建立
\`/DATA/AppData/openclaw/backups/amadeus-openclaw-<UTC>\`，并在本机为 Codex hook 保留
外部备份。恢复只依据 checkpoint 的明确路径操作，不执行回滚演练。
