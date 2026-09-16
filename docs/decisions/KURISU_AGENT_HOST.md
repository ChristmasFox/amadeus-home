# Kurisu 主 Agent 宿主决策

状态：`P0_HOST_FIXED_LOCAL / P0_REAL_PARTIAL`  
日期：2026-09-16（Asia/Shanghai）  
审阅提交：`042d5c3`  
关联规格：[`KURISU_AGENT_IMPLEMENTATION_PLAN.md`](../KURISU_AGENT_IMPLEMENTATION_PLAN.md)、[`KURISU_AGENT_ACCEPTANCE.md`](../KURISU_AGENT_ACCEPTANCE.md)

## 决策

选择 Path A：以现有 LangBot 原生 `local-agent` 作为唯一自然语言决策宿主，Kurisu 运行时提供受约束的结构化 Tool、任务/上下文/审批/通知服务；Mastra 继续只承担 PUBG 的确定性子流程。P1 不新增一个会再次解释用户自然语言的 Mastra 主 Agent，也不新增 LLM listener。

当前实际宿主事实：

| 项目 | 实测值 |
| --- | --- |
| LangBot | 4.10.8，CasaOS/OrbStack `ubuntu`，容器 `langbot` |
| Pipeline | `KOOK Pipeline`，UUID `2cc265c7-0dd1-4221-b594-0a6b38d7c1d5` |
| 主 runner | `local-agent`，`max-round=10000`，`enable-all-tools=true` |
| 主模型记录 | `arthur-combo`，通过现有 `9Router` provider，具备 `vision`、`func_call`、`reasoning` |
| 9Router | 容器内 base URL `http://9router:20128/v1`，版本 `0.5.65` |
| 平台 bot | Telegram 与 KOOK 各 1 个，均启用并绑定同一 Pipeline |

## 证据

1. LangBot 只读 API（API key 仅从仓库外文件读取，未写入报告）返回 1 条 Pipeline、2 个平台 bot、6 个已安装插件；Pipeline 的 `local-agent` 配置与上表一致。
2. LangBot 4.10.8 容器源码的 `LocalAgentRunner` 在模型返回 `tool_calls` 后调用 `tool_mgr.execute_func_call`，以原始 `tool_call.id` 回传 tool result，再继续同一模型的工具循环；这符合“一个主 Agent + 工具循环”的宿主边界。
3. 当前 9Router 实测（无平台消息、无配置写入）均返回 HTTP 200：
   - 文本请求产生 1 个带 ID 的 `kurisu_probe_status` tool call，参数为合法 JSON；
   - 注入对应 tool result 后返回 assistant final（无第二个 tool call）；
   - 注入结构化 error tool result 后仍返回 bounded final，不把失败伪装成成功；
   - 1x1 PNG data URI 多模态请求产生 1 个带 ID 的 `kurisu_probe_image` tool call，参数为合法 JSON。
4. 仓库内 [`apps/agent-runtime/src/kurisu/host-probe.ts`](../../apps/agent-runtime/src/kurisu/host-probe.ts) 与定向测试验证 fake entity → status → dependent query → final 的最小宿主契约，并验证缺失工具不会生成成功答案。

## 未通过或尚未覆盖的门槛

- **真实 LangBot native-agent tool loop：未宣称通过。** 当前 WebSocket 调试入口要求用户/支持管理员 token 与 workspace UUID；仓库外现有 LangBot API key 只能证明管理 API 可读，不能冒充会话身份。未发送平台消息，也未修改线上 Pipeline 来制造临时测试工具。
- **真实图文经 LangBot 平台入口：未覆盖。** 9Router provider 层已覆盖图文，但 LangBot WebSocket/HTTP Bot 会话层仍需合法隔离身份或专用测试 Pipeline。
- **single-consumer 迁移：P1 未完成。** 当前生产 Pipeline 仍可见 PUBG/Product Radar 等历史 EventListener；本 ADR 固定目标宿主，不把现有 listener 盘点误报为已迁移。
- **真实 briefing producer：P0 未发现仓库内可移交的独立生产者。** P5 需要继续盘点并将缺口标为 blocked，而不是用空数据代替。

## 后续约束

- 新 Kurisu 入口只能通过 LangBot native Agent 的 Tool catalog 与结构化 trusted context 接入；自然语言理解归宿主，领域工具只接受已校验的结构化参数。
- 迁移前保持旧入口默认行为；迁移时按 session/bot rollout 禁用旧自然语言 listener，不能让旧 listener 与 Kurisu 同时消费同一 inbound。
- 若后续 Path A 失败，必须补齐失败证据、审阅 LangBot 官方扩展边界，再按实施计划记录 Path B 决策；不能仅因当前仓库已有 Mastra 就切换。
- 生产部署、Pipeline 修改、插件安装和真实平台消息均不属于本开发 Goal 的授权范围。
