# Current Task

更新时间：2026-09-05（Asia/Shanghai）

## 当前阶段

**COMPLETE — Codex Engineering Specifications**

已完成 Monorepo 初始化和 Codex 工程规范建立。GitHub 远程已配置并验证：
git@github.com:ChristmasFox/amadeus-home.git（main 分支，最新 commit daa40a1）。

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

- [ ] **可选后续验证**
  - [ ] Docker 镜像实际构建：Docker Hub 基础镜像元数据请求超时，需在网络可用时按 README 命令验证
  - [ ] LangBot 插件实际部署测试（需要外部 LANGBOT_API_KEY 和运行时环境）

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

## 下一个潜在任务

当前没有明确的下一步任务。仓库已完全配置好工程规范，可以支持：
- Codex 新会话从 Git 恢复上下文
- Mac mini 迁移使用已建立的恢复流程
- LangBot 和 n8n 变更遵循文档化的工作流程
- 使用 deploy-langbot.sh 进行安全的插件/patch 部署

如需开始新任务，请更新此文件中的"当前阶段"和"完成清单"。
