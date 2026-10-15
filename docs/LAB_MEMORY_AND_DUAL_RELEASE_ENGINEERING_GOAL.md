# Lab 记忆恢复与 Lab / Gate 双产品 Release Engineering Goal

> 日期：2026-10-15（Asia/Shanghai）
>
> 状态：**APPROVED_FOR_SOURCE_IMPLEMENTATION / RUNTIME_APPLY_NOT_AUTHORIZED**
>
> 执行入口：`/goal docs/LAB_MEMORY_AND_DUAL_RELEASE_ENGINEERING_GOAL.md`
>
> 范围：Lab Memory Core / Embedding / Dreaming 修复，Lab 发布漂移治理，Lab 与 Gate 独立版本、构建、CI、部署追踪及回滚。**不执行真实生产发布，不关闭 Gate-Local，不变更凭据或数据库内容**。
>
> 本 Goal 被操作者显式选择时优先执行；`docs/CURRENT_TASK.md` 中尚未关闭的 Gate M2 验收及历史 Checkpoint 继续有效，**不代表 M2 已完成**。不要删除、替换或伪造已提交的 M2 实现与证据。

## 0. 目标、事实基线和非目标

### 双产品身份

- **Lab**：OpenClaw 自托管 Kurisu；任何社区用户均可独立部署，不等于未开源产品。维护者实例在 Mac mini 的独立 OrbStack / CasaOS 环境。
- **Gate**：基于 Vercel AI SDK 的 KOOK 小队服务 Kurisu。`Gate-Local` 是当前本地 M2 测试环境；`Gate-Staging`、`Gate-Prod` 是未来的独立环境，**Gate-Prod 目前未上线**。
- 两条路线可以共享 Kurisu 的公开人格风格、`packages/pubg-domain` 和适用的 `packages/presentation`，但**不能共享正在运行的数据库、会话/记忆、凭据、身份权限、模型路由、队列或 Worker**。
- 命名对开发与发布有效，**无需批量重命名 npm 包、仓库、Docker 容器、数据库或历史文件**。“Image Lab”仍是独立的生图功能。
- 云部署 Gate-Prod 不默认使用现有 `amadeus-gateway` VPS；未获得明确授权前不得采购、迁移或切换服务。

### 仓库审计起点（以下是源码事实，不是实时运行证明）

| 项目 | 2026-10-15 仓库状态 | 待确认 |
| --- | --- | --- |
| HEAD | `4a5734826eca479f59a2fd039fd12f9ff5d03580`（Memory KNN / Dreaming patch） | 开始执行前重新读取最新 HEAD，不能固定使用此 SHA 开发 |
| Lab 版本 | 根目录 `VERSION=1.10.4`，`RELEASE_NOTES.md` 对应此版 | 运行中镜像、真实版本与最后一次正式发布是否一致 |
| Lab 最后已记录正式发布 | 10-10 `.agent/checkpoints/2026-10-10-amadeus-1.10.4-vps-traffic-fuse-source-release.md` | 10-10 之后是否有 candidate、Compose 直改或其他合法/非法切换 |
| Gate 版本 | `apps/pubg-saas/package.json` 为 `0.1.0`；构建/部署主要以 Git SHA 定位 | 尚无完成的产品级 Release Registry / Gate-Prod |
| Gate M2 | 实现已经多次提交，并有真实 KOOK 连接、部分用户实测及恢复演练 | 最终真人流程、额度/持续负载、调度备份、云恢复与 Go/No-Go 仍未签署 |
| Lab 记忆 | `scripts/patch-openclaw-memory-core.mjs`、Dockerfile、`openclaw.json.example` 已有首次修复 | 插件加载、真实 Embedding、KNN、索引、Dreaming 落盘尚无端到端通过证据 |

**非目标**：重写 OpenClaw、替换 AI SDK、恢复 LangBot、重构 PUBG Domain、引入 Kubernetes、立即推送公开镜像、部署 Gate-Prod、同时启动两个使用正式 KOOK Bot Token 的 Gateway，或为了追版本号而重新部署所有服务。

## 1. 执行纪律与操作权限

1. 先读取 `AGENTS.md`、`docs/CONTEXT.md`、`docs/CURRENT_TASK.md`、原 Gate Goal、`docs/DEVELOPER_WORKFLOW.md`、现有部署脚本和最新 Git，再核对真实运行时；**历史记录不等于现状**。
2. 允许：仓库源码、测试、CI、发行脚本、文档的实现、无副作用 dry-run / 本地 fixture 测试、提交 Git。使用小而可审计的 Commit，保留已有 Gate M2 源码和 Checkpoint。
3. **只读环境审计**：仅获取必要的版本、镜像 SHA/Digest、容器状态、索引状态、任务历史、错误类型和已脱敏配置元数据。不得输出 Key、JID、私人文本、群成员、真实密钥文件内容；Git 提交不能泄露 HomeLab 真实标识。
4. **需要单独、明确授权**：安装/重启/替换现有 Lab 或 Gate-Local 容器、直接 `docker compose up/down`、生产 OpenClaw `--apply`、真实 DB 写入/索引重建、修改运行时 Embedding/9Router 配置、任意生产 Cron/Timer、调用计费的真实 Embedding、正式发版、推送或签名产品 Tag、停止 Gate 服务、切换云主机。
5. 对真实内存检索与 Dreaming 验收，可先提交无副作用脚本、fixture 和**逐条列明影响的待授权验收命令**；无授权时标记 `BLOCKED_OPERATOR_AUTHORIZATION`，不能将 Mock 成功当作真实修复。
6. 备份前不执行状态迁移；不得删除、覆盖、重建包含 318.8 MiB 历史状态的 SQLite、WAL、OpenClaw session、Workspace、`MEMORY.md`、`USER.md` 或生产 PostgreSQL Volume。
7. 任何生产失败均应 fail closed 并报告；不可静默跳过隔离、索引错误、镜像源校验或发布门禁。

## 2. P0 — 双环境基线审计与冻结契约

### Lab 部署漂移（只读）

- 从仓库追踪 10-10 正式 `1.10.4` 发布后对 `VERSION`、`RELEASE_NOTES.md`、`deploy-openclaw.sh`、镜像构建输入、OpenClaw Memory Core 相关源码的变更。
- 从受控 host profile 找到**真实 Lab**；列出正在运行的镜像名、`/opt/amadeus/VERSION`、完整 Git SHA、image ID / digest、创建时间、Compose service/volume、近期候选/发布记录和 Checkpoint。检查是否存在多个 Lab 消费者、孤儿容器或直接 Compose 改写。
- 区分：`source drift`（Git 前进）、`build drift`（镜像没有对应代码）、`runtime drift`（容器与已批准镜像不同）、`release drift`（已改变运行态但没有 Candidate/Release Manifest）、`config drift`（运行模板与 Git 声明不一致）。
- 回溯 `--candidate`、`--apply --build-auto`、`--no-build`、`--lineage-bridge` 的真实规则；不要预设“10-10 之后确实没有部署”，必须用生产证据论证。
- 针对 `is_openclaw_image_path()` 的遗漏给出复现：当前新增的 `scripts/patch-openclaw-memory-core.mjs` 没进入旧的显式依赖匹配，独立修改这一个构建输入是否会使自动构建误判无需更新；同样扫描 `COPY` / `RUN` 依赖链及 Product Radar。
- 保留干净、脱敏的审计报告，标明观测窗口、证据来源、无法访问的事实及真实根因。

### Gate M2 状态

- 使用 `docs/PUBG_KOOK_SAAS_V0_1_GOAL.md`、`docs/CURRENT_TASK.md`、最近的 M2 Checkpoint 作为已完成源码工作的证据，**不重复实现、不重新开始 M2**。
- 冻结新增 M2 产品需求，允许必要的兼容回归；原人工 KOOK 测试/容量/正式验收仍为独立待办。
- Gate-Local 的 KOOK Gateway/Worker、PostgreSQL、9Router 与 Bot 身份在本 Goal 下默认保持原样。

**P0 Exit**：一份版本/运行/构建来源矩阵和可复现漂移成因；明确哪部分仅观察、哪部分须授权；无运行时写操作。

## 3. P1 — Lab Memory Core 端到端修复（优先）

起点为 `4a57348` 的 2026.9.4 版本钉死补丁，不等于“已修好”。检查上游 OpenClaw 该**实际运行版本**的编译产物、插件清单、Slot、配置 Schema 和生命周期。禁止仅凭示例文档推测能力。

### P1.1 插件与配置

1. 核实 `plugins.allow` 是限制列表时 `memory-core` 是否被实际允许、加载并成为预期 memory provider；检查 `plugins.entries.memory-core`、`memory.search`、Memory Slot 与实际运行配置之间的关系。
2. 核实 `openclaw_prepare.py` 的合并规则确实把模板的新 memory 配置安全落到最终运行态，并且不会覆盖保留的用户数据/密钥。
3. 检查 `memory.search.provider=openai-compatible`、`remote.baseUrl`、SecretRef、`sources`、`rememberAcrossConversations` 是否为该版本支持且生效的字段；不接受“JSON 语法合法”替代有效性验证。
4. 凭据只通过现有安全注入路径提供，绝不写进仓库、日志、候选镜像或测试快照。

### P1.2 Embedding、KNN 与索引

1. 先查询 9Router 当前真实 `/v1/embeddings` 能力、路由映射、所授权模型的**实际 ID**、向量维度及计费/错误响应；现有 `Qwen/qwen3.7-text-embedding-flash` **仅为待验证配置**，不可把聊天模型可调用当作嵌入接口可用。
2. 如果 9Router 不具备该能力，提供独立受保护云端 Embedding 或资源受控本地 Embedding 的选择与影响，**请操作者选择**，不要擅自更换模型、开通收费服务或引入常驻 ML 负载。
3. 审查 `sqlite-vec` KNN Worker 与 `LD_LIBRARY_PATH` 注入逻辑，验证 arm64/amd64 兼容性、加载失败信息、最小环境继承、幂等和 upstream pin/hash 不匹配时 fail closed；尽量通过受支持配置/上游修复减少未来私有核心热补丁。
4. 提供安全的索引重建及恢复剧本（备份、运行时索引路径、embedding dimension、FTS/KNN 状态、失败回滚）；首次真正触发计费 Embedding 和有状态重建之前要求授权。
5. 真实验收必须同时覆盖：关键词 FTS、不同措辞但语义相近的向量命中、融合检索、修改文件后的增量刷新、`dirty` 清除、重建后断电/重启恢复。记录结果数/错误代码/耗时等脱敏证据，**不输出记忆原文**。
6. 显式控制失败模式：Embedding 上游不可用时用户得到清晰的功能状态，不得捏造有语义记忆；保留已有 FTS 能力且不能暗中绕过授权。

### P1.3 Dreaming / 长期记忆与隔离

1. 核实 Memory Core 的 Dreaming 是否**加载、启用、调度、实际执行并有候选语料**；从时区 `Asia/Shanghai`、计划 03:00、Cron/Heartbeat 状态、执行日志、Session Ingestion、`DREAMS.md` 与记忆持久文件逐级定位。0 日记不能直接定性为 Cron 坏了，可能是没有符合条件的输入。
2. 读取现有 `memoryPolicy.allowedChannels`、`allowlistedDirectPeerFiles`、`excludeSessions`，审查 `classifyDreamingSessionAdmission`；当前 WhatsApp Owner allowlist 与**仅用 `telegram + direct` 判定 Telegram 私聊**的宽松边界需重点修正。
3. 对 WhatsApp、Telegram、其他未来渠道建立同一套**可信用户/会话白名单准入**。默认拒绝非 Owner、群组、频道、不明元数据、跨租户 / 跨成员输入；不允许消息文本、模型参数或外部内容决定“我就是 Owner”。
4. 在**读取 transcript 之前**校验来源权限；共享 `MEMORY.md` 不得混入非授权聊天；`rememberAcrossConversations=false` 不可作为 Dreaming 自动摄取的授权替代。
5. 记忆写入须考虑可信来源、幂等、去重、冲突更新、纠错/移除能力、隐私与 prompt injection；不得把聊天中的外部“指令”直接升级为永久系统规则。
6. 先用合成会话及脱敏 fixture 测试 allow/deny、缺失/损坏 allowlist、被撤销授权、混合 Telegram/WhatsApp、群聊污染以及来源隔离；真实整理/文件写入需单独授权。
7. 无合格语料时可以`SKIPPED_NO_ELIGIBLE_CORPUS`，但必须有实际执行证据，不可直接认定成功；有合格语料时须能观察到受限的候选/日记/检索更新，且无其他来源混入。

**P1 Exit**：
- `SOURCE_FIXED`：补丁、配置、测试和单独列明的验证命令准备完成；
- `LIVE_VERIFIED`：只在真实插件加载、真实 Embedding、重建后的 KNN/FTS、Dreaming 的调度/落盘及会话隔离全部有证据时打勾；
- 外部授权未给时停在 `SOURCE_FIXED + BLOCKED_OPERATOR_AUTHORIZATION`，**不能写“Lab 长期记忆已完全修好”**。

## 4. P2 — 两个产品的独立 SemVer 与 Release 身份

### Lab

- 保留根 `VERSION=1.10.4` 及原 `RELEASE_NOTES.md` 的历史和当前单次发布语义，明确**根 VERSION 只代表 Lab 产品**；根 `package.json.version=1.0.1` 为 Monorepo 工具元数据，不作为 Lab/Gate 发布版本。
- 在兼容旧运行态的前提下，将 `scripts/amadeus-version.sh` 改为正常 SemVer：`patch` 增 patch，`minor` 增 minor 并归零 patch，`major` 增 major 并归零 minor/patch；取消旧“patch 到 9 自动进位”的自定义算法。必要时继续对 prerelease 做显式区分，不得改变既有正式版本序列。
- 后续**正式** Lab Release Tag 采用 `lab/vX.Y.Z`。无现场证据不创建历史 Tag，也不能因为 Git 前进就在生产里将 VERSION 虚报为已发布。
- 保留旧 `Amadeus 1.10.x` 用户可见通知、正式 Release Notes、备份/检查/回滚逻辑。Lab 首个候选下一正式发行版可以是 `1.10.5`，但是否实际发行取决于全部门禁与操作者授权。

### Gate

- 以 `apps/pubg-saas/package.json` 中 `0.1.0` 为 Gate 产品版本来源，新增对应的**独立** Gate Release Notes / 校验命令 / 正式 Tag `gate/vX.Y.Z`。
- Gate-Local 继续使用 Git SHA + digest 的 Candidate 身份；`Gate-Staging` / `Gate-Prod` 使用**已验证的相同不可变镜像 digest**晋级，不因环境不同重编译。
- `0.1.0` 是当前开发基线，不代表 M2 已验收或 Gate-Prod 已发布；正式发行、公共 Registry 发布、KOOK 正式 Bot cutover、云端资源与预算均有独立批准门禁。
- Gateway / Worker / Migrator 必须对应同一兼容构建和数据库 Schema（允许明确说明的受控兼容窗口）。迁移要包含预检查、备份、幂等执行、失败恢复和向前/向后兼容性判断；**不把回滚简化为强制恢复旧 PG Volume**。

### 两端通用

- 普通代码 Commit 不自动增加产品版本。开发构建显示 `<version>-dev+g<sha>`，Candidate 可以是 `<next-version>-rc.<n>` 等可追踪标签，但**不得声称是正式 release**。OCI Tag 是便捷入口，**Digest 才是部署唯一身份**。
- 产品 Release Tag 只指向真正已签署的发布源码；禁止修改已有 Tag 或用 Tag / 版本字符串隐瞒运行中的 Candidate。
- 共用 Domain / Presentation 改动需触发**两端 CI 回归**，但 Lab/Gate 各自决定何时基于哪个 Commit 正式发布，不要求同步涨版本。
- 将根 `AGENTS.md` 的“VERSION 是整个项目唯一来源、只能 bump patch”更正为**分产品规则**，同步 `docs/DEVELOPER_WORKFLOW.md`、README/架构、帮助与测试。
- 优先保留现有 Lab/Amadeus CLI 和部署工具，只增产品级入口和兼容包装；避免破坏历史脚本、CasaOS 运维工具及第三方使用者。

**P2 Exit**：两个版本来源互不干扰、SemVer 迁移与老版本兼容测试通过、正式与候选 Tag/Notes/构建身份可以清晰辨认；**此阶段不创建正式 Tag、不提升生产版本**。

## 5. P3 — 可审计的发布系统、构建影响分析与漂移检测

### 唯一受支持的受控入口

- 为 Lab / Gate 实现清晰的产品级发布 CLI，例如 `scripts/release-lab.sh` 与 `scripts/release-gate.sh`（名称可以因现有结构调整），提供 `plan`、`verify`、`candidate`、`release`、`status`、`rollback-plan` 等直观子命令。默认只读/dry-run；写入必须显式 `--apply` 并检查授权。
- Lab 入口**包装**现有 `scripts/deploy-openclaw.sh` 的版本门禁、备份、通知、CasaOS 切换和回滚能力，不能实现一条绕开保护的第二部署通道。
- Gate 独立入口复用 `infra/pubg-saas/`、`scripts/pubg-saas-*` 的已有安全机制，不改变 M2 测试机器当前实例。对公共 MIGRATOR / Gateway / Worker 与外部依赖制定清晰的切换顺序。
- 禁止将直接 `docker compose up -d` 宣称为合规正式 Release；但开发测试的临时隔离环境允许按 M2 既有规范运行。

### Release / Deployment Manifest（机器可读）

每次正式发布、候选和回滚都要记录可脱敏、可审计的 `product`、`environment`、`status`、`version`、`gitSha`（完整）、`imageDigests`（列出所有受控镜像）、`builtAt` / `deployedAt`、`schemaVersion`（适用时）、`checkpointRef`、`actor/approvalRef`（非机密标识）、`validationRef`。分离：
- Git 源码事实；
- 被构建的产物与 SBOM/OCI labels（至少源码 revision、产品 version、构建时间、digest；不要将密钥烧进镜像）；
- 实际运行的容器/Compose 与持久化状态；
- 最后一次经批准的发布声明。

本地 manifest 不应被当作事实权威：`status` 必须再次读取**实际运行中的 digest 与健康状态**核对。公开 Git 中仅存模板/脱敏证明，生产实例的环境记录受控存储，且不得包含实际凭据或隐私。

### Candidate / 回滚 / 反漂移

- Candidate 与正式发行分别审计：Candidate 允许短期跑在真实单实例上，但必须显式显示未正式发布、来源 SHA / digest、回滚 checkpoint、期限与维护者批准。默认**48 小时为过期提醒阈值，非强制自动停服**；正式转正需要版本门禁和验收，不得“仅改标签”。
- 在已有 `--candidate`、`--lineage-bridge` 行为上补齐证据和 fail-closed 测试，绝不弱化单实例限制。Git 历史重写造成 SHA 不可达时，按已批准的 lineage 桥接流程单独证明，不能自动 `--force`。
- 增加 `doctor / status` 类**只读漂移检测**：比较 Git Release、image provenance、live digest、Compose、manifest、配置版本及候选有效期；输出 `IN_SYNC` / `UNRELEASED_CANDIDATE` / `SOURCE_DRIFT` / `IMAGE_DRIFT` / `RUNTIME_DRIFT` / `UNKNOWN` 等明确且不会误判的状态。
- 漂移可按需定期报告与提醒，但**不得自动重启、覆盖现场、回滚或推送未批准版本**。任何恢复需要人工确认与一条明确审批路径。
- 修复 `--build-auto` 新文件漏判：为 Docker `COPY/RUN`、pnpm workspace/build inputs、共享依赖和部署模板建立维护成本低的影响分析；对于不能确定依赖的情形，宁可**保守构建**。至少复现 Memory Core 单文件修改必须触发 OpenClaw 重建，Lab/Gate Domain 修改分别触发双方测试/候选构建。
- 对镜像多架构/一致性进行必要验证；不要要求每个 README 或普通 commit 都全量 Docker 构建。
- 如 CI 使用 GitHub Actions，PR 仅 `verify`/构建模拟/测试；真正的 Tag、Registry 发布和正式环境部署需专用受保护触发器、审批/环境权限，不能把 `push main` 当成部署授权。

**P3 Exit**：CLI dry-run/权限保护、版本源归属、镜像来源与依赖变更、Candidate/Release/回滚状态、漂移探测的合成测试均通过；在**不触碰真实运行服务**的前提下生成可复验的演练报告。

## 6. P4 — 测试、兼容与交付证据

至少覆盖下面的验收矩阵：

| 测试主题 | 必须证明 | 可接受的证据 |
| --- | --- | --- |
| 插件启用 | Memory Core 在当前 OpenClaw 版本确实有效加载，错误配置 fail closed | 真实只读 plugin/config status；fixture schema 测试 |
| Embedding | 9Router 模型/鉴权/维度正确；失效时不宣称语义可用 | 经批准的真实 API 测试 + 安全错误用例 |
| KNN / FTS | 同义改写向量可命中，关键词不回退丢失；索引重建/dirty 增量 | 真实安全索引验收（单独授权）+ 本地 fixture |
| Dreaming | 北京时间调度、候选摄取、持久结果、缺语料正确 SKIP | 受控实时/模拟时钟 + 经过批准的真实结果 |
| 隔离 | 非 Owner Telegram/WhatsApp 私聊、群聊、未知 metadata 不可污染长期记忆 | before-read admission fixture 与拒绝路径 |
| SemVer | Lab `1.10.4` -> `1.10.5`、minor、major；Gate `0.1.0` 的独立版本路径 | 不改变仓库版本文件的沙盒测试 |
| 构建影响 | 单独修改 Memory Core patch 会触发 Lab 重建；Domain 修改触发双回归 | 基于 Git diff 的 fixture / 临时提交测试 |
| 来源与部署 | SHA、digest、manifest、live instance 不匹配必检测；无授权不能执行 apply | 只读 doctor + candidate/release dry-run |
| 回滚与数据 | 不覆盖 OpenClaw SQLite / MEMORY、不中断 Gate PG；迁移要有恢复计划 | 合成状态、恢复练习与受控备份验证 |
| 双产品回归 | Lab WhatsApp/Telegram/PUBG/语音/生图/通知、Gate KOOK/AI SDK/Worker/PG | 有针对性的源码测试；真实验收另列 |

需按变更范围运行 `pnpm workflow:plan` 与对应 Lab/Gate build、typecheck、tests、架构/秘密检查、补丁测试、Git diff 检查。保持现有 Gate M2 PG 测试和共享 Domain 黄金行为。尽量将 Memory Core 单测和版本门禁纳入专门 CI，以确保未来不会只在生产发布时才发现失败。

真实环境观察与合成/模拟结果在报告中分开列示：`SOURCE_TESTED`、`BUILD_VERIFIED`、`LIVE_VERIFIED`、`RELEASED` 是不同状态。不能将没有触发的 Dreaming、没有真实请求的模型或尚未完成的人类 KOOK 验收写作已通过。

## 7. 交付、Phase Exit 与中断/恢复

按 P0 → P1 → P2 → P3 → P4 顺序执行，允许实现代码时分成多个小 Commit。**同一个 Goal 执行到需要授权的真实读写时不得卡死其它可独立推进的源码/CI 工作**；记录阻塞并继续不产生副作用的阶段，最终在授权门禁处停止。

每阶段完成后提供：
- 改动文件、Commit SHA、对应 issue/根因、验证命令和结果；
- 原行为/新行为，最少一项反例证明错误不能复发；
- 未解决的问题、已知限制、风险和 rollback / migration notes；
- 是否发生运行时写操作（默认 `none`）。

最终交付：

1. **Lab 漂移根因报告**：最后正式版本与实际镜像 SHA/digest/manifest 对照，确认或排除 candidate/手动 Compose 的证据；
2. **Memory Core 修复报告**：插件、Embedding、KNN、FTS、Dreaming、会话准入的源码和真实验收状态；
3. **独立版本说明**：Lab / Gate 产品版本源、SemVer / Tag / release notes / CI、升级与 rollback 规则；
4. **运行手册**：新命令的 `--help` / dry-run 实例、Candidate 转正与 Gate-Local 晋级的逐步流程；
5. **自动化测试证据**：架构、隐私、两端回归、依赖重建以及失败注入测试；
6. **待操作者审批清单**：逐条说明实际容器切换、Embeddings 计费、索引/记忆重建、正式发版、Gate 云迁移等的影响与回滚；
7. **Gate M2 原状态保持**：仍以现有 M2 Goal 的真实 KOOK 人工验收和 Phase 7 Go/No-Go 为准；**本 Goal 完成不自动等于 M2 完成**。

### 最后的 Release Gate（不包含在本次默认授权内）

只有在操作者明确批准且真实先决条件均通过后，才考虑以**Lab 1.10.5 或依最终范围确定的更高 SemVer**正式发布，生成准确的一次性 Release Notes、不可变镜像/digest、可审计 Tag、受保护备份与回滚点，并通过原 CasaOS 受控部署路径及 WhatsApp 通知。若 P1 实验性补丁尚未有 live 证据，不强行生产切换。

Gate `0.1.0` 的正式产品发布应与 M2 验收/正式授权关联；Gate-Prod 未上线，不得在本次源码工程化时人为制造上线记录或挪用现有 VPS。

**完成判定**：源码/CI/CLI 可以被证明不会再静默出现未记账的版本和镜像漂移，且 Memory Core 的安全修复达到明确的可验证状态；任何需要人工授权或尚未完成的真实运行验收都被诚实保留为开放门禁。
