# 当前任务优先约束（2026-09-26）

当前 Goal 是 `docs/AMADEUS_POST_VOICE_ENGINEERING_PERFORMANCE_GOAL.md`，按 phase 顺序执行；不要为优化引入第二 Agent runtime、新 Voice 功能或放宽 timeout。Git 和 live runtime 是当前事实来源；历史报告与 checkpoint 仅供审计。旧迁移 Goal 已完成，不再是当前执行计划。

# Agent Monorepo 工作规则

## OpenClaw Amadeus 稳态边界

OpenClaw 是唯一 Agent runtime：PUBG 保持原生 plugin/domain，Product Radar、媒体整理、NAS、HomeLab、VPS、KOOK 与 Codex 通知留在原生 `plugins/amadeus`/明确外部服务及 owner outbox。旧 `docs/OPENCLAW_AMADEUS_MIGRATION_GOAL.md` 是已完成历史目标，不是运行时或新任务指令。不要恢复 LangBot/n8n/旧 Runtime、关键词路由、第二个 Agent 或第二套 sender；部署仍须外部备份、secret 保护、真实验收和可恢复 checkpoint。

## Source of Truth

- 本 Git 仓库是系统定义的唯一 source of truth。源码、插件、patch、workflow、Compose 模板、文档和 Codex 状态都必须从 Git 可重建。
- 不允许只修改运行中的容器、volume 或 CasaOS 实例而不同步仓库源码。运行时修复必须回写到对应源码或模板。
- 已退休的 LangBot、n8n、旧 Runtime 和旧通知资产不再作为 source、fallback 或部署依赖；其外部数据只在迁移 checkpoint 中保留可恢复副本。
- 仓库内的 `skills/` 是可迁移的 Codex skill source；使用某个 skill 前先读取对应 `SKILL.md`。

## 新会话启动

先读 `docs/CONTEXT.md`、`docs/CURRENT_TASK.md`，如有活动 Goal 再读其文档；然后执行 `git status --short --branch`、`git log -5 --oneline --decorate`。对具体改动按需阅读 `README.md`、`docs/ARCHITECTURE.md`、`docs/PROJECT_STATE.md`、`.agent/state.md` 及相关源码。不要将历史 diary 当成 live 指令，也不要仅依赖聊天历史。

## 全局工程规则

- Secrets 永远不入库：Bot Token、API Key、Access Token、APP_SECRET、数据库密码、Tunnel Token、n8n credentials、`.env`、真实证书和业务数据都必须在仓库外恢复。
- Domain 层保持平台无关，不把 Telegram、KOOK、WhatsApp 或 OpenClaw API 细节写入 PUBG/domain package；平台差异放在 plugin、adapter 或 integration 层。
- LLM 只位于边界（planner、解释和自然语言入口）；核心 domain、状态转换、协议校验和结果排序必须保持 deterministic、可测试、可回滚。
- 外部部署和运行时写操作必须明确使用 `--apply` 或等价确认；默认先 dry-run，canonical target 是本地 host profile 指定的 OrbStack CasaOS（M204 当前为 `nyannyan`）。
- 版本唯一来源是根目录 `VERSION`；release 只允许执行 `scripts/amadeus-version.sh bump patch`。
  patch 位范围为 `0..9`，minor 位范围为 `0..99`；`0.9.9 -> 0.10.0`，`0.99.9 -> 1.0.0`。
  `bump minor` 和 `bump major` 不支持，`RELEASE_NOTES.md` 只写当前单次 release。

## Architecture ownership matrix

| Concern | Sole owner | Boundary rule |
| --- | --- | --- |
| Persona, tone, and general conversation behavior | `integrations/openclaw/workspace/SOUL.md` | Never place capability workflow, identity policy, or time semantics here. |
| Cross-capability invariants and safety | `integrations/openclaw/workspace/AGENTS.md` | Keep this file global and platform-neutral; capability details belong to Skills. |
| Capability intent, tool ordering, and factual limits | The capability's `plugins/*/skills/*/SKILL.md` | Scope instructions to the named capability; do not create keyword routing or a second planner. |
| Deterministic domain facts and state transitions | `packages/*-domain` | No channel, OpenClaw, sender, or transport imports. |
| User-facing structured contracts and rendering | `packages/presentation` | Validate before rendering; preserve null/unknown and evidence references. |
| Native tool registration and platform adapters | `plugins/*/src` | Keep bootstrap thin; platform-specific behavior stays at the plugin boundary. |
| Owner notification delivery and retry | `plugins/amadeus/src/owner.ts` plus owner outbox | Callers provide a structured event; only the fixed owner WhatsApp path may deliver it. |

## New capability planning checklist

Before adding a capability, record the answers in `docs/CAPABILITY_TEMPLATE.md`:

- What user intents and explicit confirmation/identity boundaries does it own?
- Which deterministic domain package, native tools, external services, and Skill own each step?
- What structured result/presentation contract, evidence references, unknown states, and time semantics are required?
- Which side effects, outbox/idempotency keys, secrets, backups, and rollback checkpoints are in scope?
- Which focused tests, architecture checks, `pnpm check:secrets`, release build, and real acceptance evidence prove completion?
- Confirm that no SOUL/AGENTS workflow text, keyword router, transport-specific business logic, second runtime, or notification fallback is being introduced.

## Amadeus Gateway VPS

- 本项目的个人公网 VPS 逻辑名称为 `amadeus-gateway`，运行 Ubuntu 24.04，定位为轻量公网 Gateway，而不是 Codex 执行主机。
- Codex 运行在 Mac 控制端；VPS 运维统一通过本机 SSH alias `amadeus-gateway` 连接。需要在 VPS 执行命令时使用 `ssh amadeus-gateway ...`，不要询问或硬编码公网 IP、密码、私钥路径或私钥内容。
- 当用户在本项目上下文中说“我的 VPS”、“VPS”、“Amadeus gateway”或“gateway”，且没有指定其他服务器时，默认指 `amadeus-gateway`。
- 对明确的 VPS 运维请求，可直接通过该 SSH alias 检查日志、查看状态、安装轻量软件、修改应用配置和管理对应服务；无需再次询问主机地址、SSH 用户名或连接方式。
- 当前 VPS 资源预算为 2 vCPU / 1 GiB RAM / 20 GiB SSD。设计和部署时优先低常驻内存方案；Codex、构建任务、数据库和其他重型工作负载默认留在 Mac/HomeLab，不常驻 VPS。
- 计划用途包括 `frps`、Caddy/HTTPS 入口、个人网络服务及少量轻量基础服务。新增长期服务必须说明端口、systemd/容器管理方式、持久化位置和大致资源影响。
- 不把公网 IP、SSH 私钥、密码、Cloudflare API Token、Origin Certificate 私钥、代理凭据或其他 secret 写入 Git。域名、SSH alias、端口规划等非敏感声明式配置可以入库。
- SSH 公钥登录是远程管理生命线。禁止在未验证替代登录路径前关闭/破坏公钥认证、修改到不可达 SSH 端口、启用可能锁死当前连接的防火墙规则或删除当前授权 key。
- 对可能导致 SSH 失联、网络中断、批量数据删除、磁盘/文件系统破坏、系统无法启动或不可逆安全影响的操作，执行前必须请求用户确认。普通只读诊断和可恢复的应用级运维不需要重复确认。
- 修改防火墙时先显式保留当前 SSH 通路，再应用规则并从新的 SSH 会话验证；修改 sshd 时先 `sshd -t`/等价配置检查，再 reload，避免直接 restart 导致失联。
- VPS 是运行时目标，不是唯一 source of truth。可声明化的 Caddy、frps、systemd、部署脚本和运维文档应回写本仓库；运行时 secret 只保留在目标环境或受控 secret store。
- 任何针对 VPS 的自动化不得依赖聊天记忆中的 IP。连接细节的 canonical source 是 Mac 的 `~/.ssh/config` 中 `Host amadeus-gateway`。

## 开发验证与部署等级（FAST / RUNTIME / RELEASE）

- 默认先运行 `pnpm workflow:plan`（或 `./scripts/developer-workflow.sh --plan`）按 Git diff 选择
  **最低足够**的验证等级；不得把完整 release discovery 或 Docker build 当成每个 Goal 的默认动作。
- **FAST**：docs、`.agent`、tests、skills、纯逻辑和小功能。运行定向 tests、受影响 package
  typecheck、`git diff --check`，按需 secrets scan；默认禁止 Docker build、Compose restart 和 deploy。
- **RUNTIME**：`packages/pubg-domain/**`、`plugins/pubg/**`、`plugins/amadeus/**` 或独立 Product Radar 源码。运行受影响
  typecheck/build 和定向 tests；RUNTIME 不意味着 Docker build 或 Compose restart。
- **RELEASE**：只有用户明确要求实际 CasaOS 部署时才执行。Dockerfile、`.dockerignore`、`package.json`
  或 `pnpm-lock.yaml` 只标记 `RELEASE_BUILD_REQUIRED`，不会自行构建。顺序为 test -> secrets -> host
  BuildKit build -> immutable commit tag -> compose update -> `docker compose up -d --no-build` -> health/smoke
  -> rollback checkpoint。
- `scripts/deploy-openclaw.sh` 默认 dry-run；只有明确 `--apply` 才能切换、迁移或重建
  CasaOS。只有明确 `--apply --build` 才能创建并传入新的 OpenClaw image。

## Codex Goal 预算（强制）

- 仓库规则与 Codex 全局规则均禁止为 goal 手动设置、指定、增加或限制预算。
- 调用 `/goal` 或 `create_goal` 时不得传入 `token_budget`，只能使用 Codex 默认预算机制。
- 如果系统达到平台上限，应开启新的任务或会话继续；不得通过仓库规则伪造或解除平台限制。

## 验证与 checkpoint 分级

- 普通 FAST/RUNTIME 源码提交：只要求 focused tests、受影响的 typecheck/syntax 和 `git diff --check`；提交前按安全边界运行 `pnpm check:secrets`。不默认部署、Docker build、版本 bump、状态日记或 checkpoint。
- 只有 deploy、release、migration、storage/database mutation、security-sensitive runtime change，或其他明确需要回滚点的高风险操作才写 dated checkpoint，并更新 `docs/CURRENT_TASK.md` / `docs/PROJECT_STATE.md` 的当前事实；未完成项写 `.agent/tasks/`。
- 外部写入必须显式 apply；生产发布仍按 tests -> secrets -> immutable image -> protected checkpoint -> CasaOS switch -> health/smoke -> rollback evidence。不要削弱 secret、备份和真实验收边界。

## 目录与运行时

- `plugins/pubg` 和 `plugins/amadeus` 是当前 OpenClaw 业务 plugin；`packages/pubg-domain` 是 PUBG 领域实现。
- `integrations/openclaw`、`infra/docker/casaos/openclaw`、`apps/product-radar` 和 `infra/macos` 是当前运行定义；LangBot/n8n 执行源和旧 facade 不在当前树中。
- 长期 HomeLab 服务部署到 host profile 指定的 OrbStack Linux machine（M204 当前 `nyannyan`）的 CasaOS，不默认使用 macOS host Docker。
- CasaOS compose 真正位置：`/var/lib/casaos/apps/<app>/docker-compose.yml`；持久化数据：`/DATA/AppData/<app>`；共享存储：`/Volumes/Avalon/...`。

常用命令：

```sh
orb -m "$ORBSTACK_MACHINE" ...
orb -m "$ORBSTACK_MACHINE" -u root ...
orb -m "$ORBSTACK_MACHINE" -u root bash -lc 'cd /var/lib/casaos/apps/<app> && docker compose up -d --no-build'
```

## 安全边界

禁止提交 Bot Token、API Key、Access Token、APP_SECRET、数据库密码、Tunnel Token、n8n credential 值和任何 `.env`。提交前必须运行：

```sh
pnpm check:secrets
```

备份脚本生成的归档默认放在仓库外或被 `.gitignore` 忽略的位置；不要把备份归档上传到公共仓库。

## 已退休执行路径

LangBot、n8n、旧 Runtime、KOOK watchdog 和 Telegram/KOOK proactive sender 已从当前
source tree 与生产切换目标中删除。迁移脚本只会把外部数据库、配置和 app 定义移动到
`/DATA/AppData/openclaw/backups/<checkpoint>`，不会重新启用这些服务；媒体 adapter
保留为独立外部服务，并通过 `amadeus_media_organize` 调用。

## 任务完成定义

普通开发完成于 Git 源码与最小充分本地验证；高风险运行时阶段还需要可恢复 checkpoint、相应状态更新、secrets scan 和真实验收。Goal 完成必须以 Goal 文档逐项核对证据，不以局部 test 通过代替。
