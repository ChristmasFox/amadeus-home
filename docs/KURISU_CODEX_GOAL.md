# Codex Goal 执行入口

当前状态：计划已编写，P0–P7 尚未实施。先使用开发 Goal；上线使用后面的独立部署 Goal。

主规格：[实施计划](KURISU_AGENT_IMPLEMENTATION_PLAN.md)。必过条件：[验收矩阵](KURISU_AGENT_ACCEPTANCE.md)。

## 1. 在本机仓库启动开发

先检查工作区，按既有 Git 流程取回本计划；工作区干净且位于 main 时可用 `git pull --ff-only`。有未提交改动或分叉时不得 reset/覆盖，先隔离并保留。

在该仓库的 Codex 会话中输入：

```text
/goal 按 docs/KURISU_AGENT_IMPLEMENTATION_PLAN.md 和 docs/KURISU_AGENT_ACCEPTANCE.md 实施 Kurisu 统一 Agent，完成 P0–P6 的实现、本地验证与 Release 准备。先读取 AGENTS.md 要求的启动文件并检查 Git 状态；优先复用现有 LangBot 主 Agent 与 9Router 配置，按 P0 实测门槛固定唯一宿主，后续只实现选中的路径。保留 PUBG/HomeHub/Radar/n8n 业务底座，统一结构化工具、上下文、持久化任务、Codex Executor 与可靠通知，消除已迁移自然语言入口的关键词路由及重复决策。按阶段实现并提交，维护进度报告、状态文档、验收证据和 checkpoint，继续完成所有未阻塞工作，不停在分析或骨架。禁止删除失败用例、降低验收标准、伪造完成状态、绕过权限或擅改模型。仅在实质架构变更或无法解除的必要外部阻塞时请求用户决策。本 Goal 不授权生产部署、生产写操作或向真实聊天发送测试消息；不设置 token_budget。完成条件以两份规格和本文完成状态为准。
```

`/goal` 是 Codex 会话内命令，不是 shell 命令。本仓库不替用户设置 Goal token 预算；若本机版本不提供该命令，将同一段目标作为普通任务输入并保留阶段 checkpoint，不擅自修改 Codex 全局配置。

## 2. 恢复同一实施任务

优先继续已有 Goal/会话；需要新会话时输入：

```text
/goal 继续本仓库 Kurisu 统一 Agent 的 P0–P6 开发。读取 AGENTS.md、docs/KURISU_AGENT_IMPLEMENTATION_PLAN.md、docs/KURISU_AGENT_ACCEPTANCE.md、docs/reports/KURISU_AGENT_PROGRESS.md（存在时）及最新 checkpoint，核验 Git 与实际证据，从第一个未完成门槛继续。沿用已记录的宿主 ADR 和模型配置，不重做已完成阶段，不把已知阻塞当完成，不擅自部署或发真实消息。完成所有可执行工作并逐阶段提交；不设置 token_budget。
```

## 3. 开发完成状态

P0 首先创建 `docs/reports/KURISU_AGENT_PROGRESS.md`，至少维护下表并补充证据链接：

| 阶段 | 状态 | 提交/路径 | 已通过证据 | 阻塞与下一步 |
| --- | --- | --- | --- | --- |
| P0 | NOT_STARTED | — | — | 核对本机主 Agent 能力 |
| P1 | NOT_STARTED | — | — | — |
| P2 | NOT_STARTED | — | — | — |
| P3 | NOT_STARTED | — | — | — |
| P4 | NOT_STARTED | — | — | — |
| P5 | NOT_STARTED | — | — | — |
| P6 | NOT_STARTED | — | — | — |
| P7 | NOT_AUTHORIZED | — | — | 单独部署 Goal |

开发完成必须有：唯一宿主 ADR、可运行代码和非空工具、真实模型证据、所需 Codex 隔离任务证据、L1/L2 通过、L3 达标、发布 dry-run、回滚方案、状态/checkpoint 同步、secret scan、干净且已提交的本阶段差异。正常保留的无关用户修改应单独说明。

若凭据、真实生产者或必要接口不可用：完成所有不依赖它的实现/测试，保存明确 BLOCKED 条目与解除条件。此时只能报告 CODE_COMPLETE_WITH_BLOCKERS 等真实状态，不能把 Goal/产品标为全部完成。不得为达到完成条件绕过访问控制。

## 4. 开发验收后，再由用户启动部署 Goal

以下命令包含真实部署与针对管理员私聊的测试授权。不要在开发 Goal 内自行复制执行；用户选择执行此命令才启用这一阶段。

```text
/goal 在核验 docs/KURISU_AGENT_IMPLEMENTATION_PLAN.md 的 P0–P6、docs/KURISU_AGENT_ACCEPTANCE.md 的 L1–L3 和实际代码已达标后，执行 P7 的 CasaOS RELEASE 与管理员 Telegram DM 灰度。遵守 AGENTS.md 的 immutable image、插件 preview/install、no-build compose、备份和回滚规则；先 dry-run，再 apply。本 Goal 授权受控部署和向已配置、经核验的管理员私聊发送必要测试通知，不授权向群聊或其他人发送测试消息，不授权删除用户真实 Watch、媒体、数据或扩大 Codex 权限。使用隔离测试对象验证引用、图文、审批、任务恢复、通知补发与回滚；需要真实用户入站时明确提供最短测试步骤并记录待验收，不伪造。保持未迁移 KOOK 功能，证据完整后才标 PRODUCT_COMPLETE；不设置 token_budget。
```

## 5. 每阶段交付摘要

说明本阶段目标、实现位置、行为变化、测试命令与结果、真实/模拟边界、已提交 SHA、遗留风险与下一阶段。不要只报告“新增多少文件/多少测试”；必须对应验收 ID 和实际目标。
