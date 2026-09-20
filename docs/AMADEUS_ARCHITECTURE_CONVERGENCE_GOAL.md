# Amadeus Architecture Convergence Goal

更新时间：2026-09-20（北京时间）

## 0. Goal 状态与执行方式

这是当前 Amadeus 在完成 OpenClaw 主链迁移后的架构收敛 Goal。实施时以本文件为目标，现有
`docs/OPENCLAW_AMADEUS_MIGRATION_GOAL.md`、`docs/ARCHITECTURE.md`、`docs/DECISIONS.md` 和 live CasaOS
状态作为既有约束与事实来源；不要恢复已经退休的 LangBot、n8n、旧 Runtime、旧通知链或第二套 Agent。

建议 Codex 直接执行：

```text
/goal Implement docs/AMADEUS_ARCHITECTURE_CONVERGENCE_GOAL.md completely. Stay within its scope, validate every phase, then commit, push and deploy the completed release as specified in the goal.
```

本 Goal 已获得用户授权：在范围内完成源码/文档修改、测试、版本更新、提交、push，以及最终 CasaOS
release 部署。仍必须遵守 secret、外部数据、SSH/运行时安全和可恢复 checkpoint 约束。

---

# 1. Objective

本轮只解决以下五类问题，其中前四项是产品/运行时架构改造，第五项是防止未来开发重新走偏的工程护栏：

1. **Presentation Contract**：稳定 PUBG 复盘与主动通知的最终输出结构，使 LLM 保留分析与措辞自由，但不拥有输出协议。
2. **Prompt Ownership Cleanup**：把 capability-specific 业务规则从 SOUL、workspace 全局规则和全局 prompt injection 中移出，归还 Skill / Domain / Presentation。
3. **`plugins/amadeus` 内部模块化**：解决 God Plugin Entry / God File 问题，但仍保持一个 `amadeus` OpenClaw plugin。
4. **Time Semantics + Presentation Normalization**：内部继续严谨使用北京时间和 PUBG 06:00 日界线，LLM 不计算边界；用户输出默认不暴露 `Asia/Shanghai`、`自然日`、`业务日` 等实现细节。
5. **Architecture Governance**：建立 ownership matrix、capability 开发模板和自动架构检查，让后续 Codex 新增功能时默认遵守同一套边界。

本轮不是 Runtime 迁移，不是微服务拆分，不引入新的 Agent、Router、Orchestrator、Workflow Engine 或
LLM framework。

---

# 2. Re-audit Findings / 当前需要解决的真实问题

实施前必须再次读取当前源码而不是盲按本文路径机械修改。当前已确认的主要问题如下：

## 2.1 `plugins/amadeus/src/index.ts` 同时承担过多职责

当前入口同时包含：

- TypeBox tool schemas；
- 通用 `makeTool/registerTool`；
- Identity 工具注册；
- Product Radar / Media / NAS / HomeLab / KOOK / VPS / Notification 工具注册；
- owner notification worker bootstrap；
- `before_dispatch` / `agent_end` Identity metadata bridge；
- `before_prompt_build` 的 `IDENTITY_DISPATCH_GUIDANCE` 全局业务提示注入。

目标不是拆成多个 OpenClaw plugin，而是把入口收敛为 thin bootstrap，各 capability 自己拥有 schema、注册和边界实现。

## 2.2 业务规则存在多个 owner

当前 PUBG / Identity 的部分规则同时存在于：

- `integrations/openclaw/workspace/SOUL.md`；
- `plugins/amadeus/src/index.ts` 的 `IDENTITY_DISPATCH_GUIDANCE`；
- `plugins/pubg/skills/pubg/SKILL.md`；
- tool description。

其中 `SOUL.md` 甚至包含 `pubg_search_matches`、`resultSetId`、`recentN`、`Asia/Shanghai 06:00` 等具体
workflow。长期会导致规则漂移，也违背“SOUL 管人格、Skill 管能力使用”的边界。

## 2.3 最终输出主要靠 Prompt 软约束

PUBG tool/domain 已返回结构化事实、coverage、freshness、`dataUpdatedAt` 等，但最终聊天输出结构仍主要由
LLM 自由生成。Owner notification 当前 `OwnerEvent` 核心正文仍是自由 `message: string`，因此结构一致性和
时间展示无法在发送边界强保证。

## 2.4 时间计算已基本在 Domain，但时间展示泄露内部协议

PUBG Domain 已有统一 `DEFAULT_TIMEZONE = Asia/Shanghai` 和 `BUSINESS_DAY_START = 06:00`，相对日期和
`groupBy day` 也走 resolver；这是正确基础，必须保留并加强。

当前问题主要是用户输出可能出现：

```text
日期：2026-09-19 (Asia/Shanghai，自然日)
数据更新时间：2026-09-19 23:05:08 (Asia/Shanghai)
```

内部协议信息不应默认直接成为 UI 文案。

## 2.5 缺少“未来开发不能重新走歪”的自动护栏

根 `AGENTS.md` 已有工程规则，但目前仍缺少明确 ownership matrix、capability planning checklist 和
`check:architecture` 一类 fitness functions，因此新功能仍可能再次把业务 workflow 放回 SOUL、全局 Prompt 或
`plugins/amadeus/src/index.ts`。

---

# 3. Target Architecture / Ownership Model

最终依赖与职责必须保持：

```text
User
  ↓
OpenClaw / Kurisu
  ↓  semantic reasoning + capability selection
Capability Skill
  ↓
Native Tool / Plugin Boundary
  ↓
Deterministic Domain or Explicit External Service
  ↓
Facts
  ↓
LLM synthesis where interpretation is useful
  ↓
Presentation Contract
  ↓
Validation
  ↓
Renderer
  ↓
Final chat / owner notification
```

唯一 ownership matrix：

| 内容 | 唯一主要 owner |
| --- | --- |
| Kurisu / 牧濑红莉栖人格、说话方式、Steins;Gate 角色背景 | `SOUL.md` / persona memory |
| 通用 runtime invariant | workspace `AGENTS.md` |
| capability 的工具选择/调用流程 | 对应 `SKILL.md` |
| OpenClaw tool schema、metadata/context adapter | plugin capability module |
| 统计、状态转换、权限事实、时间范围等确定性规则 | Domain / deterministic service |
| 稳定用户输出结构 | Presentation Contract |
| 渠道/文本最终排版 | Renderer |
| Codex 开发规范和架构边界 | 根 `AGENTS.md` + architecture checks |

禁止通过“为了保险”把同一规则复制到多个层。

---

# 4. Scope A — Presentation Contract

## 4.1 新建轻量共享 Presentation package

优先新建：

```text
packages/presentation/
  src/
    contracts/
    renderers/
    time/
    validation/
    index.ts
```

实际文件数按需要保持最小，不为了目录整齐制造空抽象。

`packages/presentation` 必须保持纯粹：

- 不调用 OpenClaw；
- 不访问 PUBG API；
- 不访问 SQLite；
- 不直接调用 WhatsApp/Telegram；
- 不承担 Agent planning；
- 不保存业务运行状态。

它只拥有：schema / validation / display-time formatting / deterministic rendering。

## 4.2 第一批只实现三个 Contract

### A. `PubgMatchReviewPresentation`

至少约束：

- `type = pubg_match_review`
- `headline`
- `overview`
  - placement
  - kills
  - assists
  - damage
  - dbnos
  - revives
- `keyMoments[]`
- `highlights[]`
- `improvements[]`
- `analysis`
- `dataUpdatedAt`

LLM 可以决定：哪些事实最值得写、关键操作排序、分析角度、Kurisu 风格自然语言。

LLM 不可以决定：是否省略 required structure、是否丢掉更新时间、是否把未知数据编成 0、是否编造 evidence 中不存在的事件。

### B. `PubgPeriodReviewPresentation`

至少约束：

- `type = pubg_period_review`
- `period.label`
- optional display date
- summary
- ordered matches
- highlights
- patterns
- analysis
- `dataUpdatedAt`

周期复盘的事实顺序继续以 Domain/search 已解析的比赛顺序为准，Presentation 不自行重排事实时间线。

### C. `OwnerNotificationPresentation`

主动通知比普通聊天更强约束。不要继续让所有 producer 通过一个无限自由的 `message: string` 决定完整页面。

Contract 至少表达：

- event type
- severity
- headline
- facts[]
- optional summary
- optional `dataUpdatedAt`
- occurredAt / event time（内部事实需要时）

Owner notification renderer 负责稳定生成最终文本，包括既有 Amadeus / D-mail 风格。

必须保留现有：

- stable `eventKey` 幂等语义；
- sent/pending marker；
- retry worker；
- fixed owner target；
- delivery status 事实语义；
- 长消息分段能力。

不要因为 Presentation 重构破坏通知可靠性。

## 4.3 Validation / enforcement

所有 Presentation Contract 必须有 runtime validation。

- invalid presentation 不能静默当作成功结构发送；
- 可以使用 bounded repair/retry；
- 最终仍失败时使用 deterministic safe fallback，并保留事实错误状态；
- 不允许 validator 失败后把半残 JSON 或自由文本当成功结果发送。

先检查当前 OpenClaw SDK 是否提供 final-response / outbound interception hook。

- 若存在稳定 hook，可在不破坏普通聊天的前提下对指定 presentation type 实现 output-boundary enforcement；
- 若不存在，不新增第二 Agent/Router，不 monkey patch 不稳定内部接口；PUBG 第一阶段采用 structured presentation + renderer/tool-mediated constraint，并在文档中准确描述强度；
- Owner Notification 因发送路径在项目内控制，必须实现 hard validation + deterministic renderer。

不要伪称不存在的 transport-level enforcement 已实现。

---

# 5. Scope B — Prompt Ownership Cleanup

## 5.1 `SOUL.md`

SOUL 继续保留并强化真正属于 Persona 的内容，包括：

- Kurisu / 牧濑红莉栖人格；
- 理性、科学、证据导向、会质疑不严谨结论；
- 轻微傲娇但不刻意表演；
- 与 Arthur 的长期熟人关系；
- Steins;Gate 世界观/实验室成员背景；
- 自然的世界线、D-mail、El Psy Kongroo 等角色风格元素；
- 普通聊天与技术讨论的语气原则。

SOUL 不应包含：

- `pubg_search_matches`
- `pubg_get_review_facts`
- `resultSetId`
- `recentN`
- PUBG 06:00 边界
- VPS / Media / Identity 的具体 tool sequence
- 任何 capability-specific schema 或执行参数

一句话边界：**SOUL 可以决定“Kurisu 怎么想、怎么说”，不能决定“业务工具怎么调用、数据怎么算”。**

## 5.2 Persona 彩蛋必须保留，但不能劫持业务任务

允许保留 Kurisu/Steins;Gate 人格彩蛋和现有长期玩梗记忆。

对于当前 `MEMORY.md` 一类固定彩蛋：

- 不需要为了“Prompt 清理”删除人格和彩蛋；
- 允许保留固定文案型彩蛋；
- 但不得依靠过宽的普通语言关键词无条件截断明确技术/执行任务；
- 对现有“最强 VS 最强”彩蛋，应收紧成明确 meme intent / 高特异触发，至少移除或降级像“也就是说”“我坐好了”这类很容易命中正常对话的泛关键词；
- 明确的技术、执行、安全、运行时任务永远优先于彩蛋。

目标是保留“长期相处的角色感”，而不是建立另一个 keyword router。

## 5.3 workspace `AGENTS.md`

只保留真正跨 capability 的 runtime invariant，例如：

- OpenClaw 是唯一 Agent runtime；
- tool results 是事实来源；
- 不编造 execution / delivery；
- platform-neutral business logic；
- side effect 遵守对应 capability policy；
- 不建立第二 orchestrator/router；
- ordinary follow-up 可以利用 session context。

PUBG/VPS/Media 等专属 workflow 必须下沉各自 Skill。

## 5.4 删除 capability-specific global prompt injection

删除/重构 `plugins/amadeus/src/index.ts` 当前的 `IDENTITY_DISPATCH_GUIDANCE` + `before_prompt_build` 业务注入。

不要把它搬到另一个全局 prompt。

归属规则：

- PUBG nickname/self/review 流程 → PUBG Skill + tool schema/description 中最小必要语义；
- Identity resolution 规则 → Identity Skill / Identity capability；
- VPS → VPS Skill；
- Media → Media Skill；
- Notification 输出规范 → Presentation / owner-notification Skill。

同一规则只保留一个 authoritative owner；tool description 只保留工具自己调用所必需的契约，不复制整份 Skill。

## 5.5 Amadeus Skills 拆分

当前大 `amadeus` Skill 应按 capability 收敛为：

```text
plugins/amadeus/skills/
  identity/
  product-radar/
  media-organizer/
  nas/
  homelab/
  vps/
  owner-notification/
```

若 OpenClaw 当前 plugin manifest / skill loading 机制要求保留顶层 `amadeus` Skill，可以保留一个极薄 overview，
只用于 capability overview，不复制具体 workflow。

禁止重新实现关键词路由或 `/command` parser。

---

# 6. Scope C — `plugins/amadeus` Physical Modularization

仍然只保留一个 OpenClaw plugin：

```text
plugins/amadeus
```

禁止因为代码拆分变成：

```text
plugins/vps
plugins/nas
plugins/media
plugins/identity
...
```

建议目标结构（可按真实复杂度微调）：

```text
plugins/amadeus/src/
  index.ts
  config.ts
  capabilities/
    identity/
    product-radar/
    media/
    nas/
    homelab/
    kook/
    vps/
    notification/
  shared/
    register-tool.ts
    errors.ts
    ...
```

每个 capability 只按需要使用 `register.ts` / `schema.ts` / `service.ts` / `adapter.ts` / `policy.ts`，不要过度工程化。

## 6.1 Thin entry target

最终 `plugins/amadeus/src/index.ts` 主要负责：

- `definePluginEntry`
- shared lifecycle bootstrap
- capability registration

形态应接近：

```ts
registerIdentity(api)
registerProductRadar(api)
registerMedia(api)
registerNas(api)
registerHomeLab(api)
registerKook(api)
registerVps(api)
registerNotification(api)
```

允许必要的共享 lifecycle hook 留在明确的 shared capability/bootstrap 中，但不要继续把所有 TypeBox schema 和业务实现堆回 `index.ts`。

## 6.2 Compatibility constraint

这一阶段首先是 physical modularization，不是 behavior rewrite。

尽量保持：

- existing native tool names；
- existing tool inputs/outputs；
- existing config keys；
- owner gate；
- same-session confirmation；
- fixed SSH / read-only constraints；
- notification retry/idempotency semantics；
- Identity metadata bridge；
- Product Radar / media adapter 调用契约。

只有 Presentation Contract 明确需要演进的接口才能变化；优先提供兼容迁移，不要无必要制造 breaking change。

---

# 7. Scope D — Time Semantics + Presentation Normalization

## 7.1 三种时间概念严格分离

系统必须区分：

1. **Instant**：真实时间点，内部 ISO/UTC 保存；
2. **Query Period**：业务查询范围，由对应 Domain/use case 解析；
3. **Display Time**：给用户看的北京时间友好格式，由 Presentation 负责。

不要让任何一层同时拥有全部三种职责。

## 7.2 Internal timezone

内部默认时区继续使用 IANA：

```text
Asia/Shanghai
```

它可以出现在：

- Domain resolver；
- scheduler；
- config；
- formatter implementation；
- debug/evidence metadata。

但默认不直接出现在用户可见输出。

## 7.3 User-facing display rule

默认用户看到的时间即北京时间。

普通输出不要出现：

- `(Asia/Shanghai)`
- `UTC+08:00`
- `自然日`
- `业务日`

用户主动询问时区/边界或存在真实歧义时，优先用自然中文“北京时间”解释。

统一 formatter 至少支持：

- 同日 `dataUpdatedAt`：`HH:mm`
- 跨日或需要完整日期：`YYYY-MM-DD HH:mm`
- 默认不显示秒，除非业务确实需要秒级证据

目标示例：

```text
昨天战绩
...
数据更新时间：23:05
```

而不是：

```text
日期：2026-09-19 (Asia/Shanghai，自然日)
数据更新时间：2026-09-19 23:05:08 (Asia/Shanghai)
```

## 7.4 PUBG 06:00 日界线由 Domain 独占

保留当前正确原则：

```text
timezone = Asia/Shanghai
day boundary = 06:00
```

所有下列语义必须走同一个 authoritative resolver / policy：

- today
- yesterday
- day_before_yesterday
- this_week
- last_week
- 普通 calendar-date PUBG query
- `groupBy day`
- period review
- stats / compare 的 PUBG 日期语义

LLM 只负责：

```text
自然语言 → semantic selector
```

例如：

```json
{
  "type": "relative_period",
  "value": "yesterday"
}
```

LLM 不负责：

- 计算 start/end timestamp；
- 应用 06:00；
- UTC conversion；
- 跨午夜归属。

PUBG Skill 只需保留清晰原则：relative period 传 semantic intent 给 Domain，绝不由模型计算 exact timestamps。

## 7.5 03:00 边界行为必须有确定性测试

固定 now = 北京时间 `2026-09-20 03:00` 时：

- `today` 必须解析为 `2026-09-19 06:00 → now`
- `yesterday` 必须解析为 `2026-09-18 06:00 → 2026-09-19 06:00`

固定 now = 北京时间 `2026-09-20 09:00` 时：

- `today` = `2026-09-20 06:00 → now`
- `yesterday` = `2026-09-19 06:00 → 2026-09-20 06:00`

## 7.6 Explicit range 不受 06:00 改写

用户明确说：

```text
查 9 月 19 日 00:00 到 24:00
```

应使用 explicit time range `00:00 → 次日 00:00`，不得强制改成 06:00 → 06:00。

即：

```text
relative PUBG-day semantics ≠ explicit clock range
```

## 7.7 Calendar daily reports 与互动查询分离

Telemetry daily report 等明确 use case 继续按 `00:00 → 24:00` calendar day 汇总；互动 PUBG relative query
继续使用 `06:00 → 06:00`。

这个差异应由 use case / Domain API 自己拥有，不允许依赖 LLM 记住“这个功能用零点、那个功能用六点”。

## 7.8 Presentation 不暴露内部 resolver metadata

Presentation 默认只需要：

- semantic period label；
- optional display date；
- `dataUpdatedAt`；
- 必要业务事实。

`timezone`、`businessDayStart` 等内部 metadata 只有用户主动问“为什么凌晨这局算昨天”时才解释。

---

# 8. Scope E — Architecture Governance / Future-proofing

本项的目标不是增加流程负担，而是让后续 Codex 开发新功能时难以把架构重新写歪。

## 8.1 根 `AGENTS.md` 增加 Architecture Ownership Matrix

根 `AGENTS.md` 是给 Codex / 开发 Agent 的规则，不等于运行时 Kurisu workspace prompt。

加入明确决策表：

```text
Persona?                  → SOUL / persona memory
Global runtime invariant? → workspace AGENTS
Capability workflow?      → Skill
Tool schema/adapter?       → plugin capability
Deterministic rule?       → Domain
Stable output structure?  → Presentation
Channel formatting?       → Renderer
Development architecture? → root AGENTS / architecture tests
```

同时明确：新增 user-facing capability 时，优先扩展 capability model，不通过 global keyword matching、prompt routing、channel-specific business branches 或 main plugin entry special cases 实现。

## 8.2 Capability planning checklist

在根工程规范或独立模板中要求较大新 capability 开发前明确：

```text
Capability:
User intents:
Skill owner:
Plugin boundary:
Deterministic domain/service:
Presentation contract or none:
Side effects and confirmation policy:
Time semantics or none:
External dependency or none:
Global prompt changes: normally none
Tests:
```

对于小修复无需生成冗长 RFC，但 Codex 在新增新能力时必须先完成这组 ownership 判断。

## 8.3 新增 `docs/CAPABILITY_TEMPLATE.md`

提供简洁模板，至少包含：

- Responsibility
- User intents
- Skill ownership
- Tools
- Deterministic rules
- Side effects
- Time semantics
- Presentation contract
- External dependencies
- Explicit non-goals
- Tests
- Forbidden global changes

## 8.4 Architecture fitness functions

新增 `scripts/check-architecture.*`（语言按仓库现状选择），并接入：

```text
pnpm check:architecture
```

以及现有 `workflow:verify` 的合适验证路径。

至少自动检查以下可机器验证的边界：

- `packages/pubg-domain` 不 import OpenClaw / Telegram / WhatsApp；
- `packages/presentation` 不 import OpenClaw、数据库/API/channel implementation；
- `SOUL.md` 不出现项目 native tool names / `resultSetId` / `recentN` / `businessDayStart` 等 capability workflow token；
- workspace `AGENTS.md` 不重新出现具体 tool sequence；
- `plugins/amadeus/src/index.ts` 不重新吸收大量 capability schema/implementation（使用可维护、不过度脆弱的检查方式）；
- 新增 capability 不得通过 global `before_prompt_build` 注入业务 routing guidance。

不要写极脆弱的“文件必须少于 N 行”作为唯一判断。优先检查 imports、known forbidden ownership 和 registration structure。

---

# 9. Execution Plan / 严格实施顺序

必须按阶段推进，每一阶段先通过定向验证再继续，不要一次性大爆炸式重写。

## Phase 0 — Baseline audit

执行：

```sh
git status --short --branch
git log -5 --oneline --decorate
pnpm workflow:plan
```

读取：

- `README.md`
- `AGENTS.md`
- `docs/ARCHITECTURE.md`
- `docs/PROJECT_STATE.md`
- `docs/CURRENT_TASK.md`
- `.agent/state.md`
- 本 Goal

记录现有 tool list、Skill loading、Amadeus/PUBG tests baseline 和 live version。

若工作区非 clean，先判断是否用户已有未提交修改，不得覆盖。

## Phase 1 — Amadeus physical modularization

只做物理拆分和 bootstrap 收敛。

要求：

- tool names/schema/output 保持兼容；
- identity metadata lifecycle 保持；
- owner worker 保持；
- side-effect / owner gates 保持；
- 不在此阶段引入新的 Presentation 行为。

验证：Amadeus + Identity 定向 tests、build/typecheck。

## Phase 2 — Prompt ownership cleanup + persona preservation

- 移除 SOUL 中 PUBG workflow；
- 移除 `IDENTITY_DISPATCH_GUIDANCE` 全局业务注入；
- 规则归还 capability Skills；
- 拆分 Amadeus capability Skills；
- 保留 Kurisu/Steins;Gate persona；
- 收紧会劫持普通任务的宽泛 easter-egg trigger，但保留明确玩梗能力。

验证真实关键行为的工具选择回归，而不是只 grep 文本。

## Phase 3 — Time semantics normalization

- 保持 Domain 06:00 authority；
- 补 deterministic boundary tests；
- 明确 explicit range；
- 明确 telemetry calendar day；
- 添加 Presentation time formatter；
- 移除默认用户可见 `Asia/Shanghai / 自然日 / 业务日`。

不要把时间规则重新放回 Prompt。

## Phase 4 — Presentation Contract

- 建 `packages/presentation`；
- 实现三个首批 contract；
- Owner Notification 接入 hard validation + deterministic renderer；
- PUBG 使用当前 OpenClaw 能力可支持的最强 structured presentation enforcement；
- 不影响普通自由聊天。

## Phase 5 — Architecture governance

- root `AGENTS.md` ownership matrix；
- `docs/CAPABILITY_TEMPLATE.md`；
- `pnpm check:architecture`；
- 接入 developer workflow 的合理验证阶段。

## Phase 6 — Full regression + release preparation

运行至少：

```sh
pnpm build
pnpm typecheck
pnpm test
pnpm check:architecture
pnpm check:secrets
git diff --check
./scripts/amadeus-version.sh check
```

另外执行与本次变更相关的定向 tests 和 `pnpm workflow:verify`。

如果某个完整测试依赖 live secret/外部不可用资源，必须区分“代码失败”和“环境未提供”，不能伪造 PASS。

---

# 10. Required Regression Tests

## 10.1 Prompt ownership / tool choice

删除 global guidance 后至少验证：

- “我昨天战绩”仍走 self identity → PUBG；
- nickname request 仍先 resolve canonical identity；
- explicit team 仍与 self 分离；
- 最近一局仍 refresh；
- 周期复盘仍 fresh search + fresh result set；
- Identity 不从 display name / phone / JID 猜 PUBG account；
- VPS / media 等 capability discovery 未因拆 Skill 退化。

若发生退化，优先修 Skill/tool schema/description ownership，禁止恢复 global keyword guidance。

## 10.2 Time

固定 now 测试：

- 09:00 today/yesterday 06:00 边界；
- 03:00 today/yesterday 跨午夜边界；
- explicit `00:00 → 24:00` 不受 06:00 改写；
- `groupBy day` 与 query 使用同一边界；
- telemetry daily report 保持 00:00–24:00；
- ISO `dataUpdatedAt` 转北京时间；
- 默认用户展示不出现 `Asia/Shanghai`、`UTC+08`、`自然日`、`业务日`；
- 同日显示 `HH:mm`，跨日按 `YYYY-MM-DD HH:mm`。

## 10.3 Presentation

- PUBG Match Contract required fields；
- PUBG Period Contract required fields；
- unknown/null 不被 formatter 变成 0；
- invalid contract validation fail；
- Owner notification invalid structure 不发送；
- owner retry/idempotency/split marker regression；
- deterministic notification renderer snapshot/structural tests；
- 用户可见时间格式 regression。

## 10.4 Amadeus modularization

确保：

- 所有现有 tool 注册数量/名称没有意外缺失；
- manifest/preflight 仍加载；
- config keys 未断；
- notification worker 仍启动；
- Identity reply metadata bridge 仍清理 session state；
- NAS/VPS read-only 与 owner gate 不变；
- Media same-session confirmation 不变。

## 10.5 Architecture governance

为 `check:architecture` 自身增加 fixture/test 或可重复验证方式，确认违规 import / global business guidance
确实会使检查失败，而合法 persona 文本不会被误伤。

---

# 11. Non-goals / 禁止扩展范围

本轮明确不做：

- 更换 OpenClaw；
- 引入 Mastra / LangGraph；
- 恢复 LangBot / n8n orchestration；
- 第二 Agent；
- intent router / keyword router；
- 权限体系全面重构；
- Telegram/WhatsApp 主渠道策略变更；
- Notification destination policy 重构；
- CI / GitHub Actions 大改；
- Product Radar 大规模内部重构；
- Identity package 大规模重写；
- PUBG Domain 大规模重写；
- 微服务拆分；
- 处理与本 Goal 无关的 TODO；
- 以“顺便清理”为由改 NAS/VPS/媒体业务行为。

发现无关问题写入 `.agent/tasks/`，不要扩 Goal。

---

# 12. Definition of Done

只有以下全部满足才可声明完成：

- [ ] `SOUL.md` 保留 Kurisu/Steins;Gate 人格，但不再包含 capability tool workflow。
- [ ] persona/easter eggs 保留；宽泛关键词不会抢占明确技术/执行任务。
- [ ] workspace `AGENTS.md` 只保留 global runtime invariants。
- [ ] 不再存在 PUBG/Identity 业务 routing 的 global `before_prompt_build` guidance。
- [ ] capability-specific 规则有明确单一 owner。
- [ ] `plugins/amadeus/src/index.ts` 已成为 thin bootstrap。
- [ ] Amadeus capabilities 已物理模块化，但仍是单一 `amadeus` plugin。
- [ ] 原有 native tool names / config / side-effect gates 保持兼容。
- [ ] `packages/presentation` 是纯 schema/validation/render/time 包，不访问 API/DB/channel/runtime。
- [ ] PUBG 单局复盘有 Presentation Contract。
- [ ] PUBG 周期复盘有 Presentation Contract。
- [ ] Owner Notification 使用结构化 contract + hard validation + deterministic renderer。
- [ ] 默认用户输出不再显示 `Asia/Shanghai` / `自然日` / `业务日`。
- [ ] `dataUpdatedAt` 使用统一北京时间友好格式。
- [ ] PUBG 06:00 日界线完全由 Domain/use case 控制，LLM 不计算 exact timestamps。
- [ ] explicit time range 不被 06:00 relative-day policy 改写。
- [ ] telemetry calendar day 与 interactive PUBG day 在代码层清晰分离。
- [ ] 根 `AGENTS.md` 有 architecture ownership matrix / 新 capability 开发规则。
- [ ] 存在 `docs/CAPABILITY_TEMPLATE.md`。
- [ ] 存在并通过 `pnpm check:architecture`。
- [ ] PUBG / Identity / Amadeus / Presentation / Time regressions 全部通过。
- [ ] build / typecheck / tests / secrets scan / diff check 全通过。
- [ ] docs / project state / checkpoint 已更新。
- [ ] 版本与单次 `RELEASE_NOTES.md` 已按现有版本规范更新。
- [ ] 实现已 commit 并 push。
- [ ] CasaOS release 已实际 deploy，live health/preflight/smoke 通过。
- [ ] 部署证据已再次 commit + push；最终 Git clean。

---

# 13. Commit / Push / Deploy Completion Protocol

这是本 Goal 的强制结束流程。不要在“本地测试通过”处停止。

## 13.1 Release version

遵守现有根 `VERSION` / `RELEASE_NOTES.md` 规则。当前已部署的 release 保持 `1.4.0` 不变；从下一版本
起所有 release 只调用 `scripts/amadeus-version.sh bump patch`，每次按 `0.0.1` 递增。第三段到 9 时
进位到第二段（`0.0.9 -> 0.1.0`），第二段也到 9 时进位到第一段（`0.9.9 -> 1.0.0`）；不再手工
使用或支持 `bump minor`、`bump major`。`RELEASE_NOTES.md` 只写本次 release 的新增/修复，不累计历史正文。

## 13.2 Implementation commit + push

完成代码和 release 文档、所有本地验证后：

```sh
git status --short --branch
git diff --check
pnpm check:secrets
```

确认没有 secret、临时产物、运行时 DB/backup 后提交。

提交信息使用清晰的 architecture/release 语义，不使用 WIP。

随后 push 当前 canonical branch。若当前仓库策略仍为直接 `main`，push `main`；如果执行时发现已有新的
branch/PR 约束，则遵守当时仓库规则，不自行 force push。

部署必须基于一个已经提交的 clean Git commit，不能从 dirty tree 构建不可追踪镜像。

## 13.3 CasaOS deployment

用户已明确要求本 Goal 完成后实际部署。

按现有部署脚本与最低必要 build 策略执行：

```sh
./scripts/deploy-openclaw.sh --dry-run
./scripts/deploy-openclaw.sh --apply --build-auto
./scripts/doctor.sh
```

`--build-auto` 应根据 live immutable image commit 只构建受影响镜像；不要无理由强制双镜像 `--build`。

部署前后必须保留外部 checkpoint，不能提交 secret / DB / backup。

## 13.4 Live verification

至少核验：

- OpenClaw container running/healthy；
- `amadeus` + `pubg` plugins/skills 加载；
- Presentation package 已进入 live OpenClaw image（若由该 image 承载）；
- native tools 数量/关键名称无丢失；
- owner notification worker 正常；
- owner outbox smoke；
- NAS read-only smoke；
- media adapter connectivity；
- Product Radar health（若部署流程现有 smoke 包含）；
- time formatter 的一个无副作用 live/tool-level evidence；
- PUBG semantic relative-period tool contract/preflight 存在；
- 不发送未经用户要求的真实群聊测试消息。

对于真正需要用户从 Telegram/WhatsApp 发消息才能证明的体验项，可以记录为“real inbound pending”，但不能把它
伪装成已验收；只要其底层 contract、live tool/preflight 和安全 smoke 已通过，不阻塞本 Goal 的基础 release 完成，
除非执行时发现明确功能回归。

## 13.5 Deployment evidence commit + push

部署成功后更新：

- `docs/CURRENT_TASK.md`
- `docs/PROJECT_STATE.md`
- `.agent/state.md`
- `.agent/checkpoints/<dated-checkpoint>.md`
- 必要 `docs/ARCHITECTURE.md` / `docs/DECISIONS.md`

记录：

- implementation commit SHA；
- live immutable image tag；
- external backup/checkpoint path；
- health/preflight/smoke 结果；
- 未完成的真实入口验收（若有）。

这些 deployment evidence 只能是 docs/.agent 级改动，不能偷偷再修改运行时代码。

然后再次：

```sh
git diff --check
pnpm check:secrets
git status --short --branch
```

提交 deployment evidence 并 push。

如果最后这个提交只包含 docs/.agent evidence，不需要因为 Git HEAD 变化而无意义重新 build/deploy；文档必须明确 live
image 对应的是前一个 implementation commit。

最终要求：

```text
Git clean
implementation commit pushed
deployment evidence commit pushed
live release healthy
rollback/checkpoint recorded
```

---

# 14. Stop Conditions

遇到以下情况不要靠猜测继续：

- OpenClaw 当前 SDK 不支持计划中的 final-response hook：使用本 Goal 已允许的 tool-mediated enforcement，不改未核验内部 runtime。
- 发现本 Goal 要求会破坏现有 tool external contract：优先兼容实现，必要时记录并重新评估，不擅自扩大 breaking scope。
- live secret 缺失：不要生成/提交假的 secret；报告缺失项。
- 工作区存在不明用户改动：保护并先识别，不覆盖。
- deploy health/smoke 失败：停止宣布成功，保留 checkpoint，诊断并修复后重新验证。
- 任何动作可能破坏 SSH、媒体库、数据或 secret：遵循根 `AGENTS.md` 的安全边界。

本 Goal 的核心不是“重构得更漂亮”，而是建立稳定 ownership：

> LLM 负责理解与分析；Skill 负责教它使用 capability；Domain 负责确定性事实与时间；Presentation 负责输出协议；根工程规则负责让未来开发继续遵守这些边界。
