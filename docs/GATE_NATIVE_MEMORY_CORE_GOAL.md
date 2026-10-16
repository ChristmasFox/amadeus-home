# Gate Native Memory Core — 独立 AI SDK 长期记忆系统实施 Goal

> 日期：2026-10-16（Asia/Shanghai）
> 状态：**APPROVED_FOR_SOURCE_IMPLEMENTATION / AUTOMATED_GATE_LOCAL_CANDIDATE_AFTER_OPT_IN**
> 执行入口：`/goal docs/GATE_NATIVE_MEMORY_CORE_GOAL.md`
> 产品：仅 **Gate**（`apps/pubg-saas`，Vercel AI SDK 7 / KOOK）。
> **绝不引入 OpenClaw 运行时、Memory Core 插件、Lab SQLite/Workspace、OpenClaw Session 或 Lab 记忆凭据。**
> 源码/测试/隔离 fixture 可执行；Gate-Local 使用**一次性、主机本地显式启用的候选自动部署**，通过保护门禁后后续同类安全更新不逐次询问。现有 Gate M2 暂停门禁未解除前不得自动切换 Gateway/Worker；Gate-Staging/Prod 正式提升、破坏性迁移、未预授权的 pgvector 镜像/扩展切换、收费探针和真数据整理仍独立受控。Lab 已存在的自动候选部署与测试通知策略保持不变，两产品不互相触发部署。

## 0. 目标、事实基线与不变量

### 最终体验

Gate 可以在 KOOK 中：
- 自然记住用户**明确要求保存**的个人事实和偏好，支持纠正、列出和遗忘，且对恢复遗忘的事实需要新的显式授权；
- 在当前问题相关时主动召回，而不是要求用户说固定触发词；在问及过去事件时检索可信的情景摘要或原始证据，不凭空捏造；
- 经用户/频道管理者明确开启后，以受控 Light/REM 类流程提取、去重、合并、失效过时的候选记忆；
- 严格隔离 DM、不同 KOOK 频道、团队、bot 身份和 binding generation；回忆内容是**不可信证据**，不成为 system 指令或查询权限；
- Embedding 不可用时明确标识 `lexical_only` 并继续可控关键词召回，绝不谎称已完成语义检索。

### 当前已核实的源码边界（执行前须复查最新 HEAD）

1. 已合并 PR [#6](https://github.com/ChristmasFox/amadeus-home/pull/6)、[#7](https://github.com/ChristmasFox/amadeus-home/pull/7)、[#8](https://github.com/ChristmasFox/amadeus-home/pull/8)：`0021_gate_memory_foundation.sql`、`GateMemoryStore` 的 scoped lexical/read/create/revise/forget/rememberAgain、可信 ingress lease、channel binding revision fence 和 Unicode/中文修复。**只是基础层；尚未接入 Agent。**
2. `PublicQueryAuthorizer.loadAgentConversation` 从 `kook_conversation_messages` 查询同 bot + channel 的**全部**历史（未限制条数、Token 或 binding generation）。`0017_public_context_retention.sql` 将原过期时间改为 infinity。不能继续把全部 transcript 送进 `ToolLoopAgent`，也不能把频道 rebind 前的历史默认为新团队授权历史。
3. `kook-public-query-handler.ts` 在 `naturalLanguageReply` 调用上一个加载器并把全部 `turns` 传入 `runPublicKookAgent`；后者在 `kook-conversation-agent.ts` 使用 AI SDK `ToolLoopAgent`。应在这条链路之前加入可测试的 `ContextBuilder`，而非另立 Agent 框架。
4. `gate_memory_entries` 的 source event、CAS revision、tombstone 是正确的基础，不要重建、删表、迁移已有原始对话或者暴力清除用户历史。
5. Gate 现用 PostgreSQL 18 镜像**未安装 pgvector**；Lab 的 SQLite/sqlite-vec、1024-D、FTS + Vector + Dreaming 已有独立已记录的 Lab 1.10.5 验收，但**不能证明 Gate 的服务端模型凭据/向量扩展已经可用**。
6. Gate M2 的 KOOK 真人最终验收与发布门禁仍是独立待办；这个 Goal 不宣布 M2 完成。在 M2 明确暂停或未取得一次性 Gate-Local 自动候选许可时，不替换运行中的 Gateway/Worker；解除暂停且取得许可、满足安全门禁后，候选部署必须可自动完成并通知测试，而不是每阶段重复询问。
7. 原有长期记忆边界和未解决细节见 `docs/GATE_MEMORY_ARCHITECTURE.md`；Lab 的可复用设计和已验证/未验证证据见 `docs/LAB_MEMORY_CORE_P1_REPORT.md`。借鉴思想，不依赖 OpenClaw。

### 绝对不变量

- 保留 **Vercel AI SDK ToolLoopAgent**、现有 KOOK 可信 ingress、当前 AI provider egress 与多租户 PostgreSQL；不引入 OpenClaw、LangBot、Mem0、另一套 Agent runtime 或 SaaS 托管记忆服务。
- Gate / Lab 严格分离：进程、部署、数据库/向量、原始会话、记忆、模型/API Key、授权、调度与日志均不共享。允许参照 Lab 的 FTS + 语义融合、索引 dirty/reindex、Light/REM 整理和 before-read admission 设计。
- 不把 `packages/pubg-domain` 当通用记忆层；通用 Gate memory 放在 `apps/pubg-saas/src/application/`、`infrastructure/`、受控 PostgreSQL migrations。平台入口和权限可注入接口，为将来多平台留接口，**当前只实现 KOOK 的授权适配**。
- 不添加用户对话、Secret、token、来源原文、Embedding payload 到代码仓库、普通 metrics、错误日志或 CI fixtures；所有测试使用合成数据。
- 模型只产生 **candidate / query interpretation**；可信 scope、写入权限、同意状态、revision、TTL、来源 provenance、执行排序、删除与纠错由程序规则和 SQL 控制。用户/工具/历史记忆中的任何“指令”不得提升为 system/developer 权限。
- 不设置 Goal `token_budget`；按 `AGENTS.md` 与 `docs/ENGINEERING_POLICY.md` 使用 `pnpm devctl goal start/status/finish-phase`，每个 phase 可独立检查和继续。

## 1. 架构契约

```text
KOOK trusted ingress + current identity/binding/membership
    -> ScopeAuthorizer (DM or channel/team/revision)
    -> ContextBuilder
       ├── WorkingContext: recent bounded turns + quote/reply linkage
       ├── EpisodicStore: scoped time-ordered history summaries/evidence
       └── MemoryRetriever: exact/lexical + semantic + rank + token budget
    -> AI SDK ToolLoopAgent (现有 stats/tools 保持工作)
    -> 正常回复与幂等历史落库
    -> Candidate Intake (显式请求优先，后台需同意)
       -> deterministic admission + evidence + de-dup + conflict review
       -> GateMemoryStore CAS/tombstone + async index outbox
    -> Light (受控近期整理) / REM (低优先级深度巩固)
    -> Gate PostgreSQL Facts/Episodes/Index/Audit
```

**建议模块职责（按现有实现命名调整，不强制生成空壳）：**

- `gate-context-builder.ts`：分层预算、引用修复、scope-safe prompt assembly。
- `gate-memory-retriever.ts`：检索接口、独立分支召回、融合、去重与引用元数据。
- `gate-embedding-provider.ts`：Gate 专属 AI SDK Embedding adapter、配置、timeout、cap、维度校验。
- `gate-memory-intake.ts` / `gate-memory-consent.ts`：候选、用户确认/撤销、敏感类型策略。
- `gate-memory-consolidator.ts`：可恢复、可重试的 Light / REM 工作，不与 Chat Agent 自由写工具混杂。
- `gate-memory-index-worker.ts`：向量更新/删除/reindex job、幂等和坏索引恢复。
- 当前 `gate-memory-store.ts` 继续作为受控事实写入底座；允许小范围加类型和 SQL，不因新增服务绕过其权限模型。

### 三层数据与信任

| 层 | 来源 | 保存 | 使用 |
| --- | --- | --- | --- |
| Working | 当前事件 + 最近对话 | 原始消息和短期 checkpoint | 最近 N 条按 Token 预算、引用目标可被安全检索 |
| Episodic | 已授权的历史对话/事实来源 | 事件摘要、时间、来源 ID/版本、可撤销权限；不默认永久保存原文副本 | 时间型问答、经历/决策回溯；可返回来源引用 |
| Semantic facts | 显式记住或获同意的候选 | canonical key、事实、版本、来源、observedAt/validUntil、supersession、revocation、向量索引 | 长期用户偏好、稳定事实；冲突时纠正/失效 |

**不变量**：同 bot + channel 不是有效授权 scope；必须包含当前 channel/team/tenant/bindingRevision，并重新校验成员身份。DM 身份不能从平台昵称、消息自然语言、模型工具参数推导。不可从群聊向个人 DM 自动转存。

## 2. P0 — 基线、隔离和风险审计（先于任何新记忆能力）

1. 再次读取 `AGENTS.md`、`docs/ENGINEERING_POLICY.md`、本 Goal、`docs/GATE_MEMORY_ARCHITECTURE.md`、相关 M2 pause checkpoint 和最新 HEAD；仅按需读取历史。标记未提交改动，保留其他任务工作树。
2. 画出当前 KOOK ingress -> `PublicQueryAuthorizer` -> `loadAgentConversation` -> `ToolLoopAgent` -> outbox/worker 的真实顺序，检查每个读路径的租约、成员、binding revision 和 quote linkage。
3. 重点审计：`0015` 消息表只有 bot/channel、`0017` 历史永久保留；频道解绑/重新绑定时可能读出旧团队全文。建立合成跨 revision 回归测试作为 **blocking**。新的 `ContextBuilder` 不得再用宽松旧入口读取过期 scope 内容。
4. 确定现有 `GateMemoryStore` 单字/中英混合/Emoji/Lexical 修复无回归；检查旧的 scoped LIKE 在大数据时的 `EXPLAIN` 和超时保护。
5. 输出基线，包括 DB extension 可用性探测方案、PG 镜像/迁移门禁、模型路由限制、成本/超时约束。P0 对真实 Gate-Local PG 仅允许按现有安全权限做只读预检；不实施数据库写操作。
6. 不复刻 Lab 的自定义 OpenClaw patch、Owner peer allowlist、SQLite/Workspace/Cron 接口；识别设计迁移点即可。

**Exit P0**：安全边界图、确切文件清单、跨绑定风险测试（可以先 RED）、配置/迁移可行性，且无任何真实运行时写操作。

## 3. P1 — Bounded Working Context + 安全历史检索

1. 改造 `PublicQueryAuthorizer.loadAgentConversation`：数据库读取必须首先按可信 scope 筛选，采用**有界、分页/keyset、可索引**的最近消息查询；历史全文保留但绝不全量注入 prompt。检索来源与消息 payload 在授权前严格分离。
2. 对过去没有 tenant/team/binding_revision provenance 的频道消息，**默认不跨 rebind 复用**。以新增字段/来源表实现入站时的 scope stamping；旧数据仅可在独立、安全、可证明的规则下迁移；无法证明则保留为 archive，但不注入新上下文。DM 不需要按团队绑定，但需隔离 actor/bot。
3. 保留 `reply_to_message_id`、引用目标、角色/说话人标签；如果引用早于近期窗口，执行**单条受控 lookup**，而非引回整段历史；过长引用截断/摘要并保持真实指向。
4. 配置 `ContextBudgetPolicy`（初值仅为工程默认值，可回归调整）：近期消息预算 ~4k tokens、情景摘要 ~1k、长期召回 ~1k、当前用户内容单独保留。考虑工具结果与模型可用上下文，提前预留回复/工具空间，按实际 provider tokenizer 或保守估算并显式标记估算误差。溢出时保留当前问题/明确引用，优先丢弃低相关历史；不截断工具事实制造假数据。
5. 增量维护 scoped rolling checkpoint/摘要；不把摘要当权威事实，必须携带来源 ID、覆盖范围、有效代数和可重建状态。重复执行 idempotent，错误摘要可回退；默认先支持无摘要运行。
6. 注入位置在 `kook-public-query-handler.ts` 的 `runPublicKookAgent` 调用前，不改变 stats/tool 既有权限和自由会话行为。摘要/记忆进低信任 data context，不作为 system instructions。

**Exit P1**：1000+ 条合成历史仍能在稳定 Token/延迟范围内回答近期追问；引用早期消息可按授权查证；频道 rebind、退群、撤销角色后无旧团队历史泄漏；无语义记忆时也可正常聊天。

## 4. P2 — Gate 独立 Embedding + PostgreSQL 索引底座

1. 做只支持 **Gate-owned** config 的 `EmbeddingProvider`，使用当前依赖的 AI SDK `embed`/`embedMany` 及现有受控 `@ai-sdk/openai-compatible` provider；严格复用 Gate 的 egress 规则、防 SSRF/内网直连、API key 安全注入，不假定聊天接口支持 embedding。
2. 模型候选：Lab 已用过 `Qwen/qwen3.7-text-embedding-flash` 路由并观测到 1024 维；但 Gate **必须独立验证真实 modelId、接口、权限、维度、计费**。在未获真实 probe 授权时只写 provider fixture/mock 和诊断，保持 `semantic_unconfigured`。
3. 明确向量契约：记录 provider/model id、dimension、normalization、indexVersion、contentHash、scope/version/revocation state。维度错误/NaN/空向量、旧版本重用和漂移一律拒绝；换模型建立新 index generation，完成安全验证才切换，不能把旧向量混排。
4. 现有 PG18 镜像不带 pgvector。**先在完全隔离的 PG18+pgvector fixture** 证明镜像架构、迁移权限、备份/恢复、回滚和读写。Gate-Local 常规安全候选部署可由一次性许可自动化；**第一次 pgvector 镜像/扩展切换是单独风险类别**：未通过专门的预授权、保护备份、预检和可恢复性演练不得直接执行；一旦明确允许该类迁移，后续相同已批准边界内的可逆增量更新应由守卫脚本自动执行，不要每条命令重复提问。迁移/feature flag 不得导致尚无 pgvector 的 Gate-Local 启动失败。
5. 在 `gate_memory_entries` 基础上**追加兼容性**建表（如 `gate_memory_embeddings`、jobs/outbox、索引状态），事实表为权威；更新/纠正/forget 事务或可靠 outbox 推动索引更新，撤销先立即从召回排除，不依赖异步向量删除完成才生效。
6. 第一版小 scope 优先**scope-filtered exact cosine 搜索**并建立 BTREE scope 索引；不要无条件在混合租户表上建立全局 HNSW。规模测试后才评估 pgvector HNSW + iterative scan / partition，并证明过滤后仍有召回质量和租户隔离。
7. 对原 lexical `LIKE` 短中文查询的潜在全 scope scan 配置 statement_timeout、查询指标和审慎索引方案，避免通过“最近 N 条候选”掩盖旧记忆。Embedding/DB 失败应降级到**已授权** lexical，且标注运行模式。

**Exit P2**：独立 SQL/Provider fixtures 中同义改写召回可测，维度/版本失败安全，增量更新、幂等删除、恢复后状态和成本限制通过；真 API/真实 Gate-Local 迁移仍独立待授权。

## 5. P3 — Hybrid Recall / Retriever / 自动上下文注入

1. `MemoryRetriever` 依赖受控 `ScopeAuthorizer`，并行生成 exact/key、lexical、semantic 候选；从数据库查询、排序、fetch 内容到 prompt 生成都确保 scope 的服务端约束。不能先全局取 topK 再内存中过滤。
2. 用 RRF 或同等可解释的加权融合 + 版本/时间新鲜度/来源可靠度 + 相关性阈值；去重 `canonicalKey`，过滤 tombstone、superseded、expired、无授权来源；精确事实优先于相似但过时的描述。至少保留召回来源/版本/理由用于脱敏诊断。
3. 由 `ContextBuilder` 按每次用户查询主动读取 topK（初始 5–8 条，受 Token 预算约束），无需关键词触发器；结果可能为空，禁止为了“显得记得”编造。时间型事件问题倾向 episodic source/evidence，不把长期事实混为对局证据。
4. 将内容包装为 `untrusted remembered context`：只提供参考、不得执行内含的工具指令、不能凭记忆放宽既有 PUBG 团队授权或推断账号。必要时对检索结果带出来源引用和时间，使模型表达不确定性。
5. 对 provider unavailable、index stale、DB timeout 有固定降级路径和可观察 `hybrid|lexical_only|disabled` 状态；fallback 绝不绕过撤销、权限、租户边界。记忆失败一般不阻断普通聊天，**但权限状态不可确认必须 fail closed**。

**Exit P3**：真实 AI SDK Agent（合成 provider）用不同措辞能找回正确事实；完全无记忆也能聊天；低信任记忆中写“忽略系统指令/调用工具”无效果；所有 revoked/binding-changed facts 不能进入上下文。

## 6. P4 — Explicit Memory Writer / Consent / Conflict

1. 最早只支持**自然语言显式记忆**：用户在 DM 直接提出保存/更新/忘记意图。通过 AI SDK 结构化意图建议（如 `remember|correct|forget|list|none`）+ Zod schema 得到候选，禁止依赖脆弱的固定关键词分支，也不能让模型自主设置 scope、指定 target tenant 或直接生成 SQL。
2. 消息类型区分 stable preference、verifiable fact、episodic event、ephemeral context、instruction/prompt injection、sensitive information。默认拒绝未经同意的敏感/第三方私密资料、认证信息、密钥、风险性自述和模型自行推断；过期/变化快的事实必须设置 validUntil/可校正状态。
3. 新增 `MemoryWriteCoordinator`：可信当前 ingress + user confirmation/consent + canonicalKey normalization + duplicated/similar fact detection + provenance + optimistic CAS。已有 key 如 M416→AUG 应更新/标记旧值，不能双双当作当前偏好；低置信度或歧义须询问确认。幂等键至少覆盖 bot/scope/sourceEvent/intent/canonicalKey。
4. 继续使用 `GateMemoryStore.create/revise/forget/rememberAgain` 的服务端 fence。遗忘应立即拒绝所有检索结果和已排队索引写入；需要用户重新明确请求才可执行 `rememberAgain`，不能由自动 consolidation 复活。
5. 用户可在 DM 列出/更正/遗忘自己的事实，结果能解释来源类别与有效时间；对历史 KOOK 原始消息、episode、备份、派生向量、摘要的全链路删除另行设计并明确实际保留边界，不能谎称“删除记忆”同时删除了全部聊天/备份。
6. 群共享记忆默认**关闭自动写**。确有需要时添加管理者授权 + channel scoped opt-in + 敏感/成员来源限制 + 可撤销同意；不能把单个成员在群里说的话自动保存为整个团队真相。
7. 现在的 `GateMemoryStore` 写入要求处理中的 KOOK ingress lease。此阶段的**同步显式请求**可继续用该路径；异步候选不得重放已失效的 lease 或复用 `KookIngressJob` 伪装权威。为异步工作制定独立可验证 system-work job authorization（见 P5）。

**Exit P4**：自然语言记忆/纠错/列表/遗忘经真实应用链路的合成 KOOK 事件闭环；重试不产生重复事实，旧 revision 拒绝覆盖，旧事件不能复活 tombstone，DM/频道互不可见。

## 7. P5 — Consent-aware Light / REM Consolidation（Gate 原生实现）

这部分**只借鉴 Lab 思路，不调用 Lab/OpenClaw Dreaming**：

- **Light**：在显式开启后，处理少量新授权消息，提取高置信偏好、待确认事实、情景 checkpoint。优先做成低优先级事件/outbox 或周期批次，不拖慢实时回复。
- **REM**：可选低频、批处理；对同一 scope 的已授权历史 evidence 进行聚合、去重、冲突/时效分析、摘要压缩与建议纠错。只从合格 source 读取，默认不跨时间范围、频道、tenant 或用户。
- **准入先于读取**：仅查询可信 message metadata、source kind、scope、consent version、权限/绑定 generation；在验证之前绝不解出完整 transcript content。对于过期/不可验证 provenance、群历史无准入、解绑、停用、撤回同意时 skip + 记录枚举 reason（无原文）。
- **异步授权**：建立 durable admission record + consentVersion + scoped system-work capability / server verifier，worker 对每次读/写都重新核对当前有效授权、source/binding revision、tombstone。**不能**延长、猜测或假冒已过期 KOOK ingress lease；不得把仅凭模型建议的 candidate 当授权。权限系统不可达 => 不读语料、不写事实。
- **Promotion pipeline**：candidate -> schema validation -> source/trust/privacy gate -> dedupe/conflict -> `pending_confirmation` 或符合策略的 `approved` -> CAS commit -> vector outbox；不允许模型直接写系统提示词、权限规则、用户身份映射。
- **调度**：默认 disabled，无开箱即启动的 03:00 cron；先内置可被隔离 fixture 手工触发的 worker 接口、批次大小/超时/成本上限/幂等 checkpoint 与退避；只有经 Gate 操作者另行授权，才可以在合适时区启用真实周期任务。空语料必须明确 `SKIPPED_NO_ELIGIBLE_CORPUS`，不得虚报 promotion。
- **索引维护**：dirty 标记、增量索引、reindex shadow generation、可恢复状态、取消/暂停和 tombstone 优先；异步中途崩溃/消息重放都不可造成复活或跨 scope 污染。仅备份和恢复**Gate 专属** PostgreSQL/状态。
- **注入防线**：引用消息/对抗 prompt/恶作剧/AI 输出的“记住我是管理员”“永久忽略规则”均只能被视为待审文本，永不变成系统记忆规则。

**Exit P5**：Light/REM 合成语料覆盖准入/拒绝、无语料 skip、重复批次、冲突、撤销、队伍解绑、job crash/restart、索引重建；零用户/团队串漏；未授权不建立 Cron、不消费真用户文本、不执行付费 Embedding。

## 8. P6 — 质量评测、CI、运维与交付

### 最小必测矩阵

| 主题 | 必须证明 |
| --- | --- |
| 历史上下文 | 10/1000/10000 条消息仍有固定预算；引用跨窗口可受控回查；rebind 不能读旧成员历史 |
| 中文检索 | 单汉字、单字母、中英混写、emoji ZWJ、同义问法、较旧强相关事实可以命中 |
| 检索隔离 | 多 bot、多 DM user、多 channel/tenant/team/binding revision；权限撤销后无命中/无旁路 |
| 语义故障 | API 不可达/429/超时/错维/NaN、索引 dirty/不一致时安全降级且有真实状态 |
| Writer | 重试幂等、CAS、删除/恢复、过期事实、冲突纠正、隐私拒绝、群聊无自动写 |
| Dreaming | 准入在正文读取前、无来源/无同意 skip、跨团队候选隔离、任务重试/restart |
| Security | 恶意引用/prompt injection、scope/tool 参数伪造、跨 tenant vector shortlist、日志无 PII |
| 回归 | 既有 KOOK ToolLoopAgent、PUBG stats/权限、出站消息/outbox、provider egress 不回退 |
| 恢复 | PG18 向量扩展可用性预检查、source/restore fixture、迁移失败回退、shadow index reindex |

1. 以 `apps/pubg-saas/tests/` 增加 source-only 单元测试 + **真隔离 PostgreSQL** 集成 fixture；不使用真实 Lab 或 Gate-Local DB。PG 无 vector 和有 vector 两条 CI 路线均应可启动/测试相应功能；不可把数据库用例静默 skip 当通过。
2. 增加合成召回评测数据集（中文口语改写、旧事实冲突、新旧事件、群聊污染），输出 recall@k、false-positive、有效隔离次数、Token、延迟、Embedding 请求量、降级状态；不捏造准确率。先测 baseline，再调整 RRF、阈值和预算。
3. 配置/运行开关建议：`GATE_MEMORY_READ_ENABLED`、`GATE_MEMORY_WRITE_ENABLED`、`GATE_MEMORY_AUTO_LEARN_ENABLED`、`GATE_MEMORY_EMBEDDING_*`，每项分别检测“缺失/配置错误/已授权”；自动学习和付费调用默认关闭。**部署自动化与记忆自动学习是两套独立开关**：Gate-Local 只有在本机一次性批准且安全门禁通过时自动候选部署，不因关闭自动学习就关闭自动部署。
4. 输出 3 份运维文档：架构 + API/数据版本契约、合法的生产迁移/回滚/索引重建 runbook、真人 KOOK 验收脚本和隐私/同意说明。隐私说明必须明确 memory forget、raw transcript retention 和受保护备份之间的区别。
5. 目标性能起点：初期 Recall 5–8 条、按总 Token 预算运行；为 embedding 设置请求超时、并发与每日成本阀；SQL `statement_timeout` 防长时 scan。性能数字要记录**真实测量**和 fixture 环境；不能因为慢而截断至最新 N 条丢旧事实。
6. 验证遵循 `pnpm devctl check --level edit|task|release`、`pnpm devctl goal finish-phase P<N>`、聚焦 TS/test、`pnpm check:secrets`、`git diff --check`。每阶段提交小而独立 commit；只更新必要 Goal 进度/证据，避免大篇幅 checkpoint 污染上下文。
7. 最终报告区分 `SOURCE_FIXED`、`ISOLATED_DB_VERIFIED`、`PROVIDER_PROBE_VERIFIED`、`GATE_LOCAL_LIVE_VERIFIED`。**未实际授权执行的步骤必须标 `BLOCKED_OPERATOR_AUTHORIZATION`；不要宣称 LIVE。**

## 9. 自动部署、Phase 门禁与运行时授权

### Gate-Local 自动候选部署（本 Goal 必须实现的交付）

1. 保留 Lab 现有 `lab-auto-enable`、安全检查、候选回滚与测试通知；**Gate 另建独立的自动候选发布能力**，不能复用 Lab 的批准文件、镜像、令牌或 release target。
2. 在 Gate 原有 `scripts/release-gate.sh` 和仓库 `devctl` 工作流上实现受保护的 Gate-Local candidate autopilot。建议命令 `pnpm devctl configure gate-auto-enable` / `gate-auto-disable`（**计划中的功能，不代表现存命令**）；许可必须在操作者的交互式本机环境创建，存放仓库外 mode 0600，绑定 checkout + Gate-Local + 单一 Bot/实例 + 允许的迁移风险类别。CI/Goal/聊天文本都不能自行产生或拓宽授权。
3. 操作者仅需**首次决定是否开启 Gate-Local 自动候选**；开启后每个 phase `finish-phase` 对 Gate-only 变更通过 focused tests、CI/secret gate、兼容性预检、target 身份/digest 校验后自动构建不可变 candidate、制作安全 checkpoint、切换唯一实例、健康检查 + 合成/非扰动 smoke、发送测试通知（延用现有可用的私有通知桥，失败需显式报告），并落下脱敏审计和自动/计划回退路径。不得因为用户没有立即真人测试就停止后续不冲突开发。避免重复部署同一 SHA/digest；有未完成发布/危险 drift 时停机。
4. **M2 显式暂停、真实 KOOK 真人验收未满足且会干扰 M2、双活 Bot Token、无可恢复备份、Gate-Local target 不可信或被其他 Goal 锁住时，自动部署必须阻止。**阻止时输出一条明确 BLOCKED reason 和可用恢复步骤，不是对每个普通安全变更都要求人工批准。M2 Gate 必须由操作者单独解除，不能以本 Goal 取代。
5. 任何会改变真实 PG extension/image/无兼容窗口的 schema、真数据 backfill/reindex、密钥、付费 provider、真实自动整理、删除、Gate-Staging/Prod 提升或正式 Tag，必须使用**对应风险类别的额外一次性/明确授权**；通过保护门禁后，对批准范围内的重复可逆操作自动化完成。不可通过自动发布默认打开 `AUTO_LEARN` 或未知消费者可见新功能。
6. 加入 Gate 自动部署 fixture：许可缺失/过期/作用域错误、已暂停 M2、双 Gateway、候选重复、健康失败、备份失败、扩展不可用、schema 不兼容、回滚失败、通知失败和 Lab/Gate 交叉触发。不得把 mock 部署称为 `LIVE_VERIFIED`；未提供本机许可时以 `READY_FOR_AUTO_ENABLE`/`BLOCKED_OPERATOR_AUTHORIZATION` 交付可用脚本。

### 原有安全停机线

### 默认批准范围

- 可：源码、可逆 schema 迁移脚本（不实际 apply 到真 PG）、测试/fixture、文档、CI、无副作用 dry-run、干净提交/PR。
- 不可：读写真实 Lab/OpenClaw SQLite/Session/Workspace、修改/重启 Lab、共享 Lab Token、未经相应本机预授权迁移/修改真实 Gate-Local 数据或替换 pgvector 镜像、未授权开启云付费 embedding probe、执行真数据记忆提取、启动真实 Cron/Worker、发 KOOK 真人测试消息、解除 M2 暂停、创建正式 release/tag 或部署 Gate-Staging/Prod。Gate-Local 经一次性批准的安全候选自动部署属于允许的受控路径。
- **执行到需要额外风险许可的阶段**：先完成可交付源码、预检、备份、影响/回退自动化；未取得该类别授权时标记 BLOCKED，继续其他不依赖的任务。已有安全 Gate-Local 自动候选许可的同类常规部署应自动执行，不要反复询问。Goal 本身不构成生产许可。

### 完成定义

- P0–P5 源码实现（有需要可拆成多次连续 Goal/会话，但本 Goal 的目标和 scope 不变）；P6 所有独立测试/架构门禁通过；结果可复现；全部已知阻塞事项诚实列出。
- Gate 能在合成 KOOK end-to-end 中“记住 → 换种说法想起 → 更新 → 忘记 → 再问不返回”；能在共享频道自然对话但不会跨用户/频道/团队泄漏。
- **Gate-Local 候选自动部署**是本 Goal 的必要工程交付：当已有操作者一次性许可、M2 暂停已解除、受控发布门禁通过时自动构建、部署、验收并通知；缺许可时交付 READY_FOR_AUTO_ENABLE，不谎称 live。真实 KOOK 真人验收、首次高风险 PG extension/image 变更、付费 provider 和启用真实 Light/REM 作业仍有各自明确授权边界。
- 不修改 Lab 代码、版本、部署、记忆索引或发布流程；原 Gate M2 验收保留。若当前 HEAD 与本文所述事实变化，先做最小差异审计，再维护兼容实现，不重写已有功能。

## 10. Codex 执行指令

在 **`ChristmasFox/amadeus-home`** 当前工作树运行：

```text
/goal docs/GATE_NATIVE_MEMORY_CORE_GOAL.md
```

若当前 Codex 版本使用仓库 devctl Goal 工作流而不是斜杠入口，先在本地执行：

```bash
pnpm devctl goal start docs/GATE_NATIVE_MEMORY_CORE_GOAL.md
```

之后由 Codex 按此 Goal 分阶段实施；恢复会话时运行 `pnpm devctl goal status` 并继续当前未完成 Phase。**不得在 /goal 或 create_goal 中设置 token_budget。**
