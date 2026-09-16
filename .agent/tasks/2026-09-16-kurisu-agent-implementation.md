# Kurisu 统一 Agent 实施任务

状态：PLANNED / NOT_STARTED。用户要求先提交实施计划，随后由用户在本机启动 Codex Goal。

入口：`docs/KURISU_CODEX_GOAL.md`。
规格：`docs/KURISU_AGENT_IMPLEMENTATION_PLAN.md`。
验收：`docs/KURISU_AGENT_ACCEPTANCE.md`。

第一步 P0：核对真实 LangBot 主 Agent/9Router 能力，按门槛固定唯一宿主并创建 ADR；不能仅因仓库用了 Mastra 就再造第二个决策入口。

后续顺序：P1 契约与结构化工具；P2 只读主 Agent 闭环；P3 持久化任务及安全写；P4 Codex executor；P5 统一通知/偏好；P6 集成与 Release 准备；P7 单独授权后部署。

保留既有业务与未迁移渠道，不增加关键词路由。当前尚无实现、模型测试或生产部署证据。
