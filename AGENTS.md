# Agent Monorepo 工作规则

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
orb -m ubuntu -u root bash -lc 'cd /var/lib/casaos/apps/<app> && docker compose up -d'
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
