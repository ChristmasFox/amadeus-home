# PUBG Intelligence Lab R0 数据审计

审计日期：2026-10-16（Asia/Shanghai）
数据来源：Gate 与 Lab 隔离环境中的 Lab SQLite：`/DATA/AppData/openclaw/data/pubg.sqlite`
审计范围：`packages/pubg-domain` 的 Match Store、Telemetry 特征缓存、解析器与证据完整性。

## 访问方法

审计先在 OrbStack `nyannyan` Lab machine 上以 SQLite `mode=ro` 打开生产数据库，再通过 SQLite backup API 生成 `/tmp` 快照。完整性、计数和结构检查均在该快照上完成。生产数据库未执行迁移、DDL、DML、Telemetry 下载或缓存回写；临时快照没有加入 Git。

报告只保留聚合计数，不包含玩家名称、账号 ID、Telemetry URL、手机号或凭据。

## 完整性与覆盖范围

| 检查项 | 结果 |
| --- | ---: |
| `PRAGMA integrity_check` | `ok` |
| `PRAGMA foreign_key_check` 违规 | 0 |
| 比赛行 | 534 |
| 时间范围（UTC） | 2026-08-17 至 2026-10-15 |
| 缺少 `created_at` | 0 |
| 非正比赛时长 | 0 |
| 队员战绩行 | 1,463 |
| 匹配不到父比赛的队员行 | 0 |
| 负数战绩行 | 0 |
| 无排名或非正排名行 | 0 |
| 比赛内队员排名不一致 | 3 场 |
| 不同账号数（仅计数） | 4 |
| 单场队员数范围 | 1–4 |
| 四名队员均有记录的比赛 | 124 |

比赛主键与 `(match_id, account_id)` 复合主键提供了去重约束。匹配层有 404 场 schema v3 与 130 场 schema v2；领域归一化代码仍为 v2 兼容数据补充默认字段。1,290 条死亡数使用 `placement_proxy` 语义，另 173 条为显式死亡语义；未知死亡语义为 0。分析输出应继续展示这个语义差异，不能把代理值说成 PUBG API 的原始死亡计数。

有 3 场中不同队员行记录了互相冲突的排名。R0 的吃鸡率/前十率只用排名一致且已知的比赛作为分母；冲突比赛显示“排名未知”，不取最小排名来猜队伍名次。

## Telemetry 缓存与解析器

当前领域版本为 `telemetry-parser-6` / `review-features-6`。

| 缓存项 | 比赛数 / 行数 |
| --- | ---: |
| 任意 parser/feature 版本有缓存 | 307 场 |
| 当前 v6 特征缓存 | 274 场（51.3%） |
| 仅有旧版缓存 | 33 场 |
| 完全没有特征缓存 | 227 场 |
| 当前版本缺少缓存 | 260 场 |
| Match Store 中有 Telemetry URL | 384 场 |
| Match Store 中无 Telemetry URL | 150 场 |

缓存共 317 行：parser/feature v1 为 3 行、v2 为 2 行、v3 为 9 行、v4 为 17 行、v5 为 12 行、v6 为 274 行。R0 只读取 v6；不把旧版本缓存混入当前解析口径，也不会尝试补抓缺失的 Telemetry。

特征 JSON 检查结果：格式错误 0 行、结构错误 0 行、缓存行与内部比赛 ID 不匹配 0 行、无证据项 0 行。缓存中没有保留 `combat.events` 原始标准化事件流，这是 `compactReviewFactsForFeatureStore` 的预期行为：持久化派生事实和证据引用，移除体积较大的事件数组。因此当前缓存适合浏览既有复盘事实，不适合对任意原始事件重新解析或做逐事件取证。

### 解析器行为核对

- `parseTelemetryPayload` 支持 JSON 字符串、gzip 字节和 `events` / `data` / `telemetry` 数组外壳。
- `normalizeTelemetryEvents` 将已识别的攻击、伤害、击倒、击杀、救援、物品、治疗、护甲、载具、环境互动、翻越和位置事件归一化；未识别类型会被跳过。
- 事件时间优先使用相对比赛时间或明确的游戏时钟；`common.isGame` 作为阶段信号，证据不足时保留 `unknown`。代码不会把不可靠的零值伪造成 `00:00`。
- Match Store 归一化保留死亡语义。缺失死亡字段时，排名代理值明确标为 `placement_proxy`。
- Telemetry 解析及复盘分析位于 Domain 层；本地实验页调用已有 `analyzeMatchReview`，新增的跨局聚合位于 `packages/pubg-intelligence`。

## R0 使用边界与遗留问题

1. 当前 v6 Telemetry 覆盖 51.3%。未命中当前缓存的比赛仍可用于 Match Store 战绩统计，但不能据此推断“没有事件”或生成事件级结论。
2. 33 场只留有旧版本特征缓存；R0 明确将它们显示为缺少当前缓存。若之后需要比较 parser 版本，应另做离线迁移/回填计划和独立结果库。
3. 130 场 match schema v2 数据仍可读，但需要持续保留兼容性回归测试。
4. 持久化特征不包含原始事件流；若研究问题必须重跑解析器，需要单独授权的 Telemetry 来源与可恢复离线副本。
5. 对 R0 查询来说，基础战绩完整性检查通过；尚未用原始 Telemetry 重新执行 v6 全量解析验证，因为该动作会引入外部抓取或缓存写入，不属于本次只读审计。

本次实现的实验页在打开 SQLite 时使用 `readOnly: true`，仅绑定 `127.0.0.1`；研究输出写入用户本地的独立 `experiments.sqlite`，与 Lab 的生产数据库分开。
