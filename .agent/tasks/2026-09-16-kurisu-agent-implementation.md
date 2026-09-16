# Kurisu 统一 Agent 实施任务

状态：ACTIVE / P0_COMPLETE_LOCAL / P1_IN_PROGRESS。用户要求先提交实施计划，随后由本机 Codex Goal 完成 P0–P6；P7 仍未授权。

入口：`docs/KURISU_CODEX_GOAL.md`。
规格：`docs/KURISU_AGENT_IMPLEMENTATION_PLAN.md`。
验收：`docs/KURISU_AGENT_ACCEPTANCE.md`。

P0 已完成：Path A 固定为 LangBot 4.10.8 原生 `local-agent` + 9Router；已创建 ADR、能力/生产者盘点、脱敏 baseline、复现记录和 fake host probe。真实 provider 层 tool/JSON/图文/失败传播通过；由于缺少合法 LangBot user/support-admin session token，真实 native-agent WebSocket/platform entry 保持 BLOCKED，不把 API key 当作用户身份。

后续顺序：P1 契约与结构化工具（当前）；P2 只读主 Agent 闭环；P3 持久化任务及安全写；P4 Codex executor；P5 统一通知/偏好；P6 集成与 Release 准备；P7 单独授权后部署。

保留既有业务与未迁移渠道，不增加关键词路由。未完成项：旧 PUBG/Product Radar EventListener 的 session rollout/single-consumer 迁移、LangBot native session L2/L3、briefing producer 发现/移交，以及 P1–P6 全部实现。生产配置、平台消息、插件安装和部署均保持未触碰。
