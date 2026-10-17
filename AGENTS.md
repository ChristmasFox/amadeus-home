# Agent Bootstrap — Lab / Gate

## 2026-10-17: solo-development rule (overrides old gates below)

Lab, Gate-Local and Intelligence Lab are maintained by one developer. GitHub PRs, required CI checks, staged candidates, per-phase approvals and full per-deploy data backups are NOT prerequisites for ordinary development. Commit finished source directly to main. GitHub Actions are optional manual diagnostics. Focused testing is developer-initiated rather than a deployment gate. Goal phase completion records progress only.

Lab runs its own main-change deployment without waiting for CI. The automatic path retains minimal Compose configuration for reverting to the previous image, not full SQLite, session, secrets or telemetry copies. Existing data and historical backups must never be erased. Lab work must not trigger Gate checks, candidate deployments, or PostgreSQL backups. Gate-Local changes can be deployed independently when Gate itself is being worked on; do not promote to staging/production automatically. Handle destructive SQL migrations separately rather than adding gates to unrelated code.

PUBG Intelligence Lab source (`apps/pubg-intelligence-lab`, `packages/pubg-intelligence`) is already in `main`. All future PUBG algorithm and private research-page development happens directly on `main`, not on the retired `research/pubg-intelligence` branch. The page remains a separately launched local/LAN research app; edits to it do not warrant a Gate deployment or OpenClaw image rebuild.

Do not rebuild a PR/CI/approval/backup gate framework in future Goals.


## Gate-Local automatic deployment invariant

For Gate-Local, **the job is to finish deployment, not to manufacture approval
exceptions**. Following green phase validation, converge legitimate stale Gate
application images automatically; execute non-destructive versioned migrations
under transaction and checkpoint; smoke-test and roll back failed application
updates. Never add hard-coded source-SHA exception lists, per-SQL approval
manifests, or repeat the CI database fixture against the running Gate-Local
host. Keep the existing single-instance target identity, data backup for schema
changes, and destructive/extension safety boundaries. This rule does not
authorize Gate-Staging/Prod promotion or touch Lab.


**Start here:** read `docs/ENGINEERING_POLICY.md` once, then the user-selected
Goal's acceptance clauses. Use `pnpm devctl goal status` to resume; do **not**
re-read the entire Goal, `CURRENT_TASK.md`, `CONTEXT.md` or old checkpoints
at every stage. `docs/CURRENT_TASK.md` is a historical task pointer, not a
replacement for an operator-selected Goal; live Git/runtime are factual sources.

Lab's default is automatic *reversible candidate* deployment after a verified
phase **only when the operator has granted one-time host-local authorization**
and the guarded release tooling approves the change. Gate-Local may also auto-deploy a reversible candidate **after its own separate one-time local opt-in**, release safety gates and explicit M2 pause clearance. Gate-Staging/Prod never auto-promote; Gate auto-deploy support must first be implemented and tested.
A Goal describes requirements, not default runtime permissions; for old Goals
with explicit authorization limits, reconcile those limits before deploying.
Controlled apply still goes through `release-lab.sh`. Never infer OS permissions
from text. This bootstrap applies to Codex and other repository-aware agents.

# Agent Monorepo 工作规则

## Lab / Gate 产品与部署命名规范

本仓库包含两条**都可开源**、采用 Kurisu SOUL 风格的 AI Agent 产品路线。代称描述产品及部署角色，**不代表代码是否公开**，也不是两种角色人格。

| 代称 | 产品定义 | 部署身份 |
| --- | --- | --- |
| **Lab** | OpenClaw **自托管 Kurisu**；社区用户可自行部署自己的 Lab | 维护者实例常驻 Mac mini / OrbStack |
| **Gate** | Vercel AI SDK **KOOK 小队服务 Kurisu**；独立多租户 SaaS | 产品身份，和运行位置无关 |
| **Gate-Local** | Gate 的本地开发、验证、试用实例 | Mac mini 独立 OrbStack Machine，M2 试用中 |
| **Gate-Staging** | Gate 的未来预发布实例 | 按需启动，独立测试身份与数据 |
| **Gate-Prod** | Gate 未来的云端生产实例 | 尚未上线、云主机尚未选定 |

- Lab 是**自托管产品路线**，不是未开源或仅维护者能部署的“私人 Agent”。Lab / Gate 两边源码可开源；**各实例的记忆、会话、文件、凭据和数据不会因源码开源而共享**。
- 在 Lab 之内 OpenClaw 是唯一 Agent runtime；Gate 是独立的 AI SDK Agent，不属于 Lab 的第二个编排器。旧“OpenClaw 唯一 Agent runtime”规则仅适用于 Lab。
- Lab 和 Gate 共享 `packages/pubg-domain` 的 PUBG 统计、时间和 Telemetry 业务语义，以及适用的 `packages/presentation` 事实展示契约；两套存储/工具适配可不同，禁止复制核心计算。
- Lab 与 Gate 的运行进程、SQLite/PostgreSQL、权限、Bot/模型/API 凭据、会话/记忆、调度及网络访问严格隔离；相同的 Kurisu 人格风格不构成跨实例数据访问授权。
- Gate 云迁移后产品名仍为 Gate，正式实例称 Gate-Prod。经授权切换完成后必须停止 Gate-Local 中使用**正式 KOOK Bot 身份**的 Gateway/Worker，禁止双活；本地可用独立测试 Bot 保留按需测试环境。
- Gate-Prod **不能默认指向现有 `amadeus-gateway` VPS**；云端主机和资源尚未决定。命名本身不构成部署、停服或数据库迁移授权。
- 以上是文档/沟通约定，无需重命名 npm 包、仓库、容器、数据库或代码符号。“Image Lab”仍是独立的生图功能名称。历史 Goal/checkpoint 不进行无意义的全局替换。

## Lab 自托管 OpenClaw 稳态边界

在 Lab 内，OpenClaw 是唯一 Agent runtime（Gate 是独立的 AI SDK 小队服务，不属于 Lab 的第二编排器）：PUBG 保持原生 plugin/domain，Product Radar、媒体整理、NAS、HomeLab、VPS、KOOK 与 Codex 通知留在原生 `plugins/amadeus`/明确外部服务及 owner outbox。旧 `docs/OPENCLAW_AMADEUS_MIGRATION_GOAL.md` 是已完成历史目标，不是运行时或新任务指令。不要恢复 LangBot/n8n/旧 Runtime、关键词路由、第二个 Agent 或第二套 sender；部署仍须外部备份、secret 保护、真实验收和可恢复 checkpoint。

## Source of Truth

- 本 Git 仓库是系统定义的唯一 source of truth。源码、插件、patch、workflow、Compose 模板、文档和 Codex 状态都必须从 Git 可重建。
- 不允许只修改运行中的容器、volume 或 CasaOS 实例而不同步仓库源码。运行时修复必须回写到对应源码或模板。
- 已退休的 LangBot、n8n、旧 Runtime 和旧通知资产不再作为 source、fallback 或部署依赖；其外部数据只在迁移 checkpoint 中保留可恢复副本。
- 仓库内的 `skills/` 是可迁移的 Codex skill source；使用某个 skill 前先读取对应 `SKILL.md`。

## 新会话启动

先读 `docs/ENGINEERING_POLICY.md` 和用户选定 Goal 的必要验收条款，运行 `pnpm devctl goal status`（新 Goal 先 `pnpm devctl goal start <path>`）；然后检查 Git 状态。不要默认整份阅读 `docs/CURRENT_TASK.md`、`docs/CONTEXT.md` 或历史日志；需核对事实时仅阅读相关段落。

## 全局工程规则

- Secrets 永远不入库：Bot Token、API Key、Access Token、APP_SECRET、数据库密码、Tunnel Token、n8n credentials、`.env`、真实证书和业务数据都必须在仓库外恢复。
- Domain 层保持平台无关，不把 Telegram、KOOK、WhatsApp 或 OpenClaw API 细节写入 PUBG/domain package；平台差异放在 plugin、adapter 或 integration 层。
- LLM 只位于边界（planner、解释和自然语言入口）；核心 domain、状态转换、协议校验和结果排序必须保持 deterministic、可测试、可回滚。
- 外部部署和运行时写操作必须明确使用 `--apply` 或等价确认；默认先 dry-run，canonical target 是本地 host profile 指定的 OrbStack CasaOS（M204 当前为 `example-node`）。
- 产品版本各自管理：Lab 的唯一版本来源是根目录 `VERSION`；Gate 的唯一版本来源是
  `apps/pubg-saas/package.json.version`。根 `package.json.version` 只描述 Monorepo 工具元数据。
- 两个产品都按标准 SemVer 使用各自的版本工具；Lab 兼容入口是
  `scripts/amadeus-version.sh bump patch|minor|major`，Gate 是
  `scripts/pubg-saas-version.sh bump patch|minor|major`。版本变更须同步该产品当前单次
  Release Notes；普通 Commit 不自动增加产品版本。
- 新正式 Tag 分别使用 `lab/vX.Y.Z` 与 `gate/vX.Y.Z`。历史 `v1.10.4` 等 Tag 保持原样；
  Git SHA + image digest 的 Candidate 不是正式 Release，也不创建产品正式 Tag。
- 正式产品 Tag 只能指向已验收且获批准的发布源码；版本工具和普通 Commit 不创建 Tag，
  不修改既有 Tag，也不代表生产已部署。

## Architecture ownership matrix

下表主要对应 Lab 的 OpenClaw 与原生插件；Gate 的 AI SDK Agent、KOOK 接入及多租户授权归 `apps/pubg-saas/`。跨产品 PUBG Domain 与展示契约分别归 `packages/pubg-domain`、`packages/presentation`。

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
- Confirm that no SOUL/AGENTS workflow text, keyword router, transport-specific business logic, second Lab runtime, or notification fallback is being introduced.

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

## 开发验证与部署入口

统一遵守 `docs/ENGINEERING_POLICY.md`，由 `pnpm devctl` 选择编辑/任务/阶段/发行验证等级。
已有 `developer-workflow.sh` 和 `release-lab.sh` 是被复用的底层执行器；
不得在每次 Commit 后默认跑全量测试或重启常驻容器。
Lab Candidate 在独立的一次性本机授权和安全门禁下按阶段自动切换；Gate-Local 也应支持**独立的一次性授权、M2 暂停解除、可恢复备份、健康验证后的自动候选部署和测试通知**，无需每阶段重复人工批准（若工具尚未实现则先实现并验证）。
Gate-Staging、Gate-Prod 的正式晋级、首次高风险数据库/pgvector 镜像切换、真实付费调用与正式发布仍需分别明确批准。两条产品部署绝不相互触发。

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
- 长期 HomeLab 服务部署到 host profile 指定的 OrbStack Linux machine（M204 当前 `example-node`）的 CasaOS，不默认使用 macOS host Docker。
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
