# Current Task

更新时间：2026-09-05（Asia/Shanghai）

## 当前阶段

**COMPLETE — Monorepo migration**

已完成用户要求的仓库整理、代码归档、配置脱敏、Codex 持久化文档、基础脚本和
本地 Git 初始化准备。完整验证已通过，当前正在进行最终 staged 审计并创建本地
初始化 commit；不执行公网 push。

## 完成清单

- [x] 建立 pnpm workspace monorepo 结构；
- [x] 归档 Mastra/PUBG、Telemetry、Platform Adapter、WhatsApp 和 V2 domain；
- [x] 归档 LangBot 自定义插件、patch、资源和兼容说明；
- [x] 归档 n8n workflow JSON 与 credential placeholder；
- [x] 提供 CasaOS/Docker、Cloudflare、macOS 脱敏模板；
- [x] 建立 bootstrap.sh、doctor.sh、backup.sh、restore.sh；
- [x] 建立 check-secrets.sh、.gitignore、.env.example；
- [x] 建立 README、架构、状态、决策、清单和 checkpoint；
- [x] 确认不自动配置或执行公网 push。

## 验证结果

- [x] pnpm install 生成根 pnpm-lock.yaml；
- [x] pnpm typecheck、pnpm build；
- [x] pnpm test：83 个 runtime tests 通过；
- [x] pnpm test:legacy-v2：30 个 Python tests 通过；
- [x] pnpm check:secrets；
- [x] Shell/Python 语法、脚本 dry-run/help smoke test；
- [x] 所有脱敏 Compose 模板通过 docker compose config；
- [ ] Docker 镜像实际构建：Docker Hub 基础镜像元数据请求超时，需在网络可用时按 README 命令验证。

## 会话启动协议

新会话先读取：

    README.md
    docs/ARCHITECTURE.md
    docs/PROJECT_STATE.md
    docs/CURRENT_TASK.md
    .agent/state.md

然后执行：

    git status --short --branch
    git log -5 --oneline --decorate

## 后续工作规则

任何后续部署或运行时变更必须：

1. 先确认目标是 OrbStack ubuntu 内的 CasaOS；
2. 只从外部 secret store 恢复 credential；
3. 更新本文件、docs/PROJECT_STATE.md 和一个新的 checkpoint；
4. 跑与改动匹配的测试以及 pnpm check:secrets。
