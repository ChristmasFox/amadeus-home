# Codex Goal 执行入口

当前状态：P0–P6 已完成；P7 已完成 Runtime、LangBot 插件、生产开关、媒体边界和全会话自然语言切流。当前生产版本已上线，仍需真实 Telegram/KOOK 入站证据与一次受控回滚，完成后才可标记 `PRODUCT_COMPLETE`。

主规格：[实施计划](KURISU_AGENT_IMPLEMENTATION_PLAN.md)。必过条件：[验收矩阵](KURISU_AGENT_ACCEPTANCE.md)。

## 1. 当前全量实现与上线 Goal

先检查工作区，按既有 Git 流程取回本计划；工作区干净且位于 main 时可用 `git pull --ff-only`。有未提交改动或分叉时不得 reset/覆盖，先隔离并保留。

在该仓库的 Codex 会话中输入以下命令，继续当前 Goal，不重复已经完成的阶段：

```text
/goal 基于当前仓库和 OrbStack ubuntu/CasaOS 的真实状态，继续完成 docs/KURISU_CODEX_GOAL.md、docs/KURISU_AGENT_IMPLEMENTATION_PLAN.md 和 docs/KURISU_AGENT_ACCEPTANCE.md 的全部 Kurisu 产品目标，直到满足 PRODUCT_COMPLETE。先读取 AGENTS.md、README.md、docs/ARCHITECTURE.md、docs/PROJECT_STATE.md、docs/CURRENT_TASK.md、.agent/state.md 和最新 checkpoint，以当前 Git/源码/线上证据为准，不重做已完成工作。已明确授权：完成必要开发、提交并 push、构建并部署 CasaOS、更新 LangBot 插件和 n8n workflow，启用已实现的生产功能，让所有已接入平台的私聊和群聊普通自然语言统一进入 LangBot Native Agent + 唯一 Kurisu Gateway；保留协议命令、确定性业务规则、鉴权、审批、幂等和媒体路径安全。继续补齐 PUBG、Product Radar、HomeHub、媒体、Codex、通知和日报生产者闭环，核验真实平台、引用/图片/按钮/审批、群聊边界和一次可恢复回滚。减少耗时测试：复用已有证据，只运行改动相关的定向测试、必要 typecheck/build、secrets scan、diff check、关键线上 smoke；不得删除失败用例、降低验收标准、用 mock/HTTP 200/容器健康替代真实业务证据，也不得伪造入站。先完成所有不依赖用户输入的工作；若只剩真实平台入站等外部步骤，明确给出最短动作并保持 BLOCKED。每阶段更新 docs/CURRENT_TASK.md、docs/PROJECT_STATE.md、docs/reports/KURISU_AGENT_PROGRESS.md、.agent/state.md 和 dated checkpoint，保留 rollback。不要设置 token_budget。
```

`/goal` 是 Codex 会话内命令，不是 shell 命令。本仓库不替用户设置 Goal token 预算；若本机版本不提供该命令，将同一段目标作为普通任务输入并保留阶段 checkpoint，不擅自修改 Codex 全局配置。

## 2. 恢复同一全量任务

优先继续已有 Goal/会话；需要新会话时输入：

```text
/goal 继续当前 Kurisu 全量实现与上线任务。读取 AGENTS.md、项目启动文件、docs/KURISU_CODEX_GOAL.md、验收矩阵、最新进度和 checkpoint，核验 Git 与 CasaOS 真实状态，从第一个未完成验收门槛继续。沿用当前唯一 LangBot Native Agent + 9Router + Kurisu Gateway 架构，不重做已完成阶段；完成所有可执行部署、真实平台回归和受控回滚，外部阻塞必须如实记录，不得用 fake/provider/health 替代。只运行最低必要验证，提交并 push 所有仓库变更；不设置 token_budget。
```

## 3. 开发完成状态

P0 首先创建 `docs/reports/KURISU_AGENT_PROGRESS.md`，至少维护下表并补充证据链接：

| 阶段 | 状态 | 提交/路径 | 已通过证据 | 阻塞与下一步 |
| --- | --- | --- | --- | --- |
| P0 | COMPLETE | `docs/decisions/KURISU_AGENT_HOST.md` | Host/9Router 证据、fake/provider trace | — |
| P1 | COMPLETE | `apps/agent-runtime/src/kurisu/` | L1/L2、契约、鉴权、持久化 | — |
| P2 | COMPLETE | Kurisu read adapters/Gateway | L1/L2/L3 provider trace | — |
| P3 | COMPLETE | durable write/approval/task | 定向写工具与故障恢复测试 | — |
| P4 | COMPLETE | Codex App Server executor | 隔离仓库真实 Codex trace | — |
| P5 | COMPLETE | Runtime notification Worker | 通知/重试/去重与日报 handoff | — |
| P6 | COMPLETE | 验收报告/R01/R02 | 101 场景、R01/R02、HTTP smoke | — |
| P7 | DEPLOYED / L4_PENDING | `.agent/checkpoints/2026-09-17-kurisu-agent-p7-full-rollout.md` | Runtime、插件、开关、媒体挂载、生产 smoke | 真实平台入站与 R05 回滚 |

开发完成必须有：唯一宿主 ADR、可运行代码和非空工具、真实模型证据、所需 Codex 隔离任务证据、L1/L2 通过、L3 达标、发布 dry-run、回滚方案、状态/checkpoint 同步、secret scan、干净且已提交的本阶段差异。正常保留的无关用户修改应单独说明。

若凭据、真实生产者或必要接口不可用：完成所有不依赖它的实现/测试，保存明确 BLOCKED 条目与解除条件。此时只能报告 DEPLOYED_WITH_L4_BLOCKER 等真实状态，不能把 Goal/产品标为全部完成。不得为达到完成条件绕过访问控制。

## 4. 当前生产状态与剩余验收

生产部署授权已由当前 Goal 明确给出并已执行。当前线上已使用 immutable Runtime image、`--no-build` Compose 切换和 LangBot API 插件安装；以下命令仅用于恢复/继续未完成的真实平台验收：

```text
/goal 继续 Kurisu P7 L4 验收：在不重复无关测试、不伪造入站的前提下，核验当前已部署的 Telegram/KOOK 真实私聊与必要群聊链路，覆盖文本、引用、图片、按钮/审批、媒体预览/执行、Codex 任务回执和通知；执行一次可恢复的 R05 回滚并重新部署当前版本。每一步保留真实 tool-call、外部执行、最终送达和回滚证据，更新状态文档与 checkpoint。若缺少用户可操作的真实入站，只完成线上诊断并明确要求用户在目标私聊发送一条测试消息，不得标 PRODUCT_COMPLETE；不设置 token_budget。
```

## 5. 每阶段交付摘要

说明本阶段目标、实现位置、行为变化、测试命令与结果、真实/模拟边界、已提交 SHA、遗留风险与下一阶段。不要只报告“新增多少文件/多少测试”；必须对应验收 ID 和实际目标。
