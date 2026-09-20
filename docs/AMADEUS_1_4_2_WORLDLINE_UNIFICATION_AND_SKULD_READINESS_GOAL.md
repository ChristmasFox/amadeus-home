# Amadeus 1.4.2 — Worldline Unification & Operation Skuld Readiness Goal

更新时间：2026-09-20（北京时间）

## 0. Goal 状态与执行方式

这是 Amadeus 1.4.1 之后的迁移前收口 Goal。当前 `main` 的根 `VERSION` 为 **1.4.1**；本 Goal 完成并通过全部验证后发布 **Amadeus 1.4.2**。

本轮不开发新的 Agent runtime，不引入第二 Router / Planner / Workflow Engine，也不迁移到新 Mac mini。
本轮目标是：

> **先把现有系统统一成一个真正的 Amadeus / Steins;Gate 世界线体验，清掉已经退出历史舞台的设施，把部署从“当前这台 Mac”抽象为可迁移的 Host Profile，并把 Operation Skuld 所需的备份、清单、检查和 Runbook 全部准备好。新 Mac mini 到手后只执行迁移，不再边迁边重构。**

建议 Codex 直接执行：

```text
/goal Implement docs/AMADEUS_1_4_2_WORLDLINE_UNIFICATION_AND_SKULD_READINESS_GOAL.md completely. Stay within scope. Re-audit main before changing code, validate every phase, release as Amadeus 1.4.2, commit and push, deploy 1.4.2 to the current canonical CasaOS host, verify live health/smoke, then commit and push deployment evidence. Do NOT migrate to the new Mac mini in this goal; prepare Operation Skuld so the later migration is execution-only.
```

用户已授权本 Goal 范围内的源码、测试、文档、版本更新、commit、push，以及最终在**当前 canonical CasaOS 主机**上发布 1.4.2。
仍必须遵守根 `AGENTS.md` 的 secrets、SSH、备份、rollback、side-effect 和显式 deploy 边界。

---

# 1. Objective

本轮完成四个互相关联的目标：

1. **Worldline Theme Unification**
   - 所有主动通知统一经过一个确定性的世界线事件 / Presentation 边界。
   - Product Radar、市场、PUBG Sync、部署、Codex、VPS / HomeLab / NAS、媒体等现有主动通知看起来像同一个 Amadeus 系统，而不是不同子系统各说各话。
   - 《命运石之门》主题只属于表现层；业务 Domain 保持通用、平台无关、世界观无关。

2. **Notification Contract Unification**
   - 结构化事实不能先被各业务 formatter 压成一段字符串，再塞进 owner notification。
   - 主动通知统一保留 `facts`、severity、significance、occurredAt、dataUpdatedAt、source、event kind、幂等 event key 等机器事实。
   - Delivery destination 与业务解耦：业务只表达“通知 owner”，不表达“发 WhatsApp”。

3. **Legacy / Stale Architecture Cleanup**
   - 删除已确认死亡的 LangBot / n8n / n8n-sandbox release / retirement / backup 逻辑。
   - 对 changedetection、media adapter、FashionSigLIP 等先分类再处理；兼容性组件不能因为名字旧就误删。
   - 清理 1.4.1 已失效的 Skill / state / migration 文案与 host-specific 假设。

4. **Operation Skuld Readiness**
   - 当前部署流程变为 host-neutral，不再依赖旧 Mac 的用户名、Home 路径或源码硬编码。
   - 建立迁移清单、数据 / secrets / native worker inventory、可恢复 backup 校验、migration readiness check 和正式 Runbook。
   - 本 Goal 结束时应能明确得到：`Operation Skuld: READY` 或列出真实 blocker。

---

# 2. Scope Guardrails

## 2.1 本轮必须保持的架构边界

```text
Telegram / WhatsApp / future channels
              ↓
       OpenClaw / Kurisu
       唯一 Agent runtime
              ↓
        Skills / native tools
              ↓
 deterministic Domain / external services
              ↓
      Worldline Notification Intent
              ↓
      deterministic Theme Policy
              ↓
     Presentation / Owner Contract
              ↓
          Delivery Policy
              ↓
      current owner channel(s)
```

禁止：

- 新增 Mastra / LangGraph / n8n / LangBot 作为第二 planner 或 runtime；
- 为世界线主题增加关键词路由；
- Product Radar Domain、PUBG Domain、市场 Domain、VPS Domain 内写 `SERN` / `D-Mail` / `世界线偏移` 等表现文案；
- 让 LLM 决定 severity、significance 或关键通知主题；
- 让 LLM 重写结构化事实；
- 把 WhatsApp / Telegram recipient 写入业务 Domain；
- 为这次迁移准备引入 Kubernetes、service mesh、消息队列等额外基础设施；
- 在新 Mac mini 到手前执行真实主机切换。

## 2.2 世界观原则

标题可以有原作味道，正文必须先保证事实清晰、可操作。

错误示例：

```text
机关来了！世界线要完了！
```

如果没有同时告诉用户“哪个节点、什么错误、影响范围、时间、当前状态”，则视为不合格。

正确原则：

> **事实是真实系统语义，Steins;Gate 是 Presentation 语义。**

---

# 3. Re-audit Baseline / 当前已知事实

实施前必须重新读取最新 `main`，但当前已确认以下事实，实施过程中若仓库已变化，以最新代码为准并记录差异。

## 3.1 当前版本

```text
VERSION = 1.4.1
```

1.4.2 仍遵守现有 patch-only 版本策略：

```text
1.4.1 -> 1.4.2
```

不要修改已经在 1.4.1 正确实现的进位算法。

## 3.2 Product Radar 当前是“业务独立、投递已汇入、主题仍独立”

当前 Product Radar 是独立 generic service，这一点必须保留。

它当前拥有自己的 notification formatter，例如：

```text
🆕 新商品
💰 商品降价
⚠️ 商品状态变化
🖼️ 相似商品
```

随后 `OwnerNotificationChannel` 再把已经格式化好的 `message.text` 包装进 owner outbox；headline 仍是 `Product Radar`，而 Product Radar 自己的 owner event 事实结构基本退化为：

```ts
facts: [];
summary: string;
```

这意味着商品名、价格、卖家、相似度、变化类型等本来是结构化事实，却在进入统一通知层前已经丢失结构。

1.4.2 必须解决这个问题，而不是只改标题。

## 3.3 当前 repo 的核心 plugin / integration 已较干净

当前 top-level plugin 只有：

```text
plugins/
├── amadeus
└── pubg
```

当前 `integrations/` 主要只保留 OpenClaw。

这说明旧 LangBot / n8n 代码主体已经退出，不应继续让 release pipeline 长期保留它们的正常运行概念。

## 3.4 deploy script 仍保留迁移时代遗留

当前 `scripts/deploy-openclaw.sh` 仍包含：

```text
LANGBOT_APP_DIR
N8N_APP_DIR
N8N_SANDBOX_APP_DIR
LANGBOT_DATA_DIR
N8N_DATA_DIR
N8N_SANDBOX_DATA_DIR
```

以及相应 checkpoint / retirement / “不存在也继续”逻辑。

这些对象已经不再是当前 live runtime 的组成部分。1.4.2 应完成最后一次历史确认后正式退出正常 release path。

## 3.5 当前部署仍存在 host-specific 假设

需要重点重新审计：

- `MACHINE="ubuntu"` 类固定值；
- `/Users/<current-user>/...` 类硬编码；
- 固定 NVM 路径；
- 当前宿主机专属 LaunchAgent path；
- 只能在旧 Mac 上成立的脚本假设。

`doctor.sh` 已允许部分 `ORBSTACK_MACHINE` 环境覆盖，但 deploy / bootstrap / native worker scripts 必须一起统一。

## 3.6 Product Radar 有 native macOS worker

Product Radar 不只是 CasaOS container。

当前 image similarity 路径包含：

```text
Product Radar container / OrbStack Ubuntu
          ↓
host.docker.internal:18400
          ↓
native macOS FashionSigLIP LaunchAgent
          ↓
Apple MPS
```

迁移到 Mac mini 时必须显式考虑：

- LaunchAgent；
- Python / runtime 环境；
- FashionSigLIP model cache；
- 18400 health / bind policy；
- Product Radar 到 host worker 的连通；
- cache 是迁移还是在新机重拉。

## 3.7 changedetection 仍不是 dead code

Product Radar 当前仍把 changedetection 作为 compatible trigger；similarity feed 同时已有自己的 scheduler。

因此 changedetection 在本轮应先归类为 `COMPATIBILITY` 或 `ACTIVE`，不能未经引用审计直接删除。

## 3.8 当前 doctor 只验证运行态的一部分

现有 doctor 主要检查：

- OrbStack CLI；
- Ubuntu machine；
- OpenClaw；
- 9Router；
- Product Radar；
- Media adapter；
- OpenClaw / Product Radar HTTP health。

它还不是“是否可迁移”的检查器。

## 3.9 1.4.1 后存在少量 stale 文案

例如 PUBG Skill 中仍可能存在类似：

```text
stats, comparisons, and Match facts that do not carry a full presentation contract...
```

但 1.4.1 已保证 native PUBG results 有 validated `presentation` + canonical `displayText`。

本轮应顺手删除这类过期描述，避免未来 Agent 读到互相矛盾的规则。

## 3.10 `.agent/state.md` / current state docs 有历史叙事膨胀

当前 state 文件包含大量 1.3.0 / 1.4.0 / 1.4.1 deployment narrative。

Git history 与 deployment checkpoints 已经承担历史职责；当前 state 应优先描述“现在是什么”，而不是无限追加所有历史。

---

# 4. Target Worldline Notification Architecture

最终主动通知链路：

```text
Business / Domain Event
        ↓
Capability-specific Adapter
        ↓
WorldlineNotificationIntent
        ↓
Worldline Theme Policy
        ↓
Worldline Presentation Adapter
        ↓
OwnerNotificationPresentation
        ↓
Owner Outbox / Delivery Policy
        ↓
WhatsApp today / Telegram later / future channels
```

必须明确：

```text
Domain Event != Worldline theme
Worldline theme != Delivery channel
Delivery channel != recipient semantics
```

业务只表达事实与 owner-notification intent。

---

# 5. Scope A — Worldline Notification Contract

## 5.1 新增统一 Intent，而不是让各业务直接拼世界观文案

优先复用 `packages/presentation`，不要为本轮引入新的运行时包。

建议在：

```text
packages/presentation/src/worldline/
```

增加纯数据 / 纯函数模块，例如：

```text
contracts.ts
policy.ts
adapter.ts
renderer.ts
vocabulary.ts
```

具体文件名可按项目风格调整。

建议建立类似：

```ts
type WorldlineSeverity = 'info' | 'success' | 'warning' | 'error';

type WorldlineSignificance =
  | 'minor'
  | 'notable'
  | 'major'
  | 'critical';

type WorldlineNotificationIntent = {
  eventKey: string;
  source: string;
  kind: string;
  severity: WorldlineSeverity;
  significance: WorldlineSignificance;
  headline?: string;
  facts: PresentationFact[];
  summary?: string;
  occurredAt: string;
  dataUpdatedAt?: string;
  links?: Array<{ label: string; url: string }>;
  correlation?: {
    fingerprint?: string;
    occurrenceCount?: number;
    windowMinutes?: number;
  };
  operation?: {
    code?: string;
    phase?: string;
  };
};
```

字段可按现有 owner contract 调整，但必须满足：

- 事实保持结构化；
- transport-neutral；
- Steins;Gate-neutral input；
- theme 由 policy 决定，不由 Domain 任意写；
- 可被 runtime validator 验证；
- 不允许 object 任意塞进 facts value；
- 时间遵循现有 presentation formatter；
- unknown 不得变成 0。

## 5.2 Theme 不由 LLM 决定

Theme 必须由 deterministic policy 选择。

建议正式 theme enum：

```ts
type WorldlineTheme =
  | 'worldline_observation'
  | 'worldline_divergence'
  | 'worldline_convergence'
  | 'dmail'
  | 'reading_steiner'
  | 'attractor_field'
  | 'rounder_activity'
  | 'sern_alert'
  | 'ibn_5100'
  | 'time_leap'
  | 'operation_skuld';
```

不要让 source 调用者直接把所有事件都标成 `sern_alert`。

允许 capability adapter 提供非常窄的 semantic hint，但最终 policy 必须可测试、可审计。

---

# 6. Scope B — 正式世界线 Vocabulary

除原作专有名词外，默认用户可见标题尽量使用中文。

正式 vocabulary：

| Internal theme | 用户可见名称 | 语义 |
|---|---|---|
| `worldline_observation` | **世界线观测** | 普通新事件 / 新事实 |
| `worldline_divergence` | **世界线偏移** | 状态发生明显变化 |
| `worldline_convergence` | **世界线收束** | 任务、部署、恢复最终成功稳定 |
| `dmail` | **D-Mail** | 异步 / 定时主动报告 |
| `reading_steiner` | **Reading Steiner** | 当前现实与记录 / 预期状态发生漂移 |
| `attractor_field` | **吸引子场** | 同类异常在时间窗口内反复出现，形成重复故障模式 |
| `rounder_activity` | **Rounder 活动** | 可疑探测 / 扫描 / 未确认安全异常 |
| `sern_alert` | **SERN 警报** | 已有高可信安全风险或 critical security event |
| `ibn_5100` | **IBN 5100** | 关键依赖 / 关键 Artifact 状态事件 |
| `time_leap` | **时间跳跃** | rollback / restore 到已知稳定状态 |
| `operation_skuld` | **Operation Skuld · 斯库尔德行动** | 重大主机 / 世界线迁移计划与阶段事件 |

注意：

- 正确专有名词是 **SERN**，不是 SREN。
- `D-Mail`、`SERN`、`Reading Steiner`、`Rounder`、`IBN 5100`、`Operation Skuld` 保留原作名称。
- 其余尽量中文。

## 6.1 不要把所有通知都 D-Mail 化

`D-Mail` 表示主动 / 异步报告，不等于“任何被发送的消息”。

例如：

```text
每日简报              -> D-Mail
PUBG 自动同步日报      -> D-Mail
市场开盘 / 收盘报告    -> D-Mail
Product Radar 命中     -> 世界线观测（可以通过 owner delivery 投递，但 theme 不是 D-Mail）
部署成功               -> 世界线收束
SSH 扫描               -> Rounder 活动
高可信异常登录         -> SERN 警报
```

## 6.2 Reading Steiner 的工程定义

只用于“recorded desired / known state 与 observed live state 不一致”。

例如：

- Git 声明镜像与 live image 不一致；
- 已记录 cron 数量与 live cron 不一致；
- deployment manifest 与 live tool / skill count 不一致；
- compose / config drift。

示例：

```text
Amadeus • Reading Steiner

观测到当前世界线与记录状态存在偏差。

OpenClaw 镜像
记录：git-abc123
当前：git-xyz789

Cron
记录：6
当前：7

当前现实与已记录世界线不一致。
```

不能把普通 error 都叫 Reading Steiner。

## 6.3 吸引子场必须有重复证据

`attractor_field` 不能只是一个漂亮标题。

本轮建立最小可用 correlation 语义：

```text
fingerprint = source + kind + resource + stable-error-code
```

当上游已经能提供 occurrence count / repeated incident evidence 时，policy 可以提升为吸引子场。

如果实现一个轻量 persistent correlator 不会把通知层变复杂，可在 Amadeus notification 边界持久化最小 fingerprint 时间窗口；否则本轮至少完成 contract + tests，并要求调用方提供真实 `occurrenceCount >= threshold` 才允许选择吸引子场。

禁止：没有重复证据就由 LLM / 文案层自行宣称“吸引子场”。

## 6.4 Rounder 与 SERN 必须区分

建议：

```text
扫描 / probe / 反复失败认证但无成功入侵证据
-> Rounder 活动

高可信异常成功认证 / 权限突破 / critical security evidence
-> SERN 警报
```

SERN 必须有重量。

如果当前 VPS read-only probe **没有安全数据源**，不要假装已经具备入侵检测；只建立正确 event / presentation 边界。

如果现有只读 VPS 能安全、稳定地提供聚合后的 auth anomaly 数据，则可以在本轮增加窄的只读 security snapshot：

- 只返回聚合统计 / 必要 IP 摘要；
- 不扩大为 SIEM 项目；
- 不读取无关用户数据；
- 不增加写权限；
- 没有证据时绝不触发 SERN。

## 6.5 IBN 5100 只用于关键依赖

建立 `critical dependency / critical artifact` 概念。

候选包括：

- NAS；
- owner notification outbox；
- OpenClaw secrets；
- primary SQLite DB；
- Cloudflare / tunnel / reverse-proxy critical path；
- Git-backed release state；
- backup checkpoint。

只有被明确标为 critical 的依赖进入 `IBN 5100` 主题。

## 6.6 时间跳跃只用于真实 rollback / restore

例如：

```text
Amadeus • 时间跳跃

正在恢复到上一个稳定世界线。

目标版本：1.4.1
Checkpoint：...
```

普通 restart 不能叫时间跳跃。

## 6.7 Operation Skuld 只用于重大迁移

本轮只产生 `readiness / planned` 状态，不实际切换主机。

Mac mini 迁移是第一个正式 Operation Skuld。

---

# 7. Scope C — Severity 与 Significance 分离

新增 `significance` 的原因：风险程度和“世界线重要程度”不是同一件事。

例如：

商品降价 60%：

```text
severity = info
significance = notable
theme = 世界线偏移
```

NAS 关键数据盘异常：

```text
severity = error
significance = critical
theme = IBN 5100 或 SERN（取决于事件语义，不可混用）
```

规则：

- severity：危险 / 操作风险；
- significance：值得 Arthur 注意的程度；
- theme：世界观表现分类；
- 三者不要互相偷换。

必须写 deterministic policy tests。

---

# 8. Scope D — Product Radar 结构化通知重构

## 8.1 Product Radar Domain 保持 generic

以下结构继续保留：

```text
Listing
Watch
Source
Sensor
Matcher
RadarEvent
SQLite
```

禁止把 `SERN` / `世界线` / `D-Mail` 写进 Product Radar core domain。

## 8.2 停止把事实先压成一段 message.text

当前：

```text
RadarEvent
  -> Product Radar formatter
  -> string
  -> owner notification summary
```

目标：

```text
RadarEvent
  -> ProductRadarWorldlineAdapter
  -> structured WorldlineNotificationIntent
  -> Worldline policy/presentation
  -> owner notification
```

至少覆盖：

```text
ListingMatchedEvent
ProductPriceChangedEvent
ProductStatusChangedEvent
SimilarListingMatchedEvent
ListingUpdated / equivalent
```

事实至少保留：

- listing title；
- source display name；
- seller；
- before / after price；
- currency；
- before / after status；
- matched keywords；
- similarity / threshold；
- listing URL（若 contract 支持 links，优先结构化 link）；
- occurredAt / dataUpdatedAt。

## 8.3 Product Radar 默认主题建议

```text
new listing
-> 世界线观测

price changed
-> 世界线偏移

status changed
-> 世界线偏移

similar listing matched
-> 世界线观测

source degraded
-> 世界线偏移 / warning

source recovered
-> 世界线收束
```

不要因为商品价格变化很大就自动变成 SERN。

## 8.4 Product Radar 不再拥有 WhatsApp 语义

当前类似：

```text
channel.id = owner-whatsapp
```

应改成 transport-neutral 的 owner sink / owner notification boundary。

例如：

```text
owner
owner-outbox
owner-notification
```

具体名称可根据现有 ports 调整。

Product Radar 只知道：

> “这个 event 需要通知 owner。”

最终今天发 WhatsApp、未来主要发 Telegram，由 Amadeus delivery policy 决定。

本轮**不需要完成 Telegram 主渠道迁移**，只需要去掉 Product Radar 对 WhatsApp 的业务耦合。

---

# 9. Scope E — 现有主动通知全部统一

实施前搜索全部 producer，不要凭计划书猜文件。

至少审计当前已知来源：

- Product Radar；
- Market open / close；
- PUBG telemetry sync / report；
- Amadeus deploy / release；
- Codex completion hook；
- VPS report；
- HomeLab status / service action；
- NAS；
- Media organizer；
- owner notification native tool；
- 其他 scheduler / cron producer。

对每个 producer 建立表：

```text
source
current event / formatter
current transport assumption
new Worldline intent adapter
new theme policy
owner destination
```

所有主动通知必须满足：

1. 进入统一 structured owner contract；
2. 经过 worldline policy / presentation；
3. 保留 dataUpdatedAt（适用时）；
4. 不把 facts 压成无法重用的 prose；
5. 默认正文不暴露内部 timezone / runtime 实现术语；
6. 不由业务自行 hardcode WhatsApp recipient；
7. outbox 幂等语义保持不退化。

---

# 10. Scope F — Notification Presentation 示例与规范

以下示例是风格契约，不要求逐字复制。

## 10.1 世界线观测

```text
Amadeus • 世界线观测

Product Radar 捕获到新的目标。

目标：Chrome Hearts ...
价格：₩380,000
卖家：...
来源：번개장터

观测时间：15:42
```

## 10.2 世界线偏移

```text
Amadeus • 世界线偏移

VPS 网络状态发生明显变化。

延迟：42 ms → 186 ms
丢包率：0% → 12%
持续：5 分钟

当前服务仍可访问。
```

## 10.3 世界线收束

```text
Amadeus • 世界线收束

Amadeus 1.4.2 已完成部署。

版本：1.4.2
Health：正常
Doctor：0 failure / 0 warning

El Psy Kongroo.
```

不要让每个普通 success 都强制带 closing；release / major convergence 可以使用。

## 10.4 D-Mail

```text
Amadeus • D-Mail

今日 PUBG 自动同步完成。
...

数据更新时间：...

El Psy Kongroo.
```

## 10.5 Reading Steiner

```text
Amadeus • Reading Steiner

观测到当前世界线与记录状态存在偏差。

记录镜像：git-abc123
当前镜像：git-xyz789

当前现实与已记录世界线不一致。
```

## 10.6 吸引子场

```text
Amadeus • 吸引子场异常

Emby 在过去 6 小时内第 3 次出现相同故障。

异常：容器异常退出
次数：3

这已经不是一次孤立波动。
```

只有真实 correlation evidence 才允许这类文案。

## 10.7 Rounder 活动

```text
Amadeus • Rounder 活动

VPS 边界检测到重复 SSH 探测。

来源：...
尝试：17 次
持续：4 分钟

目前没有成功认证记录。
```

## 10.8 SERN 警报

```text
Amadeus • SERN 警报

检测到高可信安全异常。

节点：VPS
事件：无法解释的成功认证
来源：...
时间：...

当前事件已提升为最高优先级。
```

没有 evidence 不允许输出。

## 10.9 IBN 5100

```text
Amadeus • IBN 5100 LOST

关键依赖 NAS 当前不可达。

受影响：
- Emby
- Immich
- Media Organizer

OpenClaw 本身仍正常。
```

恢复可显示：

```text
Amadeus • IBN 5100 RECOVERED
```

## 10.10 时间跳跃

```text
Amadeus • 时间跳跃

正在恢复到上一个稳定世界线。

目标版本：1.4.1
Checkpoint：...
```

## 10.11 Operation Skuld

```text
Operation Skuld · 斯库尔德行动

迁移准备状态：READY

Persistent data：PASS
Secrets inventory：PASS
FashionSigLIP：PASS
Backup：PASS
Restore rehearsal：PASS
Host profile：PASS

尚未切换主世界线。
```

---

# 11. Scope G — Secondary Steins;Gate Vocabulary

以下概念保留为**次级标签 / 彩蛋 / 未来扩展**，本轮不要扩大成新的核心 runtime 状态机：

- `Future Gadget`：可作为实验能力 / capability 的展示标签；
- `Lab Mem`：可作为可信节点 / asset 的趣味称呼；
- `Valkyrie`：可用于未来灾备 / recovery 项目的 UI / 文档命名；
- `Divergence Meter`：未来可作为纯 UI 的 change index，不得假装成真实概率。

1.4.2 不要求实现 Divergence Meter，不要求给每个 service 编 Future Gadget 编号。

---

# 12. Scope H — Legacy Runtime Cleanup

## 12.1 删除 LangBot / n8n 正常 release path

重新确认 canonical live host 上：

- LangBot 已不存在；
- n8n 已不存在；
- n8n-sandbox 已不存在；
- 当前任何 active capability 不依赖它们。

确认后从正常 deploy / backup / retirement / smoke 中删除：

```text
LANGBOT_APP_DIR
N8N_APP_DIR
N8N_SANDBOX_APP_DIR
LANGBOT_DATA_DIR
N8N_DATA_DIR
N8N_SANDBOX_DATA_DIR
```

以及对应：

- old compose checkpoint；
- stop/remove；
- “No such object” tolerated path；
- legacy runtime retirement smoke；
- 已失去意义的文档说明。

历史信息仍可留在 Git history / archived docs，不要继续污染当前 release flow。

## 12.2 建立 infrastructure classification

对 repo 中所有非核心组件做一次引用审计，并记录为：

```text
ACTIVE
OPTIONAL
COMPATIBILITY
MIGRATION_ONLY
DEAD
```

至少包含：

```text
changedetection
media-organizer-adapter
FashionSigLIP worker
Cloudflare assets
VPS read-only probe
old migration scripts
old compose examples
old patch scripts
legacy notification compatibility
```

规则：

- `ACTIVE`：保留并验证；
- `OPTIONAL`：保留但不作为核心 health blocker；
- `COMPATIBILITY`：记录退出条件，不误删；
- `MIGRATION_ONLY`：只在 Operation Skuld 使用；
- `DEAD`：删除代码、脚本、文档引用和 tests。

## 12.3 changedetection 特别规则

不能直接删。

先确认：

- 哪些 watch 仍依赖 changedetection trigger；
- 哪些 feed 已完全由 internal scheduler 覆盖；
- webhook 是否仍在 production 使用。

如果仍有真实依赖，标记 `COMPATIBILITY` 并写清退出条件。

---

# 13. Scope I — 清理 stale Prompt / Skill / State

## 13.1 PUBG Skill

移除 1.4.1 后已经不成立的说明，例如“某些 stats / comparison / Match facts 没有 full presentation”。

最终规则应只有一个：

> Every native PUBG result carries a validated presentation and canonical displayText. For final factual replies, use displayText instead of reconstructing facts from raw fields.

不要重新加入冗长重复 workflow。

## 13.2 SOUL

SOUL 继续只负责 Kurisu persona。

不要把这次 worldline policy 规则写进 SOUL。

Kurisu 可以自然使用世界线语言，但正式主动通知的主题由 Presentation / policy 决定。

## 13.3 `.agent/state.md` / project state

把“current state”与“history”分开。

当前状态文件顶部应能快速回答：

```text
Current release
Current runtime
Current plugins
External services
Current host assumptions
Migration readiness
Active goal
```

不要继续把每个历史部署全文无限追加到 current state。

历史可：

- 移入 `docs/archive/`；
- 使用已有 deployment checkpoint；
- 依赖 Git history。

不要为了清文档删除有审计价值的 release evidence。

---

# 14. Scope J — Host-Neutral Deployment

## 14.1 目标

1.4.2 部署脚本必须不再绑定旧 Mac 的具体用户名 / Home 路径。

目标是在未来新 Mac mini 上：

```text
clone repo
configure host profile
bootstrap
restore persistent data/secrets
install native workers
deploy
```

而不是编辑 deploy script source。

## 14.2 Host Profile

不要建设配置中心。

使用简单、可审计、secrets-free 的 profile / env 即可，例如：

```text
ORBSTACK_MACHINE=ubuntu
AMADEUS_DATA_ROOT=/DATA/AppData
OPENCLAW_APP_DIR=/var/lib/casaos/apps/openclaw
PRODUCT_RADAR_APP_DIR=/var/lib/casaos/apps/product-radar
FASHION_SIGLIP_PORT=18400
```

可以是：

- environment；
- tracked `.env.example` + external real env；
- 小型 profile file。

选择与现有脚本风格最一致的方式。

严禁把 secrets 加入 tracked profile。

## 14.3 Home / runtime discovery

删除：

```text
/Users/blacksidev/...
```

这类 host-specific hardcode。

应使用：

```text
$HOME
command -v
NVM_DIR
node / pnpm discovery
```

或项目已有 runtime bootstrap。

如果 release 要求固定 Node 版本，使用版本检查 / installer，而不是绑定旧 Home path。

## 14.4 `MACHINE=ubuntu`

保留默认值没有问题，但必须支持统一的 profile / env override，deploy、doctor、bootstrap、migration readiness 使用同一个来源。

不要每个脚本自己发明一套变量名。

---

# 15. Scope K — FashionSigLIP Migration Readiness

必须把 native worker 当成正式迁移资产，而不是“顺便记得装”。

建立 inventory：

```text
LaunchAgent label
worker source / install script
Python/runtime requirements
model identifier
model cache location
worker port
health endpoint
Product Radar connection path
Apple Silicon / MPS expectation
```

迁移策略明确二选一：

1. **模型缓存重新下载**（推荐，如果缓存可再生且不影响关键数据）；
2. **复制 model cache**（只有明显节省时间且安全时）。

无论选择哪个，都必须区分：

```text
critical persistent state
rebuildable cache
```

FashionSigLIP model cache 不应和不可丢的 SQLite / secrets 放在同一恢复等级。

增加一个 host-worker health check，供 migration readiness 与新机 cutover 后验收复用。

---

# 16. Scope L — Migration Manifest

新增一个可机器读取或至少可稳定解析的 migration manifest。

建议：

```text
docs / config + script generated inventory
```

不要把 secrets 内容写进去。

至少覆盖：

## Persistent critical data

- OpenClaw data；
- PUBG SQLite；
- Product Radar SQLite / feature state；
- owner outbox pending / sent state（根据幂等策略决定迁移范围）；
- identity DB；
- VPS usage state；
- 其他 active capability persistent state。

## Secrets

只记录：

```text
logical name
expected external path
required / optional
present / missing
```

禁止记录 secret value。

## Runtime / infrastructure

- OrbStack machine；
- CasaOS apps；
- OpenClaw image / compose；
- Product Radar image / compose；
- 9Router；
- media adapter；
- changedetection（按 classification）；
- frpc / tunnels（如果 host 侧存在）；
- cron definitions；
- LaunchAgents；
- FashionSigLIP；
- NAS mounts / SSH readonly dependencies。

## Rebuildable state

- Docker images；
- node_modules；
- pnpm cache；
- model cache（如果选择重拉）；
- temp files；
- build artifacts。

---

# 17. Scope M — Migration Readiness Checker

新增：

```text
scripts/migration-readiness.sh
```

或者等价入口；不要把 `doctor.sh` 变成难维护的巨型脚本。如果复用 doctor helpers 更合理，可以抽 shared shell helpers。

目标输出类似：

```text
PASS Git working tree clean
PASS VERSION 1.4.2
PASS OpenClaw persistent data identified
PASS PUBG SQLite identified
PASS Product Radar database identified
PASS Identity database identified
PASS Owner outbox identified
PASS Secrets inventory complete
PASS FashionSigLIP LaunchAgent identified
PASS FashionSigLIP worker health
PASS CasaOS compose sources tracked
PASS Cron definitions reproducible
PASS Host profile has no machine-specific username hardcode
PASS Backup checkpoint created
PASS SQLite integrity checks
PASS Restore rehearsal on temporary paths

WARN FashionSigLIP model cache will be re-downloaded

OPERATION_SKULD=READY
```

如果有 blocker：

```text
OPERATION_SKULD=BLOCKED
```

并明确列出原因。

## 17.1 Readiness 必须检查的内容

至少：

- git clean；
- current VERSION；
- required tracked compose/config sources；
- persistent data path exists；
- SQLite integrity (`PRAGMA integrity_check`) on copies / read-safe mode；
- required secret files exist and permission reasonable；
- owner outbox readable；
- cron source of truth tracked；
- FashionSigLIP installer + LaunchAgent / health；
- OrbStack profile；
- Docker containers / health；
- current image tags；
- no unresolved `DEAD` infra classification；
- no active LangBot / n8n dependency；
- backup exists；
- restore rehearsal succeeds on temporary destination；
- no hardcoded old Mac username in active deployment path。

## 17.2 Readiness 不能做的事

默认运行不能：

- stop production containers；
- overwrite current data；
- rotate secrets；
- change DNS；
- change Cloudflare；
- move NAS data；
- start cutover；
- send unsolicited real user messages。

它是 read-only / temp-copy verification。

---

# 18. Scope N — Backup / Restore Rehearsal

现有 backup / checkpoint 机制必须纳入 Operation Skuld，而不是另建一套无关备份系统。

本轮增加：

1. backup inventory；
2. checksum / size summary；
3. SQLite integrity checks；
4. temporary restore rehearsal；
5. clear RPO / what-is-not-backed-up notes。

建议 restore rehearsal：

```text
current persistent data
   -> backup/checkpoint
   -> temporary isolated directory
   -> verify expected files
   -> SQLite integrity check
   -> no production service starts against temp restore
```

不要在 1.4.2 对 live data 做 destructive restore。

---

# 19. Scope O — Operation Skuld Runbook

新增正式文档：

```text
docs/OPERATION_SKULD_MAC_MINI_MIGRATION_RUNBOOK.md
```

这是新 Mac mini 到手后执行的唯一主 Runbook。

建议阶段：

## Phase 0 — 世界线冻结

- 当前旧 Mac 维持 live；
- 记录 1.4.2 release / image / checkpoint；
- 生成最后一次 backup；
- 禁止边迁移边继续重构。

## Phase 1 — 新 Lab 节点建立

- macOS base setup；
- OrbStack；
- Ubuntu / CasaOS；
- required CLI / Node / pnpm；
- repo clone；
- host profile。

## Phase 2 — Persistent data restore

- OpenClaw；
- PUBG DB；
- Identity；
- Product Radar；
- owner outbox / state；
- required external config / secrets。

## Phase 3 — Native worker restore

- FashionSigLIP LaunchAgent；
- model cache strategy；
- MPS health；
- 18400 health；
- Product Radar bridge smoke。

## Phase 4 — 双世界线验证

旧主机继续在线，新机禁止接管外部流量。

验证：

- OpenClaw health；
- Product Radar health；
- 9Router；
- PUBG queries；
- owner notification dry/smoke；
- NAS read-only；
- media adapter；
- cron inventory；
- current Skill / tool count；
- FashionSigLIP；
- backup path；
- doctor。

## Phase 5 — Cutover

只在用户明确执行 Operation Skuld 时进行：

- freeze writes where needed；
- final delta data sync；
- switch tunnels / frpc / DNS / host endpoint as applicable；
- enable schedules on new host；
- disable duplicate schedules on old host；
- verify inbound / outbound；
- old host stays available for rollback。

## Phase 6 — 世界线收束

```text
Operation Skuld Complete

主运行节点：Mac mini
旧节点：Standby
Health：PASS
Doctor：0 failure / 0 warning
```

## Rollback — 时间跳跃

明确：

- rollback trigger；
- old host reactivation；
- reverse routing；
- data divergence warning；
- when rollback is no longer safe。

本 Goal **只写并验证 Runbook，不执行 Phase 5**。

---

# 20. Scope P — Doctor / Health Enhancement

保留现有 `doctor.sh` 的 live health 价值。

改进建议：

- 与 host profile 使用同一 machine / path source；
- 可选检查 FashionSigLIP native worker；
- 能区分 `ACTIVE` 与 `OPTIONAL / COMPATIBILITY` service；
- 不再检查已经退休的 LangBot / n8n；
- 可输出 machine-readable summary（如果很轻量）；
- 不把 migration readiness 全塞进 doctor。

最终：

```text
doctor.sh                 -> 当前 live runtime 健康
migration-readiness.sh    -> 是否可执行 Operation Skuld
```

职责分离。

---

# 21. Scope Q — Architecture Fitness Checks

扩展 `scripts/check-architecture.mjs` / fixture tests。

至少新增以下规则。

## 21.1 世界线词汇不得进入 deterministic Domain

扫描核心 Domain / generic service core，禁止直接依赖 worldline presentation vocabulary。

Product Radar core / PUBG Domain 等不应出现：

```text
SERN
Reading Steiner
Operation Skuld
世界线收束
世界线偏移
```

合法位置：

- presentation；
- capability adapter；
- docs/tests；
- release / migration UI text。

## 21.2 Proactive notification producer coverage

建立明确 registry / adapter coverage，避免未来新增 producer 绕过 Worldline presentation。

不要靠 grep 某个标题；优先通过类型 / registry / fixture 约束。

## 21.3 禁止业务层 transport destination

Product Radar core / generic service 不得出现：

```text
owner-whatsapp
whatsapp recipient
telegram recipient
```

transport-specific delivery 只在 integration / delivery boundary。

## 21.4 active deploy path 禁止旧 runtime

active deployment source 不得继续引用：

```text
langbot
n8n-sandbox
legacy n8n runtime
```

archive docs 可以保留历史。

## 21.5 active deploy path 禁止旧主机用户名

至少对 active scripts / infra 检测：

```text
/Users/blacksidev
```

或其他明确旧主机绝对 Home path。

允许 archived deployment evidence 中存在历史路径。

## 21.6 Worldline policy fixtures

至少覆盖：

```text
new listing -> 世界线观测
price change -> 世界线偏移
deploy success -> 世界线收束
scheduled report -> D-Mail
state drift -> Reading Steiner
repeated incident with evidence -> 吸引子场
scan without successful auth -> Rounder 活动
high-confidence security compromise -> SERN 警报
critical dependency lost -> IBN 5100
rollback -> 时间跳跃
migration readiness / phase -> Operation Skuld
```

同时测试错误映射：

```text
普通商品事件 != SERN
单次 container failure != 吸引子场
普通 restart != 时间跳跃
普通通知 != D-Mail
```

---

# 22. Scope R — Tests

## 22.1 Presentation tests

至少覆盖：

- every Worldline theme validates；
- Chinese display titles；
- 专有名称保持正确大小写 / 拼写；
- `SERN` 不写成 `SREN`；
- facts 保留；
- links 保留；
- `dataUpdatedAt` local rendering；
- unknown 不变 0；
- owner long-message split 仍保留结构事实；
- theme rendering 不泄露 `Asia/Shanghai` / `UTC+08` 等内部术语；
- `El Psy Kongroo.` 只在 contract/policy 要求时出现一次。

## 22.2 Product Radar tests

至少覆盖：

- ListingMatchedEvent -> structured intent；
- price before / after 不丢；
- status before / after 不丢；
- similarity / threshold 不丢；
- seller / source / URL 不丢；
- worldline adapter output valid；
- owner sink transport-neutral；
- old formatter prose 不再是唯一事实来源；
- baseline silent behavior不被改变。

## 22.3 Migration tests

至少覆盖：

- profile default / override；
- no old username hardcode；
- migration manifest contains required logical assets；
- secret values never printed；
- missing required secret -> BLOCKED；
- missing optional cache -> WARN；
- SQLite integrity failure -> BLOCKED；
- temp restore works；
- readiness does not mutate live service；
- dead legacy runtimes no longer required。

---

# 23. Scope S — Security / Privacy Constraints

Worldline theming不能成为泄漏更多安全数据的理由。

安全通知默认只显示排障所需最小事实。

例如公网 IP 可以按现有安全策略显示必要值，但：

- 不 dump 全量 auth log；
- 不 dump tokens；
- 不 dump secrets；
- 不 dump cookies；
- 不把 owner target 写进 generic domain；
- migration manifest 只记录 secret logical name / path / present state；
- backup evidence 不打印 secret 内容。

---

# 24. Scope T — Version / Release

当前：

```text
1.4.1
```

实现全部完成、源码验证通过后：

```sh
./scripts/amadeus-version.sh bump patch
```

必须得到：

```text
1.4.2
```

更新 `RELEASE_NOTES.md`，只描述 1.4.2 当前 release。

建议摘要：

```text
统一 Amadeus 主动通知为结构化世界线 Presentation，Product Radar 与现有报告接入同一 owner notification 边界；清理已退休 runtime 和 stale migration path，移除旧主机硬编码，并新增 Operation Skuld 的 host profile、migration inventory、readiness check、backup/restore rehearsal 与 Mac mini migration runbook。
```

Release notes 仍遵守现有“不写 runtime 品牌名”等当前规则。

---

# 25. Implementation Phases

## Phase 0 — Re-audit / Inventory

- 拉取 `origin/main`；
- 确认 `VERSION=1.4.1`；
- 搜索所有 owner notification producers；
- 搜索所有 `WhatsApp` / `owner-whatsapp` business coupling；
- 搜索所有 LangBot / n8n active references；
- 搜索 old host absolute paths；
- inventory native LaunchAgents / cron / external files；
- inventory all persistent DBs；
- 生成 infrastructure classification 草案。

Checkpoint：

```text
1.4.2 Phase 0 audit complete
```

## Phase 1 — Worldline contract / policy / renderer

- 建立 Worldline intent；
- significance；
- theme vocabulary；
- deterministic policy；
- adapter 到 owner presentation；
- validators；
- renderers；
- tests。

Checkpoint：

```text
worldline presentation foundation complete
```

## Phase 2 — Product Radar migration

- 保持 generic domain；
- 移除 prose-first notification boundary；
- structured facts；
- Product Radar worldline adapter；
- owner transport-neutral sink；
- tests；
- baseline / scheduler / changedetection behavior不退化。

Checkpoint：

```text
product radar notification migration complete
```

## Phase 3 — Existing proactive producers

- market；
- PUBG sync；
- deploy；
- Codex；
- VPS；
- HomeLab；
- NAS；
- media；
- any other real producer。

逐个接入统一 boundary。

Checkpoint：

```text
all proactive notification producers covered
```

## Phase 4 — Legacy cleanup

- infrastructure classification final；
- delete DEAD；
- retire LangBot / n8n release path；
- keep changedetection only if still required；
- stale Skill cleanup；
- current state docs cleanup；
- architecture fitness checks。

Checkpoint：

```text
legacy cleanup complete
```

## Phase 5 — Host-neutral deployment

- shared host profile；
- remove old username absolute paths；
- align deploy / doctor / bootstrap / FashionSigLIP scripts；
- tests / shellcheck-equivalent syntax checks。

Checkpoint：

```text
host-neutral deployment complete
```

## Phase 6 — Operation Skuld readiness

- migration manifest；
- readiness checker；
- FashionSigLIP inventory；
- backup inventory；
- temp restore rehearsal；
- migration runbook；
- dry-run until READY or documented blocker。

Checkpoint：

```text
Operation Skuld readiness complete
```

## Phase 7 — Release 1.4.2

Run full validation：

```text
pnpm build
pnpm typecheck
pnpm test
pnpm check:architecture
pnpm test:architecture
pnpm check:secrets
pnpm workflow:verify
bash scripts/test-amadeus-version.sh
bash scripts/migration-readiness.sh
./scripts/developer-workflow.sh --run --check-secrets
git diff --check
```

具体命令按当前 package scripts 调整，不能伪造不存在的 command。

然后：

```text
1.4.1 -> 1.4.2
implementation commit
push origin/main
```

## Phase 8 — Deploy to CURRENT host

这次仍部署到当前 canonical CasaOS 主机，不迁 Mac mini。

必须：

```text
dry-run
apply/build-auto or appropriate immutable image path
health
preflight
Product Radar health
FashionSigLIP health where applicable
NAS readonly smoke
owner outbox smoke
doctor
migration-readiness final read-only check
```

不要发送未经请求的真实群聊 / owner spam。

## Phase 9 — Deployment evidence

单独提交：

```text
docs/reports/...1.4.2...deployment...
```

或遵循现有 deployment evidence 目录规范。

记录：

- implementation commit；
- images；
- checkpoint；
- health；
- doctor；
- Worldline presentation smoke；
- Product Radar smoke；
- migration readiness result；
- remaining blockers（若有）；
- 明确 `Operation Skuld NOT YET EXECUTED`。

commit + push。

---

# 26. Acceptance Criteria

只有以下全部满足，1.4.2 才可宣布完成。

## Worldline / Notification

- [ ] 存在单一 validated Worldline notification intent / presentation path。
- [ ] theme 由 deterministic policy 决定，不由 LLM 决定。
- [ ] 正式 vocabulary 已实现：世界线观测、世界线偏移、世界线收束、D-Mail、Reading Steiner、吸引子场、Rounder 活动、SERN 警报、IBN 5100、时间跳跃、Operation Skuld。
- [ ] 非专有名称默认使用中文。
- [ ] SERN 拼写正确。
- [ ] severity 与 significance 分离。
- [ ] Product Radar 不再把全部结构化事实压成 `summary` 字符串。
- [ ] Product Radar generic core 不知道 Steins;Gate vocabulary。
- [ ] Product Radar 不再拥有 `owner-whatsapp` 业务语义。
- [ ] 现有主动通知 producer 已 inventory 并全部分类 / 接入统一 boundary。
- [ ] owner outbox 幂等和 1.4.1 分片行为无回归。
- [ ] dataUpdatedAt 适用时保留。
- [ ] facts / links 适用时保留。
- [ ] 默认用户文本不暴露内部 timezone / day-boundary 实现术语。
- [ ] ordinary event 不会误映射成 SERN / 吸引子场 / 时间跳跃。

## Legacy Cleanup

- [ ] active plugins 仍只有真实需要的 plugin。
- [ ] active release path 不再处理 LangBot / n8n / n8n-sandbox。
- [ ] 不再出现每次 deploy 都对不存在 legacy container 打 `No such object` 的正常路径。
- [ ] infrastructure classification 已完成。
- [ ] changedetection 已根据真实引用决定保留 / 退出，不误删。
- [ ] PUBG 1.4.1 stale Skill wording 已清理。
- [ ] current state docs 不再无限堆叠旧部署全文。

## Host Neutral

- [ ] active deployment scripts 无 `/Users/blacksidev` 等旧主机硬编码。
- [ ] deploy / doctor / bootstrap 使用一致的 host profile / env source。
- [ ] OrbStack machine 可配置且默认行为不退化。
- [ ] secrets 不进入 tracked host profile。
- [ ] FashionSigLIP native worker 可在新主机按 tracked installer 重建。

## Operation Skuld

- [ ] 存在 migration manifest。
- [ ] manifest 区分 critical persistent state / secret reference / rebuildable cache。
- [ ] 存在 `scripts/migration-readiness.sh` 或等价明确入口。
- [ ] readiness 默认 read-only / temp-copy，不改变 production。
- [ ] required SQLite integrity checks 通过。
- [ ] secret inventory 只验证 path/presence，不打印内容。
- [ ] backup checkpoint 已验证。
- [ ] temp restore rehearsal 通过。
- [ ] FashionSigLIP migration strategy 明确。
- [ ] cron / LaunchAgent / CasaOS / 9Router / media / NAS 依赖已进入迁移 inventory。
- [ ] 存在 `docs/OPERATION_SKULD_MAC_MINI_MIGRATION_RUNBOOK.md`。
- [ ] Runbook 有 freeze / bootstrap / restore / dual verification / cutover / convergence / rollback。
- [ ] 本 Goal 没有提前执行 Mac mini cutover。
- [ ] readiness 最终输出 `OPERATION_SKULD=READY`，或明确列出真实 blocker；不得伪造 READY。

## Release

- [ ] `VERSION=1.4.2`。
- [ ] patch-only version fixtures 继续通过。
- [ ] build / typecheck / full tests 通过。
- [ ] architecture checks 通过。
- [ ] secrets scan 通过。
- [ ] workflow verify 通过。
- [ ] `git diff --check` 通过。
- [ ] implementation commit 已 push。
- [ ] 1.4.2 已部署到**当前** canonical CasaOS host。
- [ ] live health / preflight / smoke / doctor 通过。
- [ ] Product Radar worldline notification smoke 通过但不向真实群聊 spam。
- [ ] migration readiness 在 live host 通过或留下明确 blocker。
- [ ] deployment evidence 单独 commit + push。
- [ ] 最终 Git clean。

---

# 27. Definition of Done / 最终状态

1.4.2 完成后的系统应该可以被一句话描述：

> **Amadeus 的所有主动通知都通过统一、结构化、确定性的世界线 Presentation 输出；Steins;Gate 只存在于表现层，不污染业务 Domain。旧 LangBot/n8n 迁移设施已经退出正常 release path，部署不再绑定旧 Mac，当前主机已经具备经过验证的 backup / restore / inventory / readiness / Runbook，Mac mini 到手后可以按 Operation Skuld 直接迁移。**

最终视觉 / 架构方向：

```text
               Domain Events
                    │
      ┌─────────────┼──────────────┐
      │             │              │
 Product Radar     PUBG       Market / HomeLab / VPS
      │             │              │
      └─────────────┼──────────────┘
                    ▼
        Worldline Notification Intent
                    ▼
         deterministic Theme Policy
                    ▼
          Worldline Presentation
                    ▼
          Owner Notification
                    ▼
            Delivery Policy
                    ▼
       WhatsApp today / Telegram later
```

当前旧 Mac 完成 1.4.2 后应处于：

```text
Amadeus 1.4.2
Worldline notification unified
Legacy runtime cleaned
Host-neutral deployment ready
Operation Skuld: READY
Mac mini cutover: NOT EXECUTED
```

然后等待新 Mac mini 到位，再单独执行 `OPERATION_SKULD_MAC_MINI_MIGRATION_RUNBOOK.md`。
