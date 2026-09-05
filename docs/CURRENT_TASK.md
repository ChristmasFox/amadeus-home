# Current Task

更新时间：2026-09-05（Asia/Shanghai）

## 当前阶段

**HomeHub V1 — 代码实现与验证完成；WhatsApp 接入继续暂缓**

HomeHub V1 已完成 Git source-of-truth 中的 domain、runtime facade、HTTP 接线、服务诊断、
确认式操作、审计、上下文和安全媒体整理预览/执行流程。尚未在 OrbStack ubuntu/CasaOS
真实运行时执行部署或平台入站烟测；该项作为后续人工任务保留。

Meta WhatsApp Cloud API 的商业版能力是接入稳定性与合规的必要前提。
当前开源版限制与平台变更频率较高，暂不继续投入实现和部署。

## HomeHub V1 完成清单

- [x] 新增 `packages/homehub-domain`，包含 schema、服务注册、主机采集、诊断、操作授权、上下文和审计。
- [x] 在 `apps/agent-runtime` 接入 HomeHub runtime、HTTP endpoint 和 PUBG/HomeHub 路由分流。
- [x] 对高风险服务保留确认门槛，操作结果执行后验证并写入审计日志。
- [x] 接入媒体整理的明确目标、预览、确认、备份、允许目录约束和目标冲突拒绝流程。
- [x] 增加 HomeHub 与媒体整理回归测试，并修复默认请求字段、查询分类和高风险授权顺序问题。
- [x] 完成 typecheck、build、runtime tests、legacy-v2 tests、secret scan 和 diff 检查。

## 完成清单

- [x] **Monorepo Migration Phase**
  - [x] 建立 pnpm workspace monorepo 结构
  - [x] 归档 Mastra/PUBG、Telemetry、Platform Adapter、WhatsApp 和 V2 domain
  - [x] 归档 LangBot 自定义插件、patch、资源和兼容说明
  - [x] 归档 n8n workflow JSON 与 credential placeholder
  - [x] 提供 CasaOS/Docker、Cloudflare、macOS 脱敏模板
  - [x] 建立 bootstrap.sh、doctor.sh、backup.sh、restore.sh
  - [x] 建立 check-secrets.sh、.gitignore、.env.example
  - [x] 建立 README、架构、状态、决策、清单和 checkpoint
  - [x] GitHub 远程配置并验证推送

- [x] **Codex Engineering Specifications Phase**
  - [x] 完善 AGENTS.md 为全局工程规则
  - [x] 创建 4 个可迁移的 Codex Skills（agent-checkpoint、langbot-development、n8n-workflow-development、release-and-migration）
  - [x] 新增 docs/PROJECT_MAP.md 说明目录职责
  - [x] 新增 scripts/deploy-langbot.sh 实现 Git-first 部署流程
  - [x] 更新 README.md 反映 GitHub 配置和部署说明
  - [x] 创建工程规范完成 checkpoint（.agent/checkpoints/2026-09-05-codex-engineering-specs.md）

- [x] **WhatsApp 接入暂停 Phase**
  - [x] 在 docs/DECISIONS.md 记录暂缓原因和恢复条件
  - [x] 在 docs/PROJECT_STATE.md 更新 WhatsApp 接入状态
  - [x] 确认 WhatsApp 代码不影响 KOOK / Telegram runtime
  - [x] 确认无默认启用配置，代码仅作为静态导出
  - [x] 保留 Cloudflare Tunnel 配置用于未来 Webhook / HomeLab API
  - [x] 保留已完成的 Adapter/实验代码作为 future integration reference

## 暂缓原因

Meta WhatsApp Cloud API 的商业版能力（如 webhook 批量验证、会话模板、高并发消息队列）是接入稳定性与合规的必要前提。当前开源版限制与平台变更频率较高，暂不继续投入实现和部署。

详见 docs/DECISIONS.md 的"2026-09-05：WhatsApp 接入暂缓"章节。

## 保留的代码和配置

- apps/whatsapp-adapter：Meta Cloud API 的 webhook 验签、入站消息归一化、文本拆分和发送器边界 facade
- apps/agent-runtime/src/platform/whatsapp：完整实现的 WhatsApp platform adapter、renderer、webhook、sender 和 graph-api
- integrations/langbot/patches/whatsapp.yaml：LangBot 侧的自定义平台资源
- infra/cloudflare：Cloudflare Tunnel 配置模板（保留用于未来 Webhook / HomeLab API）

## 确保不影响其他平台

- WhatsApp 相关代码仅作为静态导出，不影响 KOOK / Telegram runtime 路由
- Platform capabilities 定义保持静态配置，不引入运行时依赖
- Runtime 镜像中的 whatsapp 标签仅表示构建时包含相关代码，不会自动启用

## 验证结果

- [x] **Monorepo 基础验证**
  - [x] pnpm install 生成根 pnpm-lock.yaml
  - [x] pnpm typecheck、pnpm build
  - [x] pnpm test：83 个 runtime tests（82 pass，1 个外部 fixture 缺失而 skip）
  - [x] pnpm test:legacy-v2：30 个 Python tests 通过
  - [x] pnpm check:secrets
  - [x] Shell/Python 语法、脚本 dry-run/help smoke test
  - [x] 所有脱敏 Compose 模板通过 docker compose config

- [x] **工程规范验证**
  - [x] pnpm check:secrets（通过）
  - [x] git diff --check（通过）
  - [x] 4 个 Skills 符合 skill-creator 规范
  - [x] deploy-langbot.sh 语法验证（bash -n）
  - [x] Git 仓库干净并成功推送到 origin/main

- [x] **WhatsApp 暂缓验证**
  - [x] 确认 WhatsApp 代码仅作为静态导出
  - [x] 确认无默认启用配置
  - [x] 确认不影响 KOOK / Telegram runtime
  - [x] Cloudflare Tunnel 配置保留

## 会话启动协议

新会话先读取：

    README.md
    docs/ARCHITECTURE.md
    docs/PROJECT_STATE.md
    docs/CURRENT_TASK.md
    docs/PROJECT_MAP.md
    .agent/state.md

然后执行：

    git status --short --branch
    git log -5 --oneline --decorate

按需读取 skills/*/SKILL.md 了解特定工作流程。

## 后续工作规则

任何后续部署或运行时变更必须：

1. 遵循 AGENTS.md 中定义的全局工程规则；
2. 使用相应的 Codex Skills（如 langbot-development、n8n-workflow-development）；
3. 确认目标是 OrbStack ubuntu 内的 CasaOS；
4. 只从外部 secret store 恢复 credential；
5. 更新本文件、docs/PROJECT_STATE.md 和一个新的 checkpoint；
6. 跑与改动匹配的测试以及 pnpm check:secrets。

## 恢复条件

1. 获得 WhatsApp Business API 商业版授权
2. 明确所需的消息模板、会话状态和 webhook 验签能力
3. 完成与现有 runtime 的集成测试和性能基准

## 恢复操作

1. 重新评估 Meta Cloud API 最新能力与合规要求
2. 更新 docs/CURRENT_TASK.md 状态
3. 启用 apps/agent-runtime/src/platform/whatsapp 相关代码
4. 配置 Cloudflare Tunnel 和 LangBot webhook 集成

## 下一个潜在任务

当前代码阶段没有未完成的本地实现；后续仅需按 `.agent/tasks/homehub-runtime-smoke.md` 在目标
Ubuntu/CasaOS 环境执行人工烟测。WhatsApp 接入已按需求暂缓。可以支持：
- Codex 新会话从 Git 恢复上下文
- Mac mini 迁移使用已建立的恢复流程
- LangBot 和 n8n 变更遵循文档化的工作流程
- 使用 deploy-langbot.sh 进行安全的插件/patch 部署
- 在满足恢复条件后重新启动 WhatsApp 接入工作

如需开始新阶段，请更新此文件中的"当前阶段"和"完成清单"。
