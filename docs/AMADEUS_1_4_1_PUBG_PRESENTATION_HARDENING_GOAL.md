# Amadeus 1.4.1 — PUBG Presentation Hardening Goal

更新时间：2026-09-20（北京时间）

## 0. Goal 状态与执行方式

这是 `docs/AMADEUS_ARCHITECTURE_CONVERGENCE_GOAL.md` 的收尾 Goal，目标版本固定为 **Amadeus 1.4.1**。

本轮不再做大架构迁移，而是把上一轮已经建立的 `Agent + Skill + Domain + Presentation` 边界真正接完整，尤其是 PUBG：
**任何可能成为用户最终回答的 PUBG 分支都必须经过结构化 Presentation、runtime validation 和 deterministic renderer，不能再依赖 LLM 记住输出格式。**

建议 Codex 直接执行：

```text
/goal Implement docs/AMADEUS_1_4_1_PUBG_PRESENTATION_HARDENING_GOAL.md completely. Stay within scope. Validate each phase. When implementation is complete, release as Amadeus 1.4.1, commit, push, deploy to the canonical CasaOS OpenClaw target, verify live health/smoke, then commit and push deployment evidence.
```

用户已授权本 Goal 范围内的源码/文档修改、版本更新、测试、commit、push 和最终 CasaOS release 部署。
仍必须遵守根 `AGENTS.md` 的 secret、SSH、数据、备份、rollback 和显式 deploy 安全边界。

完成状态（2026-09-20）：源码实现已由 `032e314` 提交并 push，`VERSION=1.4.1` 已通过 release
check；已通过 `--apply --build-auto` 部署到 canonical CasaOS。live OpenClaw 使用
`local/openclaw-amadeus:git-032e31477b45-20260920065322`，Product Radar 复用
`local/product-radar:git-7d85bc10f15d-20260920041059`，外部恢复 checkpoint 为
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260920065322`。health、preflight、owner/media/NAS
smoke 和 `doctor.sh`（0 failure / 0 warning）均通过；真实 Telegram/WhatsApp 自然语言入口和最终
用户回复未通过未经请求的群聊消息伪造，仍按边界记录为 pending。

---

# 1. Objective

本轮只解决以下六类问题：

1. **PUBG 全 user-facing 分支统一 Presentation Boundary**：普通战绩、比赛列表、对比、单局详情、单局复盘、周期复盘、队友伤害/互殴、状态/错误等都必须有稳定格式，不允许再只有 raw JSON + Prompt 提醒。
2. **复盘链路真正完成 renderer 接线**：解决实际用户回复中丢失 `数据更新时间`、source range 和结构漂移的问题。
3. **周期复盘真正成为 production use case**：现有 `PubgPeriodReviewPresentation` 不能只停留在 contract/test，必须接入真实调用链，避免 LLM 手工拼接 N 个单局结果。
4. **Owner Notification 收尾**：修复长消息分片丢 facts/time 的问题，并把 legacy `title/message` 新写入路径真正退休，只保留历史 pending/outbox 的 read compatibility。
5. **Prompt / Architecture 收尾**：SOUL 继续纯 Persona；补强 architecture fitness checks，防止未来在任意 plugin 子文件重新引入 global business prompt，也防止新增 PUBG tool 忘记 Presentation。
6. **版本策略修正并固化**：当前版本仍为 `1.4.0`；本 Goal 发布为 `1.4.1`。以后每次 release 只执行 `bump patch`，patch 10 进 1，minor 100 进 1。

本轮不是 Runtime 迁移，不增加第二 Agent、Router、Orchestrator、Workflow Engine，也不拆微服务。

---

# 2. Re-audit Findings / 当前真实缺口

实施前必须重新读取当前 `main`，但当前已确认以下事实：

## 2.1 PUBG Presentation 只接了单局 review 的一半

当前 `plugins/pubg/src/index.ts` 的 `jsonToolResultWithPresentation()` 只对 `pubg_get_review_facts` 调用
`buildPubgMatchReviewPresentation()`；其他工具统一走 `jsonToolResult()`。

因此：

- `pubg_query_stats`
- `pubg_search_matches`
- `pubg_compare_stats`
- `pubg_get_match`
- `pubg_query_team_damage`
- period review 汇总
- status / partial / no_matches / error

仍然主要依赖 LLM 从 raw tool envelope 自行组织最终用户文本。

即使 `pubg_get_review_facts` 已返回 `presentation`，当前 plugin 也没有把 `renderPubgMatchReview()` 的结果作为
canonical user-facing output；所以真实回复仍可能漏掉 `数据更新时间`。

## 2.2 `PubgPeriodReviewPresentation` 当前只有 contract/validator/renderer，没有 production builder/use case

现有周期复盘流程仍接近：

```text
pubg_search_matches
  -> pubg_get_review_facts(match 1)
  -> pubg_get_review_facts(match 2)
  -> ...
  -> LLM 自行汇总
```

这使得 period contract 无法真正成为输出边界。

## 2.3 时间 formatter 已正确，但没有覆盖全部 PUBG 最终输出

`packages/presentation` 已有北京时间友好 formatter：

- 内部可使用 `Asia/Shanghai`
- 同日默认 `HH:mm`
- 跨日 `YYYY-MM-DD HH:mm`
- 不主动拼接 `Asia/Shanghai` / `UTC+08` / `自然日` / `业务日`

本轮不要重做时间算法，而是确保所有 PUBG user-facing renderer 都复用同一 formatter/footer。

## 2.4 Owner Notification 分片会丢结构化信息

当前长通知分片主要切 `summary`，分片对象会清空 `facts`，且可能不保留 `dataUpdatedAt`。
当长消息主要来自 facts 时也可能无法正确分片。

## 2.5 Legacy notification write path 仍存在

用户可见 native tool 已使用 `owner_notification` contract，但内部 `OwnerEvent | LegacyOwnerEvent`、
`enqueueOwnerEvent()`、`ownerEvent()` 以及部分脚本仍允许新生产者继续用 `title/message`。

上一轮目标要求的是：legacy 仅用于历史 pending/outbox **read compatibility**，不是继续作为新写入 API。

## 2.6 Architecture checker 仍有覆盖漏洞

当前对 `before_prompt_build` 的检查主要盯 `plugins/amadeus/src/index.ts`。
未来若有人把 global business prompt injection 放进 `src/shared/*` 或 `src/capabilities/*`，可能绕过检查。

同时目前没有机器级约束保证“新增一个 user-facing PUBG tool 时必须同时存在 Presentation mapping / renderer”。

## 2.7 当前版本脚本的 minor 进位规则不符合最新要求

当前规则是：

```text
0.0.9 -> 0.1.0
0.9.9 -> 1.0.0
```

新的唯一规则必须改为：

```text
0.0.8 -> 0.0.9
0.0.9 -> 0.1.0
0.9.9 -> 0.10.0
0.10.9 -> 0.11.0
0.98.9 -> 0.99.0
0.99.9 -> 1.0.0
1.4.0 -> 1.4.1
1.4.9 -> 1.5.0
1.99.9 -> 2.0.0
```

即：

- patch 位范围 `0..9`，到 9 后向 minor 进 1；
- minor 位范围 `0..99`，到 99 且 patch=9 后才向 major 进 1；
- 仍然只允许 `bump patch`；
- 不恢复独立 `bump minor` / `bump major` 命令。

---

# 3. Target Architecture

PUBG 的最终目标链路：

```text
Natural language
  ↓
OpenClaw / Kurisu
  ↓ semantic capability selection
PUBG Skill
  ↓
Native PUBG Tool
  ↓
PUBG Domain / deterministic service
  ↓
ToolEnvelope / raw machine facts
  ↓
PubgPresentationFactory
  ↓
Presentation Contract
  ↓ runtime validation
Deterministic Renderer
  ↓
displayText
  ↓
OpenClaw final response
  ↓
User
```

必须同时保留三层，不互相替代：

```text
raw data / evidence   → 给机器、后续 use case、诊断
presentation          → 稳定结构化用户输出协议
displayText           → 已验证、确定性渲染的 canonical factual block
```

LLM 可以：

- 理解自然语言；
- 选择工具；
- 在必要时做解释；
- 在 `displayText` 前后添加少量 Kurisu 风格的非事实性自然语言。

LLM 不可以：

- 自己重算 PUBG 时间范围；
- 从 raw ISO 自己格式化时间；
- 当 `displayText` 已存在时重新抄 raw JSON 造另一套事实块；
- 删除 mandatory footer；
- 把 unknown/null 改成 0；
- 改写 evidence 支撑的核心数字；
- 自己决定是否显示更新时间。

---

# 4. Scope A — Unified PUBG Presentation Boundary

## 4.1 建立统一 Presentation base

不要继续为每个遗漏分支打补丁。

在 `packages/presentation` 建立清晰的 PUBG presentation discriminated union，至少包含公共字段：

```ts
interface PubgPresentationBase {
  status: 'ok' | 'partial' | 'no_matches' | 'error';
  dataUpdatedAt: string;
  sourceRange?: {
    from: string | null;
    to: string | null;
  };
}
```

字段命名可根据现有代码风格调整，但必须保证：

- `dataUpdatedAt` 是所有 user-facing PUBG presentation 的公共事实；
- 有真实 query range 时保留 source range；
- status 是 Presentation 层可见语义；
- internal timezone/day-boundary metadata 不成为默认 display contract。

## 4.2 第一轮完整覆盖的 Presentation types

至少实现以下类型：

1. `pubg_stats`
   - 对应 `pubg_query_stats`
   - 支持个人、team、groupBy、rank/list 等真实返回形态，不假设固定单人结构。

2. `pubg_match_list`
   - 对应 `pubg_search_matches`
   - 用于用户明确问“有哪些比赛/昨天几局/列出对局”等 final-output 场景。

3. `pubg_comparison`
   - 对应 `pubg_compare_stats`
   - 两段 source ranges 必须分别保留和渲染。

4. `pubg_match_detail`
   - 对应 `pubg_get_match`
   - 不暴露 raw UTC clock 作为本地时间。

5. `pubg_match_review`
   - 现有 contract 保留并完善真实 renderer 接线。

6. `pubg_period_review`
   - 现有 contract 必须真正进入 production flow。

7. `pubg_team_damage`
   - 对应 `pubg_query_team_damage`
   - 保留 directional `actor -> victim`、source/melee kind、partial/null 语义。

8. `pubg_status`
   - 统一处理 `partial` / `no_matches` / `error` 等没有正常业务主体的情况。

9. 对 scheduler/internal tools，如果其输出可能被用户直接查看，也必须有稳定 Presentation：
   - `pubg_prefetch_telemetry`
   - `pubg_telemetry_sync_report`

这些内部工具不要求成为普通聊天的首选输出，但不能在被显式查看时回退成一坨未格式化 JSON。

`pubg_resolve_players` 主要是 orchestration helper；如果只作为中间工具，可以标记为 intermediate。但若结果被用户直接请求或最终展示，也必须经过一个 bounded lookup/status presentation，不能裸输出 transport/tool internals。

## 4.3 Central Presentation Factory / Registry

当前：

```ts
if (name === 'pubg_get_review_facts') ...
```

应改成中心化 mapping，而不是继续增加散落的 `if/else`。

目标形态可以是：

```ts
const PUBG_PRESENTATION_BUILDERS = {
  pubg_query_stats: buildPubgStatsPresentation,
  pubg_search_matches: buildPubgMatchListPresentation,
  pubg_compare_stats: buildPubgComparisonPresentation,
  pubg_get_match: buildPubgMatchDetailPresentation,
  pubg_get_review_facts: buildPubgMatchReviewPresentation,
  pubg_get_period_review: buildPubgPeriodReviewPresentation,
  pubg_query_team_damage: buildPubgTeamDamagePresentation,
  ...
};
```

具体 API 可以更优雅，但必须有**唯一集中 registry**，让“一个 native tool 是否有 Presentation”可被自动测试。

禁止：

- 每个 tool factory 各自随意拼 text；
- 在 Domain 返回 prose；
- 在 Skill 里复制完整模板；
- 新增 tool 后靠开发者记忆手工补一个零散 formatter。

## 4.4 Tool output contract

对所有 user-facing PUBG tool result，统一返回：

```text
status
raw data / evidence
presentation
displayText
dataUpdatedAt machine evidence
...existing ToolEnvelope fields
```

`presentation` 不再只是 `Type.Unknown()` 的无约束占位；应尽可能提供稳定 discriminated schema，至少在 TypeScript/runtime validation 层严格校验。

如果 OpenClaw tool output schema 对大型 union 有兼容限制，可以保留外层宽 schema，但内部必须执行 runtime validator，测试必须覆盖每个 type。

## 4.5 Canonical `displayText`

所有 user-facing PUBG Presentation 必须 deterministic render 得到 `displayText`。

最终 Skill 规则改成：

> When a native PUBG tool returns validated `displayText`, use it as the canonical factual block. Do not reconstruct statistics, timestamps, source ranges, or structured sections from raw machine fields. Kurisu may add brief contextual commentary only if it does not alter or duplicate the factual block.

这样不再依赖 Prompt 提醒“记得写数据更新时间”。

---

# 5. Scope B — Unified PUBG Footer / Time Output

## 5.1 Mandatory data-updated footer

每一个 user-facing PUBG renderer 都必须经过统一 footer helper。

至少保证：

```text
数据更新时间：HH:mm
```

跨显示日时：

```text
数据更新时间：YYYY-MM-DD HH:mm
```

如果时间事实确实未知，明确：

```text
数据更新时间：未知
```

不能静默省略 required footer。

## 5.2 Source range

对有明确数据时间范围的查询，统一渲染：

```text
数据范围：2026-09-19 06:00 ～ 2026-09-20 06:00
```

或者等价的紧凑北京时间格式。

要求：

- source range 来自 Domain/tool evidence；
- renderer 不重算 06:00；
- 不显示 `Asia/Shanghai`；
- 不显示 `UTC+08`；
- 不显示“自然日”“业务日”；
- 用户主动询问边界时可以自然解释“PUBG 按北京时间 06:00 切日”。

## 5.3 复用现有 formatter

优先复用当前 `formatDisplayTime` / `formatDisplayRange`；不要创建第二套北京时间 formatter。

若现有 formatter 有 API 缺口，扩展它，而不是在 PUBG plugin 里自己 `Intl.DateTimeFormat`。

## 5.4 `partial / no_matches / error` 也必须有格式

示意：

```text
🎮 昨天战绩

没有找到符合条件的比赛。

数据范围：...
数据更新时间：13:42
```

partial：

```text
🎮 昨天队内误伤

已统计 6 / 7 场，其中 1 场 Telemetry 暂不可用，结果可能不完整。
...

数据范围：...
数据更新时间：13:42
```

error：

```text
🎮 PUBG 查询失败

当前数据源无法完成这次查询，没有使用旧聊天数据代替。

数据更新时间：13:42
```

具体措辞可以更自然，但结构和 unknown/partial 语义必须稳定。

---

# 6. Scope C — Period Review Production Use Case

## 6.1 不再依赖 LLM 手工汇总 N 个单局 review

周期复盘必须有一个 bounded use case。

优先方案：新增 native tool/use case：

```text
pubg_get_period_review
```

或同等明确命名。

输入应基于 fresh period search 的 result set / semantic selector，而不是由 LLM 计算 exact timestamps。

推荐流程：

```text
pubg_search_matches(refresh=true, semantic period)
  ↓ fresh resultSetId
pubg_get_period_review(resultSetId, subject/categories)
  ↓ Domain/plugin bounded aggregation
PubgPeriodReviewPresentation
  ↓ validate
renderPubgPeriodReview
  ↓ displayText
```

如果审计后发现现有 Domain 能在不新增 tool 的情况下提供同等 atomic use case，可以复用，但必须满足：

- period contract 是真实 production result；
- match 顺序由 Domain/result set 决定；
- 不让 LLM 手工决定遗漏哪一局；
- `dataUpdatedAt` 和 source range 必须统一；
- partial Telemetry 明确进入 period status/coverage；
- 不复用 stale result set。

## 6.2 Period analysis ownership

允许 deterministic Domain 提供 facts/derived analysis，也允许 LLM 在 bounded structured fields 中做解释；
但最终必须生成并验证 `PubgPeriodReviewPresentation`。

不能出现：

```text
N 个 raw review JSON -> LLM 随便写一篇文章
```

## 6.3 Freshness

保持现有正确规则：

- period review 是 fresh-data intent；
- fresh search result set 必须来自当前会话/当前 turn 的刷新流程；
- stale/unrelated result set fail closed；
- LLM 不计算 exact timestamps。

---

# 7. Scope D — Tool/Skill Ownership Cleanup

## 7.1 缩短 tool descriptions

当前 PUBG tool description 重新承载了大量 Skill 级 workflow，例如：

- nickname/self identity 完整流程；
- `Asia/Shanghai 06:00` 详细规则；
- latest-match 固定参数；
- period review 完整调用顺序；
- final answer 如何显示 footer。

这虽不是 global prompt，但会形成第二套规则 owner。

本轮把 tool description 收敛为：

- 什么时候调用该 tool；
- 关键输入语义；
- 最重要的 fail-closed precondition；
- output 中哪个 field 是 canonical display/presentation。

完整 workflow 只保留在 PUBG Skill。

参数 schema 自己的局部 description 可以保留，例如 `resultSetId` 必须来自 fresh search；但不要复制整份 Skill。

## 7.2 PUBG Skill

Skill 继续作为 capability workflow 唯一 owner，补充统一输出规则：

- 所有事实必须来自当前 native tool；
- 有 `displayText` 时使用 canonical factual block；
- 不从 raw JSON 重建 footer；
- 普通战绩/compare/review/team-damage 等都遵循 Presentation boundary；
- semantic time intent 交给 Domain；
- scheduled/internal tool 的 presentation 不代表一定主动发送。

不要增加关键词 router。

---

# 8. Scope E — Owner Notification Follow-up

## 8.1 修复长消息分片

当前分片不能再简单：

```text
切 summary
-> facts=[]
-> dataUpdatedAt 丢失
```

改为 section-aware / rendered-output-aware splitting。

必须保证：

- facts 不因分片静默消失；
- `dataUpdatedAt` 不因分片静默消失；
- headline/part numbering 稳定；
- `El Psy Kongroo.` 只在最后一个 part 出现一次；
- idempotency key 每个 part 稳定；
- retry/sent marker 语义不变；
- 如果主要长度来自 facts，也能正确分片；
- 分片后组合起来与原 logical notification 事实等价。

推荐策略：先把 notification 变成 logical render sections，再按 section/chunk 切，而不是破坏 contract 后重新造缩水版 event。

## 8.2 Legacy write path 退休

目标：

```text
新 producer -> OwnerNotificationPresentation only
旧历史 pending/outbox -> Legacy read compatibility only
```

要求：

- producer-facing `enqueueOwnerEvent` / `ownerEvent` 等新写入口不再公开接受 `LegacyOwnerEvent`；
- `title/message` 兼容解析仅存在于读取历史 pending 文件的 migration/normalize reader；
- 新写出的 pending JSON 永远是 `owner_notification` contract；
- 更新 `scripts/notify-owner.sh` 等 producer，使其直接生成 structured owner notification，不继续依赖 legacy `title/message` event shape；
- 如果 shell CLI 仍需要简单参数，可以使用 `--headline` / `--summary` 等新语义，但落盘 contract 必须结构化；
- 保持 channel-free 和 fixed owner delivery。

---

# 9. Scope F — SOUL / Architecture Governance Final Cleanup

## 9.1 SOUL 继续 Persona-only

保留：

- Kurisu / 牧濑红莉栖人格；
- Steins;Gate 世界观背景；
- 自然吐槽、科学思维、轻微傲娇；
- 已收紧的 persona easter egg；
- 与 Arthur 的长期熟人关系。

移除/改写仍残留的 capability-specific 表述，例如：

- “对于非 PUBG 的普通追问” -> 改成完全通用的 follow-up/context 原则；
- SOUL 中固定 WhatsApp owner destination -> 归还 workspace AGENTS / owner-notification Skill；
- 任何工具名、渠道名、具体业务流程。

Persona 彩蛋必须继续保留；明确技术/执行/安全任务继续优先于彩蛋。

## 9.2 Architecture check 扫描整个 plugin source

当前只看 `plugins/amadeus/src/index.ts` 不够。

至少升级为扫描：

```text
plugins/amadeus/src/**
```

禁止 capability-specific global prompt injection，例如：

- `before_prompt_build`
- 用 `appendSystemContext` 注入业务 routing/workflow

如果未来确有合法跨 capability runtime hook，应通过明确 whitelist + documented invariant，而不是静默绕过。

增加 fixture：在 nested capability/shared 文件中注入 `before_prompt_build`，`pnpm check:architecture` 必须失败。

## 9.3 PUBG Presentation coverage fitness test

建立单一 registry 或 metadata，使测试能得到所有 native PUBG tools。

定义：

```text
user-facing PUBG tool
```

和：

```text
intermediate/scheduled PUBG tool
```

对 user-facing tools 强制：

- builder mapping 存在；
- runtime validator 存在；
- renderer mapping 存在；
- `displayText` 存在；
- ok/partial/no_matches/error 至少有适用的 regression；
- 有 update instant 时 footer 不可缺失。

对 intermediate/scheduled tools：

- 必须显式标注 classification；
- 若允许直接向用户展示，则必须有 bounded presentation/status renderer；
- 不允许“未分类 = 默认裸 JSON”。

未来新增 PUBG native tool，如果没有更新 registry/presentation coverage，tests/architecture check 必须失败。

不要依赖脆弱的“文件行数”或 grep 某个 formatter 名称作为唯一证明。

---

# 10. Scope G — Version Progression Policy

## 10.1 当前 release

当前仓库版本保持：

```text
1.4.0
```

在本 Goal implementation 完成、准备 release 时执行一次：

```sh
./scripts/amadeus-version.sh bump patch
```

结果必须是：

```text
1.4.1
```

不要在实现尚未完成时提前把 `VERSION` 改成 1.4.1。

## 10.2 唯一版本进位规则

今后所有 release 继续只允许：

```sh
./scripts/amadeus-version.sh bump patch
```

进位算法：

```text
patch: 0..9
minor: 0..99
major: unbounded non-negative integer
```

规则：

```text
if patch < 9:
  patch += 1
else if minor < 99:
  minor += 1
  patch = 0
else:
  major += 1
  minor = 0
  patch = 0
```

必须通过以下 fixtures：

```text
0.0.8  -> 0.0.9
0.0.9  -> 0.1.0
0.1.9  -> 0.2.0
0.9.9  -> 0.10.0
0.10.9 -> 0.11.0
0.98.9 -> 0.99.0
0.99.9 -> 1.0.0
1.4.0  -> 1.4.1
1.4.9  -> 1.5.0
1.99.9 -> 2.0.0
```

特别注意：

```text
0.9.9 != 1.0.0
0.9.9 -> 0.10.0
```

只有：

```text
0.99.9 -> 1.0.0
```

## 10.3 更新所有 authoritative references

实施时同步修改：

- `scripts/amadeus-version.sh`
- `scripts/test-amadeus-version.sh`
- `README.md` 的当前版本政策
- 根 `AGENTS.md` 的版本规则
- `docs/AMADEUS_ARCHITECTURE_CONVERGENCE_GOAL.md` 中仍会误导未来 Agent 的旧版本规则文字
- `docs/CURRENT_TASK.md` / `docs/PROJECT_STATE.md` / `.agent/state.md` 的当前 authoritative policy
- 其他搜索到的“minor 到 9 进 major”的非历史性规范

历史 checkpoint 可以保留原始事实，不要篡改已经发生过的历史版本；如果历史文档中的旧政策容易被误读，应明确标记“historical/superseded”。

`bump minor` 和 `bump major` 继续显式失败。

---

# 11. Implementation Order

严格按阶段推进。

## Phase 0 — Baseline audit

执行：

```sh
git status --short --branch
git log -8 --oneline --decorate
pnpm workflow:plan
./scripts/amadeus-version.sh show
```

读取：

- 根 `AGENTS.md`
- `docs/ARCHITECTURE.md`
- `docs/PROJECT_STATE.md`
- `docs/CURRENT_TASK.md`
- `.agent/state.md`
- 上一轮 convergence goal
- 本 Goal
- PUBG plugin/domain/presentation tests

工作区不 clean 时先识别现有用户修改，不覆盖。

## Phase 1 — Presentation contracts + common footer

先扩展 `packages/presentation`：

- PUBG base/discriminated union
- stats/list/compare/detail/team-damage/status contracts
- common footer renderer
- validators
- registry/builders
- unit tests

此阶段不要先动 Domain 业务算法。

## Phase 2 — Wire all native PUBG outputs

改造 plugin output boundary：

- raw machine envelope 保留；
- 统一调用 Presentation factory；
- validate；
- render `displayText`；
- 失败时返回 deterministic `pubg_status`，不能静默漏 presentation；
- 清理单独 `if name === pubg_get_review_facts` 特判。

验证普通战绩、search、compare、match、review、team-damage。

## Phase 3 — Period review bounded use case

实现并接入真实 period review production flow。

验证：

- today/yesterday 语义 selector；
- 06:00 boundary 仍完全由 Domain 负责；
- fresh result set；
- chronological order；
- partial telemetry；
- period `displayText` footer。

## Phase 4 — Skill/tool-description ownership cleanup

- Skill 成为 workflow owner；
- tool description 减肥；
- 不恢复 global prompt；
- 不削弱关键 parameter-level fail-closed contract。

## Phase 5 — Owner notification + SOUL + architecture governance

- notification section-aware splitting；
- legacy write API retirement；
- SOUL 最后 capability-specific 文本清理；
- nested prompt-injection architecture checks；
- PUBG presentation coverage fitness tests。

## Phase 6 — Version policy update

先修改 version script/tests/docs policy，但此时 **不要立刻 bump VERSION**，除非所有源码验证已完成。

确保版本算法 fixtures 全通过。

## Phase 7 — Full regression + 1.4.1 release

所有验证通过后：

```sh
./scripts/amadeus-version.sh bump patch
```

必须得到：

```text
VERSION=1.4.1
```

然后替换 `RELEASE_NOTES.md` 为只描述本次 1.4.1 的 release notes。

---

# 12. Required Tests

## 12.1 PUBG presentation coverage

至少为以下 tool/use case 建 fixtures：

- query stats: ok / partial / no_matches / error
- search matches: ok / no_matches
- compare: ok / partial
- match detail: ok / error
- single review: ok / partial / telemetry unavailable
- period review: ok / partial / no_matches
- team damage: ok / partial / no_matches
- scheduled/internal status if directly rendered

每个 user-facing success/partial path：

- `presentation` 必须存在；
- validator 必须通过；
- `displayText` 必须非空；
- `displayText` 必须包含 `数据更新时间`；
- 有 source range 时必须包含 `数据范围`；
- 不允许出现 `Asia/Shanghai` / `UTC+08` / `自然日` / `业务日`；
- null/unknown 不变成 0。

## 12.2 Ordinary stats regression

真实模拟：

```text
我昨天战绩
```

工具层至少证明：

```text
identity -> pubg_query_stats -> validated pubg_stats -> displayText
```

最终 factual block 必须有时间 footer。

再覆盖：

- team stats
- player ranking
- groupBy day
- explicit time range

## 12.3 Review regression

单局 review：

- `displayText` 不是仅 presentation JSON；
- `数据更新时间` 必须存在；
- source range 有证据时必须存在；
- evidence unknown/null 保持。

周期 review：

- production builder/use case 真正被调用；
- ordered matches 不由 LLM 重排；
- footer 存在；
- partial coverage 有明确用户提示。

## 12.4 Time regression

继续覆盖既有：

- 03:00 / 09:00 的 PUBG 06:00 boundary；
- explicit `00:00 -> 24:00` 不被 06:00 改写；
- telemetry calendar day 仍与 interactive PUBG day 分离；
- renderer 统一北京时间友好格式。

## 12.5 Owner notification splitting

必须测试：

- 长 summary；
- 长 facts；
- facts + summary + dataUpdatedAt；
- multi-part closing 只出现一次；
- 每 part stable idempotency key；
- retry/sent marker；
- 分片后没有事实丢失。

## 12.6 Legacy notification write-path

- 新 producer API 传 legacy `title/message` 应 type/runtime fail；
- 历史 legacy pending fixture 仍能被 drain/normalize 读取并投递；
- 新落盘事件永远是 `owner_notification`。

## 12.7 Architecture fitness

- SOUL 插 tool/workflow token -> fail；
- nested `plugins/amadeus/src/capabilities/x/register.ts` 添加 `before_prompt_build` -> fail；
- 新增 user-facing PUBG tool 但不注册 Presentation -> fail；
- 合法 persona/easter egg -> pass。

## 12.8 Version fixtures

必须执行并验证：

```text
0.0.8 -> 0.0.9
0.0.9 -> 0.1.0
0.9.9 -> 0.10.0
0.10.9 -> 0.11.0
0.99.9 -> 1.0.0
1.4.0 -> 1.4.1
1.99.9 -> 2.0.0
```

并验证 `bump minor` / `bump major` 均 fail。

---

# 13. Non-goals

明确不做：

- 更换 OpenClaw；
- 增加第二 Agent；
- 新增 intent/keyword router；
- 恢复 LangBot / n8n runtime；
- 全面重写 PUBG Domain；
- Identity 大重构；
- Product Radar 大重构；
- 修改通知目标渠道策略；
- 重新设计权限体系；
- CI/GitHub Actions 大改；
- 微服务拆分；
- 为 Presentation 在 Domain 中塞固定自然语言模板；
- 让 LLM 重新负责 exact time calculation；
- 无关 TODO。

发现无关问题写入 `.agent/tasks/`，不要扩大本 Goal。

---

# 14. Definition of Done

只有以下全部满足才可宣布 1.4.1 完成：

- [x] 普通 `pubg_query_stats` 不再裸靠 LLM 格式化。
- [x] PUBG user-facing tools 均有明确 Presentation classification。
- [x] 所有 user-facing PUBG results 有 runtime-validated `presentation`。
- [x] 所有 user-facing PUBG results 有 deterministic `displayText`。
- [x] 所有适用 PUBG final output 都显示 `数据更新时间`。
- [x] 有 query range 的 final output 都显示用户友好的 `数据范围`。
- [x] 默认 PUBG 用户输出不出现 `Asia/Shanghai` / `UTC+08` / `自然日` / `业务日`。
- [x] single review 的真实 final path 使用 renderer，不再只返回 presentation JSON。
- [x] period review contract 真正接入 production bounded use case。
- [x] period review 不依赖 LLM 手工拼 N 个 raw review。
- [x] partial/no_matches/error 有统一格式。
- [x] raw machine facts/evidence 仍保留，没有为 UI 破坏 Domain contract。
- [x] Skill 是完整 PUBG workflow 的唯一 Prompt owner。
- [x] tool descriptions 已收敛，不再复制整份 Skill。
- [x] Owner notification 分片不会丢 facts/dataUpdatedAt。
- [x] legacy `title/message` 只剩 read compatibility，不再是新 producer write API。
- [x] SOUL 保留 Kurisu/Steins;Gate persona 和彩蛋，但无 PUBG/WhatsApp 等 capability workflow/destination rule。
- [x] architecture check 扫描 nested Amadeus source 的 global prompt injection。
- [x] 新增 PUBG user-facing tool 不带 Presentation 时自动检查失败。
- [x] 新版本算法实现 patch 10 进 1、minor 100 进 1。
- [x] `0.9.9 -> 0.10.0` 测试通过。
- [x] `0.99.9 -> 1.0.0` 测试通过。
- [x] 版本脚本仍只支持 `bump patch`。
- [x] release 前 `1.4.0 -> 1.4.1`。
- [x] build / typecheck / full tests / architecture / secrets / workflow / diff check 全通过。
- [x] 1.4.1 implementation commit 已 push。
- [x] CasaOS release 已实际 deploy。
- [x] live health / preflight / smoke / doctor 通过。
- [x] deployment evidence 已单独 commit + push。
- [x] 最终 Git clean。

---

# 15. Full Validation Before Release

至少执行：

```sh
pnpm build
pnpm typecheck
pnpm test
pnpm check:architecture
pnpm test:architecture
pnpm test:workflow
pnpm check:secrets
bash scripts/test-amadeus-version.sh
git diff --check
./scripts/amadeus-version.sh check
```

注意：在 bump 到 1.4.1 前，`RELEASE_NOTES.md` 仍对应 1.4.0；不要因为临时版本/notes 不匹配而伪造 PASS。
正确顺序应是先完成源码与版本算法验证，再 bump 1.4.1、替换 release notes，最后运行 release version check。

---

# 16. Commit / Push / Deploy Completion Protocol

本 Goal 和上一轮一样，不允许在“本地测试通过”处停止。

## 16.1 Release preparation

所有代码完成并验证后：

```sh
./scripts/amadeus-version.sh bump patch
```

必须输出：

```text
VERSION=1.4.1
```

更新 `RELEASE_NOTES.md`：

- 标题 `# Amadeus 1.4.1`
- 只写本次发布内容
- 不累计历史 changelog
- 不手工重复 deploy script 自动追加的 closing

随后：

```sh
./scripts/amadeus-version.sh check
pnpm build
pnpm typecheck
pnpm test
pnpm check:architecture
pnpm check:secrets
git diff --check
```

## 16.2 Implementation commit + push

确认无 secret / runtime DB / backup / 临时文件后提交。

推荐 commit 语义：

```text
feat(pubg): harden presentation output boundary
```

然后 push canonical branch。当前仓库若仍使用 direct `main`，则 push `main`；若执行时仓库策略发生变化，遵守当时 branch/PR 规则，不 force push。

部署必须基于 clean、已 push 的 implementation commit。

## 16.3 CasaOS deployment

用户已明确要求实现后部署。

按现有 canonical release 流程：

```sh
./scripts/deploy-openclaw.sh --dry-run
./scripts/deploy-openclaw.sh --apply --build-auto
./scripts/doctor.sh
```

不要无理由使用强制全量 build；`--build-auto` 根据 immutable live commit 判定受影响镜像。

## 16.4 Live verification

至少确认：

- OpenClaw healthy；
- Product Radar 未被无关破坏；
- Amadeus plugin loaded；
- PUBG plugin loaded；
- 新/现有 PUBG native tools 均注册；
- bundled PUBG Skill 是新版本；
- Presentation builders/renderers 在 live bundle 中；
- ordinary stats tool 的返回包含 validated presentation + `displayText`；
- single review 的返回包含 `displayText` 且有 `数据更新时间`；
- team-damage 的返回格式化；
- period review bounded use case/tool 已注册并通过无副作用 preflight/fixture；
- owner outbox smoke；
- notification splitting regression 至少在 local/in-container fixture 证明；
- NAS/media/VPS 等既有外围 smoke 不因依赖构建受损；
- `doctor.sh` 0 failure，预期 0 warning。

不要为了 smoke 向真实群聊发送未经用户请求的消息。

真实 Telegram/WhatsApp 自然语言入口如果需要用户本人发消息才能验证，可记录为 pending；但底层 tool contract、renderer 和 live bundle 必须已经有证据。

## 16.5 Deployment evidence commit + push

部署成功后更新：

- `docs/CURRENT_TASK.md`
- `docs/PROJECT_STATE.md`
- `.agent/state.md`
- `.agent/checkpoints/<dated-1.4.1-checkpoint>.md`
- 必要 `docs/ARCHITECTURE.md` / `docs/DECISIONS.md`

记录：

- 1.4.1 implementation commit SHA；
- live immutable image tag；
- external rollback/checkpoint path；
- build/typecheck/test/architecture/secrets results；
- live preflight/health/smoke/doctor；
- real inbound pending 项（若有）。

然后再做 docs-only evidence commit + push。

如果 evidence commit 只包含 docs/.agent，不因 Git HEAD 变化重新构建 runtime；文档明确 live image 对应 implementation commit。

最终状态必须是：

```text
VERSION=1.4.1
implementation commit pushed
1.4.1 live healthy
deployment evidence pushed
rollback checkpoint recorded
Git clean
```

---

# 17. Stop Conditions

遇到以下情况不要靠 Prompt 或猜测绕过：

- OpenClaw 无法直接强制 final reply 使用 `displayText`：不要引入第二 Agent。保持 tool-mediated canonical presentation，并通过 Skill 明确“displayText 是 factual block”；记录 enforcement level。
- period review 需要新的 Domain bounded use case：实现最小必要 use case，不把聚合重新交给 LLM。
- 某个 PUBG tool 的 raw output 结构无法可靠生成 Presentation：先补 deterministic adapter/builder 和 tests，不在 renderer 猜字段。
- legacy pending 文件存在：保留 read migration，不因此重新开放 legacy write API。
- version policy 文档存在旧冲突：更新 authoritative docs，历史 checkpoint 保留历史事实并标记 superseded。
- deploy smoke 失败：不要宣布完成；保留 checkpoint，诊断、修复、重新验证。
- 任何操作可能破坏 secret、SSH、数据库、媒体数据或 rollback 能力：遵守根 `AGENTS.md`。

本 Goal 完成后的核心不变量：

> PUBG Domain 决定事实；Presentation 决定结构；Renderer 决定稳定格式；LLM 决定理解与少量解释。任何新的 PUBG 用户输出分支都必须先进入 Presentation，不能再靠 Prompt 记住“应该怎么写”。
