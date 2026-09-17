# 当前任务优先约束（2026-09-17）

用户最新决定以 `docs/OPENCLAW_PUBG_REFACTOR_GOAL.md` 取代下文旧 Kurisu/LangBot 实施范围。只落地 OpenClaw 原生 PUBG 插件、独立 Domain 和 Telegram 私聊，直接到最终形态，不做灰度、shadow、双跑、兼容过渡或回滚演练。执行该 Goal 时已授权必要构建、CasaOS 一次性切换、数据迁移、提交和 push；使用显式 apply 执行，无需逐阶段再次请求。保留必要数据备份、权限、secret 保护与真实验收。本次提交仅创建实施计划，尚未实施新架构。

旧多领域验收矩阵由新计划第 10 节替代；不能把不在本轮范围的功能扩展成新任务。其余 source of truth、用户改动保护、预算、checkpoint 和工程规则仍有效。以下架构/发布范围冲突以用户最新决定及新计划为准。

# Agent Monorepo 工作规则

## Kurisu 统一 Agent 实施范围

实施该功能时必须先读取 `docs/KURISU_AGENT_IMPLEMENTATION_PLAN.md`、
`docs/KURISU_AGENT_ACCEPTANCE.md` 和 `docs/KURISU_CODEX_GOAL.md`。当前仅有计划，不能把它当作已上线架构。
P0 按证据选择并记录唯一主 Agent 宿主，优先复用用户现有 LangBot/9Router；后续不并行建设两个主 Agent。
已迁移的普通自然语言不得通过关键词/正则领域路由或旧 fast path 抢先执行；协议命令、schema 校验和确定性业务规则仍保留。
执行按阶段提交和验收，禁止删除失败用例、降低验收标准、用 mock 代替真实环境完成证明，或把回合结束当任务成功。
开发 Goal 不自动授权生产 RELEASE；部署范围以用户后续明确指令为准。其余工程与预算规则保持有效。

## Source of Truth

- 本 Git 仓库是系统定义的唯一 source of truth。源码、插件、patch、workflow、Compose 模板、文档和 Codex 状态都必须从 Git 可重建。
- 不允许只修改运行中的容器、volume、LangBot 安装目录或 n8n 实例而不同步仓库源码。运行时修复必须回写到对应源码或模板。
- 第三方 LangBot 本体不复制进仓库；只保留自定义插件、patch、资源、配置模板和兼容版本说明。
- 仓库内的 `skills/` 是可迁移的 Codex skill source；使用某个 skill 前先读取对应 `SKILL.md`。

## 新会话启动

每次 Codex 新会话必须先读取以下文件，然后再修改代码或配置：

1. `README.md`
2. `docs/ARCHITECTURE.md`
3. `docs/PROJECT_STATE.md`
4. `docs/CURRENT_TASK.md`
5. `.agent/state.md`

随后执行：

```sh
git status --short --branch
git log -5 --oneline --decorate
```

这些文件和 Git 状态是任务上下文的来源；不要把聊天历史当作唯一状态。

## 全局工程规则

- Secrets 永远不入库：Bot Token、API Key、Access Token、APP_SECRET、数据库密码、Tunnel Token、n8n credentials、`.env`、真实证书和业务数据都必须在仓库外恢复。
- Domain 层保持平台无关，不把 Telegram、KOOK、WhatsApp 或 LangBot API 细节写入 PUBG/domain package；平台差异放在 adapter、renderer 或 integration 层。
- LLM 只位于边界（planner、解释和自然语言入口）；核心 domain、状态转换、协议校验和结果排序必须保持 deterministic、可测试、可回滚。
- n8n 的修改必须先导出并提交对应 JSON workflow；不得只在在线实例中编辑。credentials 只能通过目标实例重新绑定。
- 第三方 LangBot 的修改必须使用可追踪的仓库 patch，并通过镜像构建应用；禁止直接在运行容器内手工改文件作为长期方案。
- 外部部署和运行时写操作必须明确使用 `--apply` 或等价确认；默认先 dry-run，canonical target 是 OrbStack `ubuntu` 内的 CasaOS。

## 开发验证与部署等级（FAST / RUNTIME / RELEASE）

- 默认先运行 `pnpm workflow:plan`（或 `./scripts/developer-workflow.sh --plan`）按 Git diff 选择
  **最低足够**的验证等级；不得把完整 release discovery 或 Docker build 当成每个 Goal 的默认动作。
- **FAST**：docs、`.agent`、tests、skills、纯逻辑和小功能。运行定向 tests、受影响 package
  typecheck、`git diff --check`，按需 secrets scan；默认禁止 Docker build、Compose restart 和 deploy。
- **RUNTIME**：`apps/agent-runtime/src/**`、`packages/homehub-domain/src/**` 与 runtime assets。运行受影响
  typecheck/build、定向 tests、`scripts/smoke-agent-runtime.sh`；RUNTIME 不意味着 Docker build，HomeHub
  source 变更不得自动升级 RELEASE。
- **RELEASE**：只有用户明确要求实际 CasaOS 部署时才执行。Dockerfile、`.dockerignore`、`package.json`
  或 `pnpm-lock.yaml` 只标记 `RELEASE_BUILD_REQUIRED`，不会自行构建。顺序为 test -> secrets -> host
  BuildKit build -> immutable commit tag -> compose update -> `docker compose up -d --no-build` -> health/smoke
  -> rollback checkpoint。
- `integrations/langbot/plugins/**` 走 plugin workflow；`integrations/langbot/patches/**` 走 LangBot image
  workflow；仅 env 改动只允许显式 `--apply` 的 no-build recreate。
- `scripts/deploy-agent-runtime.sh` 默认 dry-run；普通 `--apply` 永远使用 `--no-build`。只有明确
  `--apply --build` 才能创建并传入新的 runtime image。详细矩阵见 `docs/DEVELOPER_WORKFLOW.md`。

## Codex Goal 预算（强制）

- 仓库规则与 Codex 全局规则均禁止为 goal 手动设置、指定、增加或限制预算。
- 调用 `/goal` 或 `create_goal` 时不得传入 `token_budget`，只能使用 Codex 默认预算机制。
- 如果系统达到平台上限，应开启新的任务或会话继续；不得通过仓库规则伪造或解除平台限制。

## 阶段完成协议

每完成一个阶段任务，都要：

- 更新 `docs/CURRENT_TASK.md` 和 `docs/PROJECT_STATE.md`；
- 在 `.agent/checkpoints/` 写入带日期的 checkpoint；
- 如果产生后续任务，写入 `.agent/tasks/`；
- 跑与改动匹配的测试和 `scripts/check-secrets.sh`。
- 提交前确认 `git diff --check`、`git status` 和最近提交记录；部署或迁移阶段还要保留可回滚的 checkpoint。

## 目录与运行时

- `apps/agent-runtime` 是当前 Mastra/PUBG V3 的可运行 source-preserving 实现。
- `apps/telemetry-worker` 和 `apps/whatsapp-adapter` 是稳定边界 facade；实现暂保留在 runtime，避免搬迁时改变线上行为。
- `integrations/langbot` 只保存自定义插件、patch、WhatsApp 平台资源和示例配置；不复制 LangBot 第三方本体。
- `integrations/n8n/workflows` 是 workflow 的 Git source of truth；n8n credentials 必须在仓库外重新绑定。
- 长期 HomeLab 服务部署到 OrbStack Linux machine `ubuntu` 的 CasaOS，不默认使用 macOS host Docker。
- CasaOS compose 真正位置：`/var/lib/casaos/apps/<app>/docker-compose.yml`；持久化数据：`/DATA/AppData/<app>`；共享存储：`/Volumes/Avalon/...`。

常用命令：

```sh
orb -m ubuntu ...
orb -m ubuntu -u root ...
orb -m ubuntu -u root bash -lc 'cd /var/lib/casaos/apps/<app> && docker compose up -d --no-build'
```

## 安全边界

禁止提交 Bot Token、API Key、Access Token、APP_SECRET、数据库密码、Tunnel Token、n8n credential 值和任何 `.env`。提交前必须运行：

```sh
pnpm check:secrets
```

备份脚本生成的归档默认放在仓库外或被 `.gitignore` 忽略的位置；不要把备份归档上传到公共仓库。

## LangBot 与 n8n 工作流

- LangBot 插件源在 `integrations/langbot/plugins/`，构建产物 `.lbpkg` 被忽略；优先使用 `scripts/deploy-langbot.sh --dry-run` 预览，再显式传入 `--apply`。
- `integrations/langbot/patches/` 是第三方镜像的 build-time patch 集合。升级 LangBot 时必须重新应用、编译检查并更新兼容版本、状态文档和 checkpoint。
- n8n workflow 的 source path 是 `integrations/n8n/workflows/`；导入、导出和 credential 重绑都要记录在状态文档中。

## 任务完成定义

任务只有在以下内容都完成后才算完成：代码或配置已进入 Git、匹配的测试已运行、secrets scan 通过、`docs/CURRENT_TASK.md` 与 `docs/PROJECT_STATE.md` 已更新，并在 `.agent/checkpoints/` 写入可恢复记录。未完成项必须写入 `.agent/tasks/`，不能只留在聊天记录中。
