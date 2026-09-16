# Kurisu P0 能力与生产者盘点

日期：2026-09-16（Asia/Shanghai）  
审阅提交：`042d5c3`  
运行时事实：OrbStack `ubuntu` 内 CasaOS；本阶段只读，无重启、无部署、无真实消息。

## 当前入口与宿主

| 边界 | 当前实现/位置 | 事实 | Kurisu 处理 |
| --- | --- | --- | --- |
| Telegram | LangBot bot `Telegram` → `KOOK Pipeline` | 启用；与 KOOK 共用 Pipeline | Path A 唯一主 Agent；P1 以 session rollout 迁移 |
| KOOK | LangBot bot `KOOK` → `KOOK Pipeline` | 启用；保留渠道 | 同一主 Agent，保留平台 adapter |
| LangBot 主 Agent | 运行容器 `/app/src/langbot/pkg/provider/runners/localagent.py` | 原生工具循环、模型内 fallback | 选为唯一 NLU/decision host |
| 9Router | provider base URL `http://9router:20128/v1` | `arthur-combo` 可用；provider 层支持 tool call/vision | 继续复用，不新建模型路由 |
| Mastra | `apps/agent-runtime/src/runtime/workflow.ts` | PUBG deterministic/subworkflow | 不作为第二个普通聊天入口 |
| agent-runtime HTTP | `apps/agent-runtime/src/server.ts` | `/v3/*`、`/homehub/*`、`/whoami` 等既有边界 | P1 增加 `/kurisu/*` 结构化边界 |

## 已安装 LangBot 扩展

实际 `/api/v1/plugins` 只读结果：6 个启用插件。

| 插件 | 当前来源 | 已知组件/风险 | 迁移策略 |
| --- | --- | --- | --- |
| `local/product-radar@0.5.8` | 仓库 `integrations/langbot/plugins/product-radar` | EventListener、Command；另有结构化工具 | listener 迁移到 Kurisu Tool 后按 rollout 停止旧 NLU |
| `local/pubg-stats@3.3.2` | 仓库 `integrations/langbot/plugins/pubg-stats-v3` | EventListener、Command、Tool | 保留 domain/tool，移除重复自然语言消费 |
| `local/organize-emby@0.2.1` | 仓库 `integrations/langbot/plugins/organize-emby` | Command、Tool；写操作需审批 | 仅 Tool 进入统一 policy |
| `local/macos-nas-control@0.1.4` | 仓库 `integrations/langbot/plugins/macos-nas-control` | status/disk/sleep/group tools | 读写分层，重启/休眠不能由模型自确认 |
| `local/homelab-status` | LangBot runtime 本地安装 | 当前未在仓库插件目录找到同名 source | P0 记录为外部 producer；P1 不复制第三方实现 |
| `langbot-team/ScheNotify@0.2.3` | marketplace | schedule/notify 相关扩展 | P5 统一事件投递前先审计，避免双发 |
| `langbot-team/GroupChatSummary@0.1.2` | marketplace | 群聊摘要 | 作为既有能力，遵循群隔离与偏好策略 |

注：`extensions_preferences` 目前是全量插件/MCP/skill 开启，且绑定列表不等于 Kurisu 迁移完成；这只是当前运行事实。

## 现有自然语言/回调入口

| 入口 | 位置 | 观察 |
| --- | --- | --- |
| HomeHub pre-route | `apps/agent-runtime/src/server.ts`、`src/runtime/router.ts` | 现有 `route`/regex/上下文快捷判断；不能继续作为 Kurisu 主入口 |
| PUBG route/planner | `apps/agent-runtime/src/runtime/router.ts`、`workflow.ts` | 可保留为 deterministic domain/subworkflow；P1 需由 structured tool 调用 |
| Product Radar listener | `integrations/langbot/plugins/product-radar/components/listeners/product_radar.py` | 当前含事件监听和历史语义边界；需迁移后关闭同一 session 的旧消费 |
| PUBG listener | `integrations/langbot/plugins/pubg-stats-v3/components/listeners/pubg_gateway.py` | 当前含 listener；领域事实可复用，普通聊天不得双消费 |
| HomeHub confirmations | `apps/agent-runtime/src/homehub/confirmation.ts` | 已有 `hh1:` callback namespace，可作为 policy/callback 参考，不直接复用为 Kurisu approval |
| WebSocket debug | LangBot `/api/v1/pipelines/<uuid>/ws/connect` | 当前要求用户/支持管理员 token；API key 不能替代会话身份 |

## 通知生产者盘点

| 生产者 | 当前边界 | 当前问题/迁移要求 |
| --- | --- | --- |
| Product Radar | `apps/product-radar/src/core/notification/*`、LangBot Product Radar | 已有自己的 dispatcher/outbox；P5 要接统一事件/交付 ledger，不保留双 sender |
| Codex completion | `integrations/codex/codex-notify.sh` → n8n `codex-completion-notification.workflow.json` | 当前 n8n workflow 校验后分别调用 Telegram/KOOK；需迁移为统一 event/delivery，失败可重试且不假称 turn 成功 |
| PUBG/n8n | `integrations/n8n/workflows/pubg-*.workflow.json` | 既有数据同步/日报相关 producer；P5 需明确 event owner 和交付状态 |
| Organize media | `integrations/n8n/workflows/organize-workflows.json`、media adapter | 预览/执行分离；执行结果要以 verify 为准 |
| ScheNotify | LangBot marketplace plugin | 外部 producer/调度能力；P0 未修改，P5 先建立 producer registry |
| HomeHub | 现有 runtime/插件通知与状态边界 | 需要统一 failure/unknown 语义，不把容器 running 当业务成功 |
| briefing | 仓库未发现独立可核验 producer | P5/P6 标记 gap；不得用空日报或假成功补齐 |

## P5 交接更新（2026-09-16）

| Producer | 当前交接实现 | 状态 |
| --- | --- | --- |
| Codex legacy hook | `integrations/codex/codex-notify.sh` → Runtime `/kurisu/notifications/events`；失败写 `CODEX_NOTIFY_SPOOL_DIR`，由 `scripts/drain-codex-notification-spool.sh` 补发 | `IMPLEMENTED_LOCAL`；未安装/切换全局配置 |
| Product Radar | `apps/product-radar/src/integrations/notifications/kurisu.ts`；Product Radar 原 `notification_outbox` 在 `PRODUCT_RADAR_NOTIFICATION_OWNER=central` 时只作为跨库 handoff queue | `IMPLEMENTED_OPT_IN`；默认 local，P7 才切 owner |
| HomeHub structured writes | `WriteCoordinator` 将 HomeHub/Radar/media task 结果写入 Runtime event ledger，并保留 `taskId/runId` | `IMPLEMENTED_LOCAL`；既有外部主动 producer 仍待核实 |
| Codex legacy n8n | `integrations/n8n/workflows/codex-completion-notification.workflow.json` | `ROLLBACK_ONLY_SOURCE`；禁止与 Runtime sender 双开 |
| briefing | 未找到真实 scheduler/生成/投递 producer | `BLOCKED_UNSUPPORTED`；不以模板或手工事件代替 |

## 基线版本与状态

- `codex-cli 0.153.4`；`codex app-server --help` 可用，支持 `daemon`、`proxy`、`generate-ts`、`generate-json-schema`。
- Node `22.20.0`、pnpm `9.9.0`、Python host `3.14.0`；LangBot 容器 Python `3.12.7`。
- `langbot` 与 `langbot_plugin_runtime` 当前同镜像 `local/langbot-agent:941eb1089250-20260911-130202`；本阶段未触碰。
- `pubg-query-engine-v3`、`product-radar`、`changedetection`、`9router`、`n8n` 当前运行；本阶段未触碰。
- 活跃 LangBot DB 只读统计：1 workspace、2 bots、1 pipeline、2 providers、32 models、6 plugins；监控中已有 native agent/插件工具调用，说明宿主路径并非空壳，但不等同 Kurisu 已迁移。
