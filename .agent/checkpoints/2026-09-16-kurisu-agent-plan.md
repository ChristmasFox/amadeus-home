# Kurisu Agent 计划交付 checkpoint

日期：2026-09-16。
审阅基线：`b77a2d6a978cfda4e85c40d292d3f4bfb7bc0f97`。
阶段：PLAN_ONLY；P0–P7 未开始。

用户授权：编写可用于 Codex Goal 的实施计划并提交本仓库。本阶段仅修改 Markdown 文档，没有改变代码、运行配置、模型、Watch、数据库、服务或真实聊天。

交付：实施计划、验收矩阵、开发/恢复/部署 Goal 入口；在 README、AGENTS 和状态文件中建立导航，保留既有历史。

固定目标：一个主 Agent；优先复用现有 LangBot/9Router，P0 实证不能承载时才选择 Mastra；复用领域、结构化工具、持久化任务、可信审批、Codex executor 和可靠通知；Telegram DM 优先。

实际验证：三份主文档的本地链接和代码围栏检查通过；P0–P7 阶段完整；67 个唯一验收 ID（55 项关键约束）检查通过；`scripts/developer-workflow.sh --plan` 返回 FAST、禁止 Docker build；`scripts/check-secrets.sh` 和 `git diff --check` 通过。未运行应用测试或 live smoke，因为本次仅修改文档；不声称新功能已经验证。

下一步：由用户在本机仓库执行 `docs/KURISU_CODEX_GOAL.md` 的开发 Goal。生产部署仍由单独 Goal 授权。
