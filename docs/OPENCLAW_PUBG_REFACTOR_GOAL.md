# OpenClaw + PUBG 一次性重构 Goal 计划书

状态：READY_TO_IMPLEMENT。本文是实施规格，不是代码完成或部署成功记录。
日期：2026-09-17。仓库：ChristmasFox/amadeus-home。
审查基线 commit：1aaadfc925d6611eb518e929344c295b205b8d1f。

## 1. 唯一目标与范围

把 amadeus-home 的聊天与 PUBG 主链一次性改造成：

Telegram/WhatsApp 聊天 → OpenClaw / Kurisu（当前 9Router 模型）→ 原生 PUBG 插件及其渠道适配层 → 独立 PUBG Domain → PUBG 官方 API + SQLite。

本轮只实现一个业务插件 PUBG，保留普通聊天。OpenClaw 独占理解、规划、工具循环、会话、记忆及人格；插件提供确定性数据和事实，不再调用 LLM。使用 OpenClaw 原生插件发现、加载和工具注册，不再自建 Amadeus Core、Plugin Registry 或 Plugin SDK。

用户已明确：线上没有用户，可以测试、停机和迁移；直接完成最终架构，不做灰度、影子实例、双跑、兼容过渡态。实现可以分提交推进，但最终不得保留旧运行主链或以“以后迁移”收尾。

本次交付为计划与 Goal；由本地 Codex 执行完整重构、必要构建、CasaOS 一次性切换、验证、提交与 push。无须逐阶段再次询问是否继续。不能绕过运行环境权限；缺凭据/主机访问时先完成所有可独立工作，再准确记录外部阻塞。

### 明确排除

- 不实现 Radar、Homelab、Codex、Media、Briefing、通知中心业务插件。
- 不建立通用 job/approval/notification 框架、插件市场、热加载、跨框架 SDK 或管理界面。
- 不接入 KOOK 等未启用渠道；Telegram 和 WhatsApp 使用 OpenClaw 原生渠道，PUBG 插件在边界通过 adapter 归一化会话上下文。
- 不为纯函数或 Tool 单独建 HTTP 微服务、独立 Docker、Redis、队列或 Kubernetes。
- 不通过关键词、正则、意图枚举或固定问法 workflow 调度自然语言。
- 不把“没有用户”理解成可删除凭据、媒体文件、NAS 数据或其他服务的数据。

## 2. 已读仓库事实及重构映射

当前文档存在历史叠加：AGENTS/README 中部分“只有计划”表述与 PROJECT_STATE 的部署记录不一致。执行以源码、Git 与本机探测为准，不能把历史通过证据视为新架构通过。

| 已核验位置 | 当前职责/问题 | 最终处理 |
| --- | --- | --- |
| packages/pubg-domain/src/index.ts | 反向 export apps/agent-runtime；还导出 planner/subgraph | 真正迁入领域实现；彻底移除对 apps、Mastra、OpenClaw、平台 API 的依赖 |
| apps/agent-runtime/src/engine/query-engine.ts | 聚合、指标、选局等确定性计算 | 提取可复用计算；补齐查询表达能力与正确性测试 |
| apps/agent-runtime/src/review/ | Telemetry、团战、载具、队伤、闪光、重武器等丰富事实 | 保留有效事实能力与证据；移除 Agent/workflow/固定成品文案耦合 |
| apps/agent-runtime/src/config/team.ts、chicken-index.ts | 队伍别名和娱乐指标权重 | 保留确定性配置，账号和队伍运行配置外置；不变成自然语言路由 |
| scripts/generate_pubg_v3_data_workflow.js、integrations/n8n/workflows/pubg-* | 数据覆盖检查、补齐、缓存/同步逻辑 | 移入 API client/repository；一次性导入可用历史数据后退休 PUBG workflow |
| apps/agent-runtime/src/kurisu/、planner/、runtime/ | 中央网关、工具系统、旧决策/编排 | PUBG 不依赖；本轮旧主链退休，不创建一个 OpenClaw→旧网关套壳 |
| integrations/langbot/plugins/kurisu-gateway、pubg-stats-v2/v3 | 原平台入口与桥接 | 退出运行与默认安装；源代码移除，历史由 Git 保留 |
| apps/telemetry-worker、apps/whatsapp-adapter | 指向旧 Runtime 的 facade | 迁走实际所需 PUBG 逻辑后移除无效 facade |
| docs/KURISU_CODEX_GOAL.md 等旧计划 | 要求 LangBot 多领域 P0–P7 | 本文取代该方向；不得继续旧全量目标 |
| docs/PROJECT_STATE.md | 记录 9Router 不接受 dotted function name | 模型工具名使用 pubg_query_stats 等下划线名；真实验证当前 route |
| integrations/codex、Radar outbox、日报 n8n | 已依赖旧 Runtime 通知端点 | 明确停用/断开旧 producer，保留 pending 数据；不借此实现通知插件 |

不要只搬入口文件。先沿 import 和调用点定位真实 data/model、provider、存储、schema 及 API 代码，检查是否被忽略或仅存在旧运行资产中。缺失源码须恢复到 Git 后改造；不允许保留对运行容器代码的隐式依赖。

## 3. 最终目录与依赖约束

建议结构（可按实际工程调整内部文件名，不改变职责）：

- plugins/pubg/：唯一 OpenClaw 原生业务插件；原生 manifest、package、src/entry、tools、skills/pubg/SKILL.md、入口测试。
- packages/pubg-domain/：API client、repository、SQLite、查询/指标/比较、Telemetry/事实、纯类型、领域测试。
- integrations/openclaw/：脱敏配置模板、Kurisu workspace 模板、9Router/Telegram 接线说明。
- infra/docker/casaos/openclaw/：固定版本/可重建部署定义、持久化卷和健康检查。
- scripts/：构建、安装验证、一次性数据导入、切换、定向验收。
- docs/：新架构、指标口径、操作说明、验收证据和进度。
- 非本轮独立应用可保留源码及自身部署，但不能作为新 PUBG 必需依赖，不能默认继续调用已移除端点。

Domain 不 import OpenClaw/Mastra/LangBot，不通过 ../../../apps 反向导出，不读聊天、不生成最终人格回复。SDK 相关 import 仅在插件边界。插件直接调用 Domain，不新增 HTTP hop。pnpm workspace、根 scripts、TS project references 和 lockfile 同步收敛；安装/构建不能暗中依赖被退休的 app。

不新建空 packages/contracts、openclaw-utils 等预留层。现有 shared package 只有被保留应用真实使用时才留下。

## 4. OpenClaw 接线与版本验证

执行时先查看官方文档、拟安装精确版本的源码/类型与本机 Node 要求，再锁定 OpenClaw、SDK 使用方式和镜像/依赖版本；禁止把聊天示例 API 当可直接编译实现。原生 manifest、bundled skill 路径、工具 schema、返回结构、配置和安装方式必须在该版本实际加载验证。

参考（实施时复核，不代表已经验证本地安装）：
- https://docs.openclaw.ai/plugins/sdk-overview/tools-and-commands
- https://docs.openclaw.ai/plugins/manifest
- https://docs.openclaw.ai/channels/telegram
- https://docs.openclaw.ai/concepts/model-providers

9Router 继续用现有有效 endpoint/model route，key 从外部 secrets 注入。不得偷偷换模型来通过验收。独立工具注册，不用一个 action enum 的万能网关遮住全部能力。先验证一次真实 tool call → tool result → 最终回答，再验证多步组合。API 名称采用 provider 兼容字符，例如 pubg_query_stats。

Telegram 和 WhatsApp 使用 OpenClaw 原生渠道；同一账号/会话只能有一个有效消费方。切换前停止旧 LangBot 消费并处理既有 webhook/polling 或 WhatsApp Web 会话配置。可信用户/会话身份由渠道提供；插件参数不能覆盖身份。Telegram 私聊允许用户来自外部配置，WhatsApp 私聊默认 pairing。群聊策略由渠道配置控制，不把用户名当认证身份。

Persona 放在所选版本实际支持的 OpenClaw workspace 文件：理性、技术型、偶尔轻微吐槽，不每句傲娇；保留事实、单位、失败状态；不装作有不存在的能力。会话记忆与“上一组比赛”引用不重新造一个全局聊天状态仓库。

### 部署决定：OrbStack Ubuntu/CasaOS

本轮 OpenClaw Gateway 与 PUBG 插件同进程运行在 OrbStack 的 ubuntu machine 内 Docker/CasaOS，由 Compose 管理；不额外在 macOS 安装第二个 Gateway。官方支持 Docker Gateway；此处选择基于现有 Homelab 运行方式和 PUBG 仅需网络/数据能力，不是宣称 Docker 对所有 OpenClaw 用途都最佳。参考：https://docs.openclaw.ai/install/docker 。

- Compose 落点 /var/lib/casaos/apps/openclaw/docker-compose.yml；状态、workspace、插件缓存和 SQLite 持久化到 /DATA/AppData/openclaw，SQLite 放 Linux 本地盘，备份可复制到 Avalon。
- 使用可验证的 ARM64 镜像/依赖，固定版本；设置 restart policy，验证 Ubuntu/Docker 启动及容器重启恢复。Mac 仍必须开机并允许 OrbStack 运行，容器不能解决宿主休眠。
- 9Router 保留原位置。在实际容器内验证 DNS、路由、代理和工具调用；容器内 127.0.0.1 不代表 macOS 或另一个容器。按实际拓扑配置可达 endpoint，不猜测宿主网关地址或扩大公网暴露。
- 验证 Telegram、PUBG API、Telemetry 和 9Router 四条出站路径，明确 proxy/no_proxy；不要只验证宿主浏览器可访问。
- 不挂载整个 macOS home、NAS 媒体目录或 Docker socket；PUBG 不需要这些权限。管理端口按实际访问需要绑定，保留认证。
- 将来接入宿主机 Codex/钥匙串/桌面时再使用针对该能力的宿主执行器或官方节点能力；本轮不预造执行器。原生 macOS 权限/GUI 密集使用时可重新评估 Gateway 放宿主机，但不为未实现能力增加当前链路。

## 5. PUBG 工具面

工具粒度按完整业务操作设计，以下六项为基线；只因明确能力重叠才合并，并在报告说明。

| 工具 | 输入/职责 | 结果 |
| --- | --- | --- |
| pubg_resolve_players | 已配置队伍、别名、平台玩家名解析；必要时官方 API 查账号 | accountId、shard、候选歧义；不静默选错同名人 |
| pubg_search_matches | players、时间范围、模式/地图/时段过滤、排序、分页，或最近 N 场 | 稳定比赛摘要、matchId、可追问引用及覆盖状态 |
| pubg_query_stats | 同类 selector + metrics/groupBy/排序；内部补数据并聚合 | 个体/队伍/按日指标；不强制模型搬运数百个 ID |
| pubg_compare_stats | 两个或有限多个 selector/cohort + 指标 | 确定性样本量、均值、差值、比例和比较限制 |
| pubg_get_match | matchId | 单局、参与者、地图、时间、名次等基础事实 |
| pubg_get_review_facts | matchId、players、可选事实类别 | 基础战绩、团战、关键事件和证据；不输出臆测战术结论 |

工具 schema 使用明确结构、范围限制、最大 N/分页上限、稳定排序。支持 player、day、map、mode 等必要 groupBy；支持一天内 before/after 或区间（含跨午夜）。“今天/昨天/前天”由主 Agent 结合当前时间/时区转为显式边界；Domain 只接收校验后的结构化 selector。可复用确定性日期运算，不复用中文关键词 planner。

“今天 vs 昨天”“最近两周 22 点前后”“同地图下两个人对比”不得新增专用接口或修改全局 prompt 路由。普通查询一次 queryStats 能完成就不人为拆成多步。compare 从可信查询/selector 计算，不接受模型随意提交的统计数字当事实。

结果至少含 status、data、coverage、asOf、metricVersion、queryResolved、evidenceRefs。明确区分 ok/partial/no_matches/error；unknown coverage 不是 0 场。错误给出稳定 code、可重试性和必要原因，不能暴露 key。

可使用短期持久化 resultSetId 支持“第二把/刚才那些”，绑定可信会话/查询对象，记录过滤条件、排序、生成时间和 TTL；过期说明或重新查询，禁止串会话。matchId 本身用于公开比赛事实，不因此虚构私有数据授权。

## 6. 数据层与统计正确性

### API 与缓存

1. 直连官方 PUBG API：玩家发现、比赛详情和 Telemetry；保留平台/shard 语义，核实 API 可发现历史窗口和限流，不能承诺任意历史都可补齐。
2. SQLite 为 PUBG 唯一业务缓存/结果引用存储；matchId 去重，记录抓取时间、来源、schema/parserVersion、失败和覆盖信息，支持重启恢复。
3. “今天/最近 N 场”重新检查必要 freshness；缓存非空不能证明最新或完整。失败时可返回标明 stale/partial 的已知事实。
4. API timeout、429、5xx 使用有界退避、Retry-After、并发上限和取消信号；拒绝无限重试/后台悬挂。
5. Telemetry 按需获取、限制响应大小与解析工作量；必要时使用进程内 worker thread，不能阻塞宿主长时间运行。传入取消/超时并清理连接、句柄。
6. Telemetry URL 只来自已验证官方比赛数据，限制协议、目标与重定向；不提供任意 URL/SQL/shell 工具。
7. coverage 分开说明“发现窗口是否完整”“已发现比赛抓取是否完整”“Telemetry 是否可用”。未知总场次保持 unknown；不可因已发现 ID 全抓到就宣布时间窗口完整。

### 指标

- 读取旧 normalizeRecords、deaths/deathSemantics 与 fixtures，核实死亡口径及复活模式影响；不得把 deaths 写成 matches 或 matches-wins。
- KD=总 kills/总 deaths；assists 不计入。现有 query-engine 零死亡返回 null，默认保持并附 denominatorZero 原因，不输出 JSON Infinity/NaN；如修正语义，记录 metricVersion 和例子。
- knock、被击倒、救援分别定义，不能因中文“倒地”混淆 DBNO 与被击倒次数。
- 个人场次按参与去重；小队场次按 matchId 去重，人数总计不是场次。明确 tracked-any、全员同队等 selection 口径，不把其他队队友纳入预设四人。
- 有效参与和未记录分开；缺失不填成 0 表示打过。
- 时间使用明确 IANA 时区，默认 Asia/Shanghai，范围 [from,to)，按比赛开始时刻筛选；明确自然日与旧 business-day 差异，默认自然日 00:00，保留用户显式业务日配置。
- 比较给出样本场数、模式/地图差异、总量与场均；相对变化分母为 0/缺失返回 null+原因。不要从观察性数据断言因果。
- 娱乐指数保留已有有意义公式/权重及版本，解释为娱乐指标，不用模型临时发明分数。

### 复盘保真

保留已经存在的事实提取：击杀/助攻/伤害、DBNO/救援、名次、载具里程及伤害、团战分段、队友互殴、队伤/载具碰撞、闪光、重武器和已有可靠补充事件。各类不可观测值返回 unknown/unsupported，不“没检测到”就断言未发生。

每条关键事实可追溯 matchId、eventId、timestamp、actor/target 与来源。保留去重、团队伤害排除和团战完整性校验。Telemetry 不可用仍能给基础战绩，但不生成虚构团战。Agent 评价必须区分事实与推测，数据不能证明的“交叉火力/换位慢”不得写成事实。

## 7. Skill 与表达

bundled PUBG Skill 写清工具用途、默认队伍/时间/时区来源、缺数据处理、指标口径、追问引用、比较限制和证据纪律。给少量组合例子，不能硬编码每种用户句子或把评测保留集抄进 prompt。

“KD 多少”简短回答；详细战绩可以榜单与队伍汇总，保留助攻/倒地/救援及娱乐亮点；复盘根据问题详略。Telegram/WhatsApp 移动端优先短段落，避免宽表。Plugin 返回结构化事实，最终文案由同一个 Kurisu 组织；数字不可改写。

## 8. 一次性迁移与彻底清理

迁移前做一次仓库外的数据/配置备份和版本记录即可，不实施灰度、shadow、流量比例、双写、回滚演练或兼容 fallback。备份是数据保护，不是保留运行旧架构。

1. 盘点本轮会停止的服务/工作流/定时器/本机 hook、真实数据位置、其他消费者；形成具体清单后自动执行已授权范围。
2. 把可用旧比赛/Telemetry 数据导入新 SQLite，校验 unique match 数、关键指标抽样及覆盖状态。保留无法补抓的历史数据。导入器幂等、重复运行不复制，错误行有报告，不静默丢弃。
3. 旧 conversation/resultSet/审批/非 PUBG pending 不自动装成新 Agent 记忆。保留仓库外快照，明确哪些不会继续执行。
4. 关闭依赖旧 Runtime 的 Radar central notification、日报 handoff、Codex notify drain 等 producer，避免持续错误/积压与重复发信；保留待投递数据。独立业务可保留原数据和源码，但此次不保证其机器人入口继续可用，也不为其保留旧中央 Runtime。
5. 停止旧 Telegram consumer，启动唯一 OpenClaw 实例及 PUBG 插件；移除本项目旧 LangBot/Runtime 自动重启项。共享 LangBot/n8n 实例若还有仓库外消费者，只关闭本项目 bot/flow，不停无关服务。
6. 删除旧主链代码、依赖、facade、PUBG n8n generators/workflows、废弃构建部署入口与兼容 flags；历史代码由 Git 保存，不整包搬入 legacy/ 继续保留第二套实现。保留有价值测试，迁到新边界；不删失败测试掩盖回归。
7. 清理默认 Compose、workspace、bootstrap、doctor、backup、CI 与 README 中旧启动必需项。保留非 PUBG 应用须能独立构建，不能反向依赖删除的 Runtime；不允许留下失效 importer。
8. 更新 AGENTS、旧计划入口与状态文件，明确新架构唯一入口与本轮延期功能。旧设计文档可标 SUPERSEDED 作为历史，但无可执行旧 Goal 继续引导实现。

最终正常启动仅需 OpenClaw、PUBG 插件数据卷、当前 9Router 和外部 PUBG/Telegram/WhatsApp；PUBG 路径对 LangBot/Mastra/n8n/旧 Runtime 的运行依赖为零。

## 9. 执行顺序与阶段交付

| 阶段 | 必须产出 | 退出条件 |
| --- | --- | --- |
| S0 事实与契约 | 最新 Git/运行清单、版本决定、迁移/退休清单、工具与指标契约 | 所需源码/数据定位清楚；没有继续旧 P7 的冲突 |
| S1 Domain 落地 | 真正独立 pubg-domain、API/SQLite、历史导入器、确定性计算/复盘 | 领域测试与独立 build/typecheck；无 apps/SDK/Mastra 依赖 |
| S2 原生插件 | 实际可安装的插件/Skill/配置、真实 9Router 工具循环 | 原生加载、工具 schema、真实模型普通/多步调用正确 |
| S3 一次性切换 | 构建和 CasaOS 配置、数据导入、旧 consumer/producer 停用 | 新单实例运行；旧链不可再参与 PUBG |
| S4 收尾 | 旧代码/依赖/脚本删除、文档、定向验收报告 | 第 10 节全部必需项通过，提交/push 完成 |

阶段是工作检查点，不是阶段性产品架构。每阶段更新 CURRENT_TASK、PROJECT_STATE、.agent/state 及 dated checkpoint；不要阶段结束就停在“要不要继续”。建立 docs/reports/OPENCLAW_PUBG_PROGRESS.md，逐条标 pending/pass/fail/blocked 与证据，不用百分比掩盖未完成项。

## 10. 精简但真实的验收

只跑改动相关测试和必要集成，复用有效领域 fixture；不重复旧 100 条跨领域审批/通知矩阵，不做无关服务回归或发布演练。以下是当前验收范围的明确替代，不是降低同范围正确性。

### 确定性和故障测试（必须全部通过）

- KD/零死亡/assists 不入 KD、缺失参与者、队伍场次去重、时间边界、跨午夜和组间比较分母为零。
- 有数据与真实无比赛、部分丢失、来源不可达和 stale 缓存分别返回准确状态。
- API 429/timeout/无效响应有界失败；重复比赛/事件不重复统计。
- Telemetry 缺失、队伤/敌伤区分、团战证据、已有载具/闪光/重武器事实回归。
- SQLite 持久化/重启、一次性导入重复运行、resultSet 引用与会话隔离。
- 插件确实使用原生加载，Domain 可独立测试；禁用插件后 PUBG 工具消失。
- 新启动配置和源调用图不包含旧链 runtime dependency；无空工具、TODO handler 或 fallback。

### 实际 9Router + OpenClaw 场景

至少下列 12 类，全部运行并保存失败，不挑最好一次；其中至少 4 条独立改写作为未放入 Skill 的保留表达：

1. 今日详细战绩（默认队伍）。
2. 昨天我的 KD（短答、别名正确）。
3. 接续“前天呢”（继承实体，正确日期）。
4. 今天与昨天比较（样本/指标可复核）。
5. 最近一周按日趋势。
6. 最近两周 22 点前后场均表现。
7. 指定地图/模式，两个人比较。
8. 最近一把复盘。
9. 比赛列表后“第二把”，排序引用正确。
10. 先查战绩，再聊内存，随后说“昨天改成 CL30”（不误查 PUBG）。
11. 来源故障/部分缺失（如实说明，不说 0 场）。
12. 普通聊天/请求尚未安装的 Homelab 能力（不假称执行成功）。

评测记录模型 route、版本、输入、实际工具名/参数、事实比对、最终状态和耗时。允许合理工具顺序与回答措辞变化，不索取私有思维链。不用强制注入工具调用冒充模型能力。

### 真实链路最小验证

目标机上确认一个 OpenClaw consumer、重启后插件/SQLite 正常，使用真实 PUBG 查询与一场可用 Telemetry 复盘验证数据链。Telegram 用真实私聊完成一条查询及一条连续追问，核验最终送达且无旧入口重复回复。没有自然入站/测试账号时记录唯一外部阻塞，不能伪造入站；仍完成所有其余重构和清理。

验证 new build/typecheck、定向测试、必要 secret scan、git diff --check。保留一次实际新栈 smoke；健康状态只能证明运行，不能替代业务数据和消息证据。

## 11. 完成定义与防跑偏规则

只有全部满足才标 COMPLETE：
- 唯一 OpenClaw 主 Agent，实际 9Router 路由可用，Telegram/WhatsApp 渠道闭环。
- 只安装一个本项目业务插件 PUBG；原生插件内薄适配 + bundled Skill + 独立 Domain。
- 通用查询/比较/复盘组合可用，现有有价值 PUBG 事实能力不因换壳丢失。
- API/cache 覆盖、指标/时间口径、错误与证据可核验。
- 一次性迁移完成；旧消费端、旧主链和旧依赖删除，非本轮 producer 不再调用退休端点。
- 新机器可按仓库说明重建，secrets/业务数据不入库。
- 文档、checkpoint、验收证据与代码一致；提交并 push，给出 SHA 与真实未完事项（如有）。

禁止：只写架构/空目录/演示插件就停止；先套旧 HTTP 网关声称已迁移；再建中央 Registry；为了以后扩展创建六个空插件；用兼容层长期保留旧 schema；硬编码验收句子；把 mock/health 当真实模型/平台通过；静默删除历史数据；把外部阻塞写成全部完成。

如源码中发现已有可用能力，优先抽离复用。遇到不影响边界的实现选择自行决定并记录，不无限架构讨论。未安装功能只说明当前不可用，不暗中回旧链执行。

## 12. 可复制的 Codex Goal

在仓库本地 Codex 会话内输入；/goal 不是 shell 命令。不设置 token_budget。工作区干净且在 main 时先 git pull --ff-only；有用户改动就保护/隔离，不 reset 覆盖。

```text
/goal 按 docs/OPENCLAW_PUBG_REFACTOR_GOAL.md 直接完成 amadeus-home 的最终重构、测试与一次性迁移。新目标取代旧 LangBot/Kurisu 多领域 Goal：Telegram 私聊 → 唯一 OpenClaw/Kurisu + 当前 9Router → 唯一原生 PUBG 插件（薄 SDK 适配、bundled Skill）→ 独立确定性 PUBG Domain → 官方 API 与 SQLite。先核实 AGENTS.md、项目状态、Git、源码及 OrbStack ubuntu/CasaOS 实际环境；本轮已授权必要修改、提交 push、构建部署、停用本项目旧入口和一次性数据迁移。线上无用户，不做灰度、shadow、双跑、兼容 fallback 或回滚演练；只做必要数据备份。实现通用查询/聚合/比较/复盘，保留有效 Telemetry 事实，移除 PUBG 的 LangBot/Mastra/n8n/旧 Runtime 依赖，不自建 Plugin Registry/Core/SDK，不实现其他业务插件。停用依赖退休端点的非本轮 producer 并保留其数据；不得误停无关共享服务。完成相关确定性测试、真实 9Router/OpenClaw 工具循环、真实 PUBG 与 Telegram 最小闭环、旧代码和部署清理、文档/checkpoint 同步后再结束；不阶段性询问继续、不留过渡形态，不用 mock 或 health 伪造完成。缺外部凭据/真实入站时先完成全部可执行工作，准确记录剩余 blocker；遵循权限边界，不设置 token_budget。
```

恢复任务时继续同一 Goal，先读进度与 checkpoint，从首个未完成项推进，不重跑无关验证。若本机 Codex 不支持 /goal，将同一目标作为普通任务输入，不修改全局配置模拟命令。
