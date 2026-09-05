# Agent Monorepo

这是 LangBot / Mastra Runtime / PUBG Domain / n8n / Telemetry / Platform
Adapter / HomeLab 配置的可迁移 Git source of truth。仓库保存系统定义、源代码、
插件、patch、workflow、文档和 Codex 状态；运行时数据与 secrets 保留在仓库外。

## 目标与边界

- 使用 pnpm workspace，不引入 Nx、Kubernetes 或其他编排层。
- 长期 HomeLab 服务运行在 OrbStack Linux machine `ubuntu` 内的 CasaOS。
- LangBot 第三方本体不复制到仓库，只追踪自定义插件、patch、资源和兼容版本。
- n8n workflow JSON 是版本化源文件；n8n credentials 必须在恢复后手动重新绑定。
- Git 不保存 Bot Token、API Key、密码、Tunnel Token、`.env` 或业务数据库快照。

## 仓库结构

```text
apps/
  agent-runtime/       Mastra/PUBG V3 当前可运行 runtime（source-preserving）
  telemetry-worker/    Telemetry 边界 facade
  whatsapp-adapter/    WhatsApp adapter 边界 facade
packages/
  contracts/           跨模块契约
  platform-core/       平台核心边界
  pubg-domain/         PUBG domain 与 legacy V2
  presentation/        展示层边界
integrations/
  langbot/             自定义插件、patch、配置模板
  n8n/                 workflow source 与 credential placeholder
infra/
  docker/              CasaOS/Docker 脱敏模板
  cloudflare/          Tunnel 配置模板
  macos/               Mac mini 辅助脚本
scripts/               bootstrap、doctor、backup、restore、检查工具
docs/                  架构、状态、决策、迁移清单和历史归档
.agent/                Codex 持久化状态与 checkpoint
skills/                可迁移的 Codex skill source
```

## 新机器恢复

以下命令只在本地执行，不会自动 push 公网仓库：

```sh
git clone <private-repository-url> agent-monorepo
cd agent-monorepo
./scripts/bootstrap.sh --check
./scripts/bootstrap.sh --init-env
pnpm install
pnpm check:secrets
```

然后按下面顺序操作：

1. 在 OrbStack 中创建并启动 Linux machine `ubuntu`，安装/启用 CasaOS。
2. 从离线密码管理器恢复 `/DATA/AppData/*` 下的 `.env`、secret file 和证书；不要复制到 Git。
3. 根据 `infra/docker/casaos/` 与 `infra/docker/homelab/` 模板，在 Ubuntu 的
   `/var/lib/casaos/apps/<app>/docker-compose.yml` 建立实际 CasaOS 定义。
4. 构建或恢复 `apps/agent-runtime` 镜像，启动 LangBot、n8n、n8n sandbox 和 runtime。
5. 在 n8n 导入 `integrations/n8n/workflows/` 下的 workflow，重新创建 credentials，
   并确认 Data Table / webhook URL 已指向新实例。
6. 如有备份，先预览再恢复：

   ```sh
   ./scripts/restore.sh --dry-run /Volumes/Avalon/backups/agent-monorepo/<stamp>/data-<stamp>.tar.gz
   ./scripts/restore.sh --confirm /Volumes/Avalon/backups/agent-monorepo/<stamp>/data-<stamp>.tar.gz
   ```

7. 启动服务后执行 `./scripts/doctor.sh`，并用 `docs/PROJECT_STATE.md` 对照验证。

`restore.sh` 默认拒绝在目标服务运行时写入 `/DATA/AppData`；只有确认停机或明确
传入 `--allow-running` 才会执行。Redis 被视为可重建缓存，核心恢复依赖是 Postgres、
n8n data、LangBot data、runtime state 和其他明确列入备份清单的 volume。

## 开发与验证

要求 Node.js `>=22`、pnpm `9.9.x`、Git 和 Python 3。先按 Git diff 选择最低足够的验证等级：

```sh
pnpm workflow:plan                 # FAST / RUNTIME / RELEASE scope 预览
pnpm workflow:verify               # 只运行 FAST/RUNTIME 本地验证；绝不 build/deploy
pnpm test:workflow                 # 分类规则回归测试
pnpm smoke:runtime                 # 非 Docker 的 /healthz + /homehub/health smoke
```

- **FAST** 是 docs、`.agent`、tests、skills、纯逻辑和小功能的默认流程：定向测试、受影响
  package typecheck、`git diff --check`，必要时 secrets scan；不 build、不 restart、不 deploy。
- **RUNTIME** 用于 `apps/agent-runtime/src/**`、`packages/homehub-domain/src/**` 及 runtime assets：
  运行受影响 package 的 typecheck/build、映射后的定向 tests 与本地 endpoint smoke；仍不 build
  production Docker image。HomeHub 源码变更不会自动升级为 RELEASE。
- **RELEASE** 只在明确要求实际 CasaOS 部署时执行。Dockerfile、`.dockerignore`、`package.json`
  或 `pnpm-lock.yaml` 变更会标记为 `RELEASE_BUILD_REQUIRED`，但只会给出计划，绝不会自动 build。

完整 scope 矩阵、LangBot/env 特例、BuildKit cache 和 benchmark 见
`docs/DEVELOPER_WORKFLOW.md`。传统本地命令仍可按需使用：

```sh
pnpm install
pnpm typecheck
pnpm build
pnpm test
pnpm test:legacy-v2
pnpm check:secrets
```

插件构建：

```sh
./scripts/build_pubg_plugin.sh
./scripts/build_pubg_v3_plugin.sh
```

生成的 `.lbpkg` 只用于本地安装，已被 `.gitignore` 排除；插件源文件仍在
`integrations/langbot/plugins/` 中版本化。

LangBot 部署预览与显式应用：

```sh
./scripts/deploy-langbot.sh --dry-run
export LANGBOT_API_KEY='<restore-from-password-manager>'
./scripts/deploy-langbot.sh --apply --plugin pubg-stats-v3
```

`deploy-langbot.sh` 默认只构建和检查，不写入 LangBot。插件应用通过 LangBot
`/api/v1/plugins/install/local` API 完成，API key 只从外部环境读取。patch 是
第三方镜像的 build-time 变更；需要先预览 `--patches`，再显式使用
`--apply --patches --activate-image` 构建并切换 CasaOS LangBot 镜像。旧镜像、compose
备份和 `.lbpkg` 回滚包都保留在 Git 外。

## Codex 持久化协议

每次新会话先读取：

```text
README.md
docs/ARCHITECTURE.md
docs/PROJECT_STATE.md
docs/CURRENT_TASK.md
.agent/state.md
```

再执行 `git status --short --branch` 和 `git log -5 --oneline --decorate`。
需要理解目录责任时继续读取 `docs/PROJECT_MAP.md`；按需读取 `skills/*/SKILL.md`。
阶段完成后更新 `docs/CURRENT_TASK.md`、`docs/PROJECT_STATE.md`，并在
`.agent/checkpoints/` 写入 checkpoint。详细规则见 `AGENTS.md`。

## 数据、备份与 secrets

- `/DATA/AppData` 是 Linux 本地持久化应用数据。
- `/Volumes/Avalon/media`、`/Volumes/Avalon/downloads` 是共享存储。
- `/Volumes/Avalon/backups/agent-monorepo` 是默认备份位置；没有共享卷时才使用被忽略的 `.backups/`。
- `./scripts/backup.sh` 默认排除 `.env` 与 secrets；`--include-secrets` 只生成独立的受限归档，
  仍必须离线加密保存。
- `.env.example` 和各组件配置模板只包含空值或明确 placeholder。

提交前必须运行 `pnpm check:secrets`。当前 `main` 已配置用户指定的 `origin` 和
GitHub 远端；恢复流程本身仍不会自动 push，发布必须由用户明确执行。

## 当前状态

- 迁移状态：见 `docs/PROJECT_STATE.md`。
- 当前任务：见 `docs/CURRENT_TASK.md`。
- 运行时与部署拓扑：见 `docs/ARCHITECTURE.md`。
- 文件迁移清单：见 `docs/INVENTORY.md`。
- 重要取舍：见 `docs/DECISIONS.md`。
