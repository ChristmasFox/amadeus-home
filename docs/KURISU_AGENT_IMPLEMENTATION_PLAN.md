# Kurisu 统一 Agent 实施计划

状态：PLANNED，尚未实施或部署。版本：1.0，2026-09-16。

代码审阅基线：`b77a2d6a978cfda4e85c40d292d3f4bfb7bc0f97`。实施时必须对照新的 HEAD 复核；本文件不是线上配置或验收证明。

执行入口：[Codex Goal](KURISU_CODEX_GOAL.md)。验收规范：[验收矩阵](KURISU_AGENT_ACCEPTANCE.md)。三份文档共同构成实施规格，不能只执行其中一份。

## 1. 用户目标与范围

用户已有 LangBot、通过 9Router 接入的主 Agent/模型配置，以及 PUBG、HomeHub、Product Radar、n8n 和 Codex 完成通知。目标是以 Telegram 私聊为主要入口，获得能理解自然语言、联系上下文、主动查证、组合工具、执行并验证、长期通知的 Kurisu 助手；保留 KOOK 现有可用功能。

必须交付的能力：

1. 换一种说法、使用否定/条件/跨话题追问时，仍能准确理解；不依赖自然语言关键词路由。
2. 同一请求由一个主 Agent 决策。它能查询缺失信息，根据工具结果继续执行，必要时只追问真正缺失的内容。
3. 复用现有业务逻辑，支持 PUBG 查询与复盘、HomeHub 诊断与授权操作、Radar 监控生命周期与故障定位、现有媒体整理、简报诊断与通知。
4. 工程任务交给真正的 Codex 执行器，支持启动、状态、继续、取消/中断、等待输入和完成通知。
5. 任务及关键上下文持久化；重启不会把未知执行结果当成功，也不会盲目重复写操作。
6. 主动消息统一进入可靠投递通道；Telegram 私聊为默认主渠道，KOOK 通知是否保留以用户既有偏好为准，不擅自移除。
7. 理性、简洁、技术型、适度吐槽的 Kurisu 表达；数字、权限和完成状态不受人格影响。

不承诺达到某个模型产品的所有能力；用验收轨迹证明以上目标。模型能力不足时报告证据，不靠规则补丁伪装通过。

### 本次不做

- 不换 LangBot、不重写 Radar/PUBG 核心、不迁移全部数据、不升级所有框架。
- 不引入多主 Agent、独立 Planner/Critic 群、向量数据库、消息总线、Kubernetes、Temporal 或 Worldline UI。
- 不给聊天 Agent 任意 shell、Docker socket、SQL、任意文件路径或全盘操作工具。
- 不新增 WhatsApp/微信等渠道，不实现全网自动找资源、自动购买或未有接口的家居控制。
- 媒体能力以现有可验证流程为边界；其他能力必须诚实返回 unsupported。
- 本计划的开发 Goal 不包含生产 RELEASE。部署有独立 Goal，遵守根 AGENTS.md。

## 2. 当前问题与需要保留的资产

| 证据路径 | 已确认的代码事实 | 处理 |
| --- | --- | --- |
| `apps/agent-runtime/src/server.ts`、`runtime/homehub-runtime.ts` | 前置 HomeHub classify 可因“状态/好/确认/取消”接管消息 | 新入口取消自然语言前置抢占；旧入口隔离 |
| `packages/homehub-domain/src/domain/homehub-domain.ts` | `includes('重启')` 优先判 action，不能表达否定和条件 | 主 Agent 理解，领域接受结构化命令 |
| `integrations/langbot/plugins/product-radar/components/intent_planner.py` | `_legacy_fast_path` 在模型之前执行，普通短句可直接变删除 | 普通自然语言退出 fast path，保留协议命令 |
| `apps/agent-runtime/src/planner/mastra-planner.ts`、`runtime/workflow.ts` | 单次 PUBG 规划与固定五阶段工作流 | 保留为专业工具，不能冒充通用 Agent Loop |
| HomeHub `context-manager.ts`、Radar `components/context.py` | 会话/待确认状态主要在内存；Radar 可另行恢复 active Watch | 共享任务引用持久化，领域数据仍归领域 |
| `integrations/n8n/workflows/codex-completion-notification.workflow.json` | 先 claim 后发消息；turn complete 固定显示成功 | 事件去重与渠道投递分开；修正完成语义 |
| HomeHub `action/action-engine.ts` | 重启验证以容器 running 为主 | 加业务探针，区分进程健康与功能健康 |

保留 NormalizedBotMessage、IdentityRegistry、AuthorizationCore、HomeHub ActionEngine/DiagnosticEngine、PUBG 确定性统计与 renderer、Radar SQLite/SourceAdapter/ImageMatcher/Outbox、已有 n8n workflows。不得为统一入口而破坏已验证的数字、匹配规则、媒体目录约束和 callback 隔离。

## 3. 架构决策：一个逻辑主 Agent，宿主只选择一次

### 3.1 优先复用现有 LangBot 主 Agent

用户说的“主 Agent”可能是完整的工具循环，也可能是模型配置/聊天 Pipeline。仅凭名字不能判断。P0 必须查明实际版本、Pipeline、模型选择器和工具扩展能力，保存脱敏证据。

**默认路径 A：LangBot 原生主 Agent 是唯一对话决策者。** 保留当前 9Router 接入，通过插件工具适配器暴露统一结构化工具。`apps/agent-runtime` 承担工具服务、任务/上下文存储、执行策略及通知 Worker；现有 Mastra 继续执行 PUBG 等确定性子工作流，不再二次理解整条用户请求。

只有 A 未通过下列宿主能力门槛，且已排除可用的官方插件扩展方式，才选择 **路径 B：Mastra 为唯一主 Agent**。此时 LangBot 仅负责消息协议、身份、附件、回调和发送，已迁移会话禁止再次进入 LangBot 普通聊天 Agent。Mastra 复用同一 9Router 服务和用户选择的模型路由，由外部配置注入；不得擅自更换模型、Key、套餐或默认路由。

两条路径是 P0 的选择，不是要同时实现的两个产品。P0 结束后在 `docs/decisions/KURISU_AGENT_HOST.md` 固定 `host=langbot|mastra`、版本、证据、失败项、选用的适配方式；后续阶段只实现选中的宿主。因拿不到环境而未测试，不能记为“不支持”并据此换架构。若必须升级 LangBot 本体/重做大量 patch 才能选 A，优先评估现有 Mastra 的 B，不把大升级捆绑进来。

| 宿主门槛 | 最小实证 |
| --- | --- |
| 工具循环 | 用无副作用 fake 工具完成发现实体 → 查状态 → 依据结果继续查询 → 最终答复，保留工具调用 ID |
| 输入完整 | 原始用户消息、引用消息、附件、稳定身份和任务摘要完整到达主 Agent |
| 上下文扩展 | 可在每轮注入持久化任务/偏好摘要，并保存模型与工具的有效对话历史 |
| 可观测性 | 可关联 inboundId/runId/toolCallId；关键工具执行与最终响应可审计，失败不伪装成普通聊天 |
| 执行控制 | 工具层强制授权，支持任务返回 accepted、等待输入、后续以同任务继续；不要求宿主原生实现所有持久化 |
| 单一消费 | 能可靠禁用已迁移会话的旧领域 listener 抢占；普通聊天和工具请求共用同一主 Agent |
| 实际 Provider | 经当前 9Router 实测连续 tool calls、JSON 参数、图文消息、tool result 关联与失败传播 |

### 3.2 逻辑边界

| 模块 | 所有权 |
| --- | --- |
| Gateway | 验证来源、归一化、幂等接收、会话选择、回调路由、平台发送 |
| 主 Agent | 理解目标/否定/条件、信息获取、选择工具、解释和最终答复 |
| 工具注册与执行 | schema、超时、权限、资源归属、幂等、事实结果与错误 |
| 领域 | Watch/比赛/服务/媒体真实状态、业务规则及确定性执行 |
| Runtime Store | 消息与任务映射、Run/Job、审批、执行账本、偏好、事件及投递 |
| Codex Executor | 工程任务执行；不成为与主 Agent 争抢聊天的第二个入口 |

不在 LangBot Python 和 TypeScript 中各造一套上下文/权限中心。跨语言契约在 `packages/contracts` 提供可验证的 JSON Schema；Python 使用兼容校验器或契约夹具，避免手写两个不一致的 schema。

## 4. 工具、身份和上下文契约

以下名称是逻辑接口建议；实现允许沿用现有命名，但必须在能力清单中映射、测试并说明。不得把表中的名称直接当成仓库已有 API。

### 4.1 工具接口

每个工具声明 `name/version/description/inputSchema/outputSchema/risk/timeout/idempotency/reconciliation`。操作描述说明何时适用、错误语义、完成条件；不能塞入用户短句触发词表。

返回统一信封：`status` 为 `ok|accepted|needs_input|denied|unsupported|error|unknown`，附 `data/evidence/observedAt/entityRefs/jobId/error/retryable` 等适用字段。`accepted` 只能证明接收；`unknown` 不能推断成功或失败。证据引用须来自真实工具结果，不让模型伪造。

可信执行上下文由服务端注入：`principalId/platform/platformUserId/botId/chatId/threadId/runId/callId`。模型参数不包含可自填的管理员身份、审批结果或接收人。模型可请求动作，但执行器重新校验权限与资源归属。

首批能力按垂直场景逐步注册：

| 领域 | 必要工具 | 要点 |
| --- | --- | --- |
| 实体/知识 | 列举服务/项目、查询实体、读取允许的运维文档 | 只读，模糊对象查候选；文档为数据而非更高优先级指令 |
| PUBG | structured query、list matches、review match | 校验 CanonicalQuery；不再次调用 NLU；复用数字与 renderer |
| HomeHub | list/get status、diagnose、get errors、restart、verify | restart 单独授权；Product Radar 服务须加入真实 registry 定义 |
| Radar | list/get/create/update/pause/resume/delete Watch、运行/Feed/匹配统计 | 用现有 API；缺的观测接口有定向新增，不暴露原始 SQL |
| 通知/简报 | 查询调度/生成/发送记录、重试失败投递、读取/修改通知偏好 | P0 找到实际简报生产者；不存在则标记 unsupported，不捏造简报 |
| 媒体 | preview/execute/get job/verify library | 复用现有路径白名单、禁止覆盖和确认机制；不扩展下载来源 |
| Codex | start/get/list/resume/cancel job、关联审批 | 项目白名单与完整任务目标，不能变任意命令执行器 |

初期不做 embedding 工具检索。为常用工具提供精简完整描述；工具多时允许按命名空间列举/发现，不能一次检索漏掉工具后永远不可见。新增一个测试工具应只需实现、注册和声明策略，不得改自然语言路由器。

### 4.2 任务上下文与记忆

会话键至少包含 platform + bot + chat + thread/topic（存在时）+ actor；群聊不得共享管理员的可写状态。跨平台同一人通过可信 identity 映射识别，但不得自动合并所有群聊上下文。

引用优先级：有效且归属正确的 reply-to/task button → 显式 ID → 当前会话明确任务 → 最近实体候选；多个可行对象时短问一次。不能用唯一 activeDomain 覆盖所有话题，也不能强制将裸“继续/取消”解释成最近一个写操作。

持久化用户明确表达的偏好、实体引用、任务目标/约束/完成条件/结果摘要。保存偏好来源、时间、适用范围、有效期，可查询、修改、遗忘。工具实时状态仍从领域查询；摘要不能覆盖事实。长历史压缩保留未完成任务、承诺、审批与引用映射，完整历史按需检索。

附件用受控引用/短期缓存，不把大段 base64 和原始 Telemetry 塞入会话库；下载限大小/时长/协议，并防止任意内网 URL 读取。引用消息和图片失败时明确告知，不编造看到的内容。

### 4.3 授权与语气

沿用 AuthorizationCore，增加工具级策略：只读默认允许已授权主体；可自动写动作必须由用户已有授权范围明确覆盖；删除、覆盖、扩大范围或高风险动作按既有策略确认。无需对每次只读查询要求确认，也不能用“管理员”身份跳过所有动作审批。

审批绑定 principal + conversation + run + action + normalized arguments hash + expiry，一次性消费；参数变化使旧批准失效。按钮不能跨人/跨任务复用。HTTP 边界必须认证服务调用，不能信任请求体自行声明的 userId/role。

Kurisu 人格配置只写一处：理性、简洁、技术型、偶尔轻微吐槽，不称“主人”，不堆傲娇口癖。普通聊天自然表达；通知简洁；严重告警直接陈述事实。默认不增加第二个“人格改写模型”；现有精确 PUBG 输出可直接使用，不重新计算数字。

## 5. 持久化、执行恢复与通知

### 5.1 单应用数据库与执行账本

默认为 agent-runtime 新建独立 SQLite 数据文件，沿用仓库已有 SQLite 技术经验，支持事务、WAL、迁移与备份。P0 核对 Node 版本/驱动兼容；不跨服务写 Radar 数据库，不把状态文件放网络共享盘。不为此引入新数据库服务。

最小逻辑表：sessions/messages/message_task_links、runs/jobs、tool_executions、approvals、preferences、events、deliveries。允许合理合并，禁止为了表名造额外服务。领域对象继续由原领域数据库拥有。

Run 状态：`queued → running → waiting_input|waiting_approval|waiting_job|succeeded|failed|cancelled`；外部写结果不明进入 `reconciling`，无法核实则转 `blocked`。保存 checkpoint/version/lease/last observation/next resumable step。最终回复可持久化但不保存或要求模型私有思维链。

Inbound key 来自真实平台 update/message ID + bot + event type；平台回调独立处理。相同文本但不同消息 ID 是不同消息，不可文本哈希去重。Run 与实体写操作都有稳定幂等键。

主 Agent 宿主会话 ID 与 canonical session/run 映射持久化。每次工具调用及返回保存可恢复的协议历史；重启后先核对已执行 callId，再恢复宿主对话，不能把同一工具结果重复注入或重新执行。A 下 LangBot 的聊天历史可以继续保留，但任务状态/审批/幂等以 Runtime Store 为准；B 下同理不把模型内存当任务数据库。工具实际执行的身份与 runId 必须能从可信宿主上下文取得，不能靠模型回传。

写操作先记录意图/幂等键，再发外部请求，再记录结果。进程在“外部已成功、内部未落库”时崩溃：重启先 query/reconcile；没有下游幂等或可核查状态则标记 unknown/blocked，不盲重试。不能声称对所有外部系统实现 exactly-once。

单会话顺序处理或使用版本锁，独立任务允许并发；同一实体写操作互斥。Worker 用租约防止双执行；重启恢复、租约过期、重复回调均需测试。取消先停止后续步骤，再尝试取消外部任务；无法回滚已执行步骤时如实说明。

主 Agent 达到运行上限/超时应保存状态、明确未完成原因；不以达到步数当完成。短任务直接回复，长任务先返回持久化 jobId，再由后台执行。通知期间的普通聊天不会取消任务。

重启 LangBot、agent-runtime、n8n 等当前执行/通信依赖属于特殊操作：必须先持久化任务，并由不会同时被重启的受控 executor 执行与验证；没有这条恢复路径时返回 unsupported/等待维护，不让 Agent 在内存中重启自身后丢失结果。

### 5.2 完成条件

- 重启：命令结果、容器状态与适用业务探针均通过，才能宣称业务恢复。探针缺失/网络不可达返回 unknown，不说健康。
- Radar 排障：分别检查 Watch 是否启用、轮询是否运行、Feed 是否失败、是否有匹配、是否生成事件、是否投递；没有匹配是合法结果，不必重启。
- 简报排障：查计划、生成执行、事件和投递。n8n 不可用返回来源不可用，不说“今天没有简报”。
- 媒体：现有流程执行成功、整理清单校验、媒体库刷新及条目可查；尚未入库就保持未完成。
- Codex：区分回合完成、等待输入、审批、失败、工程目标完成与部署完成。没有测试/验收证据不自动加“测试通过/已部署”。

### 5.3 通知 Outbox

事件唯一键与投递唯一键分开：eventId 与 `(eventId, channel, recipient)`。投递持久化 pending/sending/sent/retryable_failed/unknown/dead、attempts、nextAttemptAt、lease、platformMessageId。事件已接收不表示已投递。

先持久化事件和待发送记录，再 ACK webhook。来源与中心不同数据库时用生产者本地 Outbox 重试转交；不能假装跨 SQLite/n8n 有单事务。迁移 Radar 时保留其本地 Outbox 作为转交机制或明确切换所有权，禁止旧 sender 与中心各发一份。

成功渠道不重发；失败渠道独立退避重试。平台发送成功但响应丢失时记录不确定性：若平台不能查询/去重，只能提供至少一次投递及可识别的事件 ID，不承诺绝对无重复。失败耗尽可查询并由用户重试；不能死循环。

Codex legacy notify hook 从“一次 HTTP 失败直接丢弃”升级为本地安全 spool/可靠转交；保持 fail-open，不阻塞 Codex。只收到 `agent-turn-complete` 时用“Codex 本轮结束”，关联不到 task 的事件标为外部会话，不强制推断任务成功。

汇入现有 Radar、Codex、简报和 HomeHub 事件；事件 producer 的来源、认证和支持状态有清单。成功后通知记录与 outboundMessageId/taskId 关联，方便 Telegram 回复“继续”。通知偏好有时区（默认继承用户已有 Asia/Shanghai）、来源、结果类型、静音到期时间；不要改动现有发送时刻。

## 6. Codex Executor

在 macOS 工程目录所在位置运行 executor；不要把 Mac 项目复制进 CasaOS 来执行。优先用实际安装版本支持的官方 SDK；若持续进展、审批回应或中断能力需要 App Server，选择 App Server 并固定版本。只实现一种适配，接口可替换。

最小 job 保存 `jobId/projectId/workspaceRef/threadId/turnId/goal/constraints/status/evidence`。项目路径由服务端 project registry 决定；不要接受模型任意 cwd。开始前检查仓库状态，隔离已有未提交更改，同一工作区禁止并行写。

完整工程任务交给 Codex，不逐条命令遥控。保留 Codex 原有 sandbox/approval 和仓库 AGENTS 约束，不使用 bypass-all 解决审批。对等待输入/审批提供持久化绑定，Telegram 回答继续同一 job/thread；拒绝伪造审批。

macOS executor 与 CasaOS 间使用认证的私有接口或已有受控通道，限制来源，密钥仅在外部 secret；不新增公网执行接口。断线后通过 thread/job 查询恢复，不重新 start 同一任务。

## 7. 分阶段实施与退出门槛

阶段必须顺序通过门槛。每阶段独立提交，记录实际命令、测试、未完成项和回滚；不能在所有阶段结尾一次补写“已验证”。

### P0 — 事实盘点、基线与宿主决策

- 读取仓库规定的启动文件，检查 git status/log；保留未提交工作，读取适用 skills。
- 盘点所有普通消息 listener、tool、command、callback、默认聊天 Pipeline 与通知 producer；包括 organize-emby 和 macos-nas-control，不能只迁移 PUBG/Radar。
- 读取本机实际 LangBot/9Router/Codex 版本、模型配置引用及 API 能力；仅输出脱敏信息。核实 container 中 endpoint 可达，不能照搬宿主 localhost。
- 按 3.1 以隔离 fake 工具完成 A 的能力探针；必要时同条件验证 B；记录主 Agent 宿主 ADR。认证/网络错误单独定位，不解释为模型不聪明。
- 建立验收运行器骨架与旧业务 baseline；记录已知挂起/缺 fixture 的测试，不冒充通过。
- 交付 `docs/decisions/KURISU_AGENT_HOST.md`、能力/producer 清单、脱敏基线与复现案例。
- 门槛：宿主唯一、主模型引用明确、P0 检查可复现。无真实凭据可完成静态盘点和 fake 测试，但 P0_REAL 标记 BLOCKED；不得据此上线或替换宿主。

### P1 — 契约、结构化领域入口与受控迁移骨架

- 新建 tool schema/result/context 契约、注册表和可信执行上下文；包内即可，不做插件市场。
- PUBG 新 structured 入口绕过语义 planner，但继续校验、时间解析、计算和 renderer；复盘通过明确 operation 与 selector，不再受原始文本正则覆盖。
- HomeHub 暴露结构化诊断/操作/验证，Radar 复用现有 structured API；错误不能返回假空数据。
- Gateway 建立主体隔离、幂等 inbound、协议 callback namespace 和 rollout 配置；默认 legacy。
- 已迁移会话跳过所有旧自然语言 listener/工具 NLU；A 使用原生主 Agent，B 明确 prevent_default。旧插件命令/回调只能由 ownership 清单规定的一个处理器执行。
- 通过入口复现确认 HomeHub 抢占与 Radar fast path 不影响新路径。不要只给旧正则新增反例排除词。
- 门槛：契约、主体校验、单一消费、旧业务确定性回归通过；尚未启用真实写操作。

### P2 — 主 Agent 与首个完整只读场景

- 接入选中的宿主和 9Router 主模型，采用原生工具循环；失败、超时、空参数、协议不兼容可观测。
- 接入服务/Watch 枚举、状态、错误、通知诊断；统一会话摘要、引用消息与事实时间戳。
- 完成“Radar 今天为什么没消息”跨工具排障和普通聊天/图片问答；不因有图片或 activeWatch 就创建监控。
- 覆盖多种说法、否定、条件、跨话题与多实体歧义；所有动作测试用 fake 执行器。
- 门槛：验收矩阵 P2 项通过、真实模型多工具轨迹可见；最终回答有来源状态，不是只读 prompt 演示。

### P3 — 持久化任务、审批与安全写闭环

- 建立事务存储、执行账本、checkpoint、lease/reconcile、取消及 message_task_links；为写工具启用前先落地幂等与恢复机制。
- 按领域逐个接入 Radar 写操作、HomeHub restart/业务验证、已有媒体流程。
- 审批参数绑定；明确授权且在允许范围内自动执行，其他情况只问必要确认。
- 导入旧引用只作为带 provenance 的历史数据，过期/在途审批不迁移成已批准；旧新数据库不双写同一执行状态。
- 门槛：否定/条件/跨人审批全部通过，三处 crash injection、并发、取消、未知结果不重放通过。

### P4 — Codex 任务闭环

- 落地一种 Codex executor、project registry、工作区隔离、start/status/resume/cancel、进展和等待事件。
- 用隔离测试仓库完成真实小任务与验证；不得用生产项目进行破坏性验收。
- 本阶段完成事件先写标准 events；P5 接通可靠渠道发送，不能在工具里直接调用 Telegram。
- 门槛：断线/服务重启后继续同 thread/job，等待/失败不当成功，审批不能跨任务，隔离仓库测试证据可追溯。

### P5 — 统一通知、偏好、记忆与表达

- 落地 events/deliveries Worker、渠道重试、通知任务引用和 producer 交接；迁移现有 Codex hook/n8n、Radar、简报、HomeHub。
- 实现静音与“只通知失败”等偏好及到期恢复；成功/失败投递独立。
- 接入有限运维知识与用户显式偏好；已有 Run/Job 历史成为事件记忆，不新建向量系统。
- 加一份 Kurisu 语气配置，日志和工具结果保持事实；严重告警不用玩笑。
- 门槛：投递断网/崩溃/重复事件回放通过，来源清单中的生产者有证据；缺失的真实生产者标明阻塞，不用 mock 代替上线证明。

### P6 — 集成验收、去除迁移遗留与 Release 准备

- 运行完整验收矩阵的本地/真实模型层；检查所有已迁移渠道入口，不能只测领域函数。
- 保留 legacy 回滚开关，但 migrated 分支不引用旧关键词 router/NLU；遗留代码清单注明未迁移范围和删除条件。
- 新增 dummy 能力验证只注册即可使用；不得改 prompt 增加具体用户短句。
- 完成配置模板、备份/恢复脚本、部署 dry-run、健康/业务 smoke、回滚 runbook 和报告。
- 门槛：LOCAL_COMPLETE 可核验；真实环境缺项保持 pending，不能写 PRODUCT_COMPLETE。

### P7 — 单独授权后的部署与用户验收

- 只在用户明确执行部署 Goal 后进行 RELEASE；使用仓库 immutable image、no-build compose、插件 preview/install 流程。
- 默认只灰度管理员 Telegram DM；KOOK 群聊继续旧路径，迁移后也不继承 DM 权限。
- 先旁路 shadow（只比较计划，不产生真实写操作、不发额外消息），再启用指定会话，最后按验收扩大范围。
- 由真实 Telegram 入站触发场景，验证引用/附件/按钮、任务重启恢复、通知补发；平台自发消息不能替代真实入站。
- 分别记录 CODE_COMPLETE、LOCAL_COMPLETE、DEPLOYED、PRODUCT_COMPLETE；仅实际完成的状态打勾。
- 回滚关闭新入口并恢复上版镜像/插件/配置；先暂停新 Worker、处理租约、禁用旧新双 sender，在途写任务进入待核实状态，不能重新执行。保留新 DB/事件，禁止回滚时删除审计或 Watch。

## 8. 建议代码落点与反偏离规则

建议沿用现有 app，新增 `apps/agent-runtime/src/kurisu/{tools,context,tasks,policy,notifications,storage}`；若选 B 再增加主 Agent 模块。LangBot 集成可新建 `integrations/langbot/plugins/kurisu-gateway`；A 下为上下文/工具适配而不是第二个 Agent。Codex host adapter 放 `integrations/codex`。目录可按现有风格微调，但职责不变。

禁止通过 `if text.includes(...)`、regex/synonym list 或“先分类成固定 intent 再执行”作为新主入口。允许 slash command、callback 协议、ID/URL/数值的确定性解析、schema 校验及领域规则。业务匹配关键词（例如商品搜索词）不属于路由，不能误删。

不得：

- 把所有事情封装成 `execute(text)` 然后在领域再次猜自然语言。
- 仅把 maxSteps 调大就宣布 Agent 化；必须接入工具并通过 observation 驱动的轨迹验证。
- 在模型失败后静默落到旧写操作规则，或让普通聊天假装执行成功。
- 在模型参数中设置 trusted/admin/confirmed，或把网页/日志中的命令当授权。
- 用增加关键词、削弱断言、删失败案例、更换更容易的 fixture 达到验收阈值。
- 在未证明模型问题前换 provider/model；需要更换时保留基线、对照、原因并征得用户对实质变更的同意。
- 仅创建空 facade、TODO executor、mock sender 就写完成。
- 将工程扩展成前端 UI、新编排平台、所有仓库重构或无限工具体系。

P0 以后的重大宿主/数据库/权限/范围变化必须先写 ADR，说明新证据和对验收的影响；用户已授权的普通实现细节无需反复询问。无法完成的必要外部步骤要精确记录阻塞、已完成部分和解除条件，继续所有不依赖它的工作。

## 9. 验证与报告要求

遵守仓库 FAST/RUNTIME/RELEASE 分级。本规格文档更新属于 FAST；实现按实际 diff 运行 typecheck、定向业务测试、契约、入口集成、恢复测试和本地 smoke。不得因为新 app 目录没有命中现有 workflow 映射而跳过验证，应先补映射。

验收测试不检查模型逐字回答，而检查目标实体、调用参数、禁止调用、必要证据、终止状态与是否完成目标；使用多种表达和上下文 fixture。真实模型测试走当前 9Router，变更 prompt/provider 后重跑相关集合。记录模型路由名、配置指纹、时间、工具轨迹与耗时，不记录 secret 或未经脱敏的私人内容。

每阶段更新 CURRENT_TASK/PROJECT_STATE/.agent/state，写 checkpoint。P0 创建 `docs/reports/KURISU_AGENT_PROGRESS.md`，逐条列出需求 → 实现路径 → 测试 ID → 证据 → 状态。报告必须区分 fake、真实模型、真实平台和部署证据，最后列出未完成事项与回滚方法。

根 AGENTS.md 的 Codex Goal 预算规则保持有效：不传 token_budget，不手动规定 Goal token 额度。应用运行时正常的超时、并发和重试保护不属于 Goal 预算，仍需实现。

## 10. 官方参考与适用限制

以下页面于 2026-09-16 查阅。最新文档不代表当前部署版本具备对应 API，必须以 P0 的安装版本和实测为准；不要凭本文编造具体 SDK 参数。

- [LangBot Features](https://docs.langbot.app/en/insight/features)：原生 Agent、工具调用和插件扩展的能力入口。
- [Mastra Agents](https://mastra.ai/docs/agents/overview)：选 B 时使用框架现有 Agent 能力。
- [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk)：工程任务集成入口。
- [Codex App Server](https://learn.chatgpt.com/docs/app-server)：需要会话、审批及事件交互时核对。
- [Using Goals in Codex](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex)：用可检查的完成条件和约束定义目标。
