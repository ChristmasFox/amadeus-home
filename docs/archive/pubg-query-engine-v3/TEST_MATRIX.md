# PUBG Query Engine V3.2 — Test Matrix

## 1. Automated Test Commands

```text
cd /Users/blacksidev/pubg-query-engine-v3
pnpm run typecheck
pnpm run build
pnpm test
cd /Users/blacksidev/docs/pubg-query-engine-v3/v3.1-snapshot-20260903/pubg-langbot-plugin-v3 && python3 -m unittest discover -s tests
```

最近一次源码验证：

- TypeScript typecheck：PASS
- TypeScript build：PASS
- TypeScript tests：`63/63 PASS`
- Python platform adapter tests：`6/6 PASS`

测试使用脱敏 fixture；Query Engine、ReviewSubgraph、Time Resolver、Context、Coverage 和 Telemetry detectors 不依赖真实 PUBG API。

## 2. V3 Regression Matrix

| ID | 场景 | 预期 | 状态 |
| --- | --- | --- | --- |
| V3-01 | 今日/昨日/前天/上周六 | 正确 business-day boundary | PASS |
| V3-02 | 具体日期/具体小时 | 显式日期与时段优先 | PASS |
| V3-03 | 默认报告 | 四人、KD 降序、全部玩家卡片 | PASS |
| V3-04 | strongest/weakest/拉完了 | Performance Score/Chicken Index deterministic | PASS |
| V3-05 | KD/伤害/击杀/助攻排名 | metric 不混淆 | PASS |
| V3-06 | 最近 20 场 | team participated matches，稳定排序 | PASS |
| V3-07 | 昨天 vs 前天 | 两个 selector segments 与差值 | PASS |
| V3-08 | 最近 7 天趋势 | daily series 与 change | PASS |
| V3-09 | ResultSet follow-up | 复用 Match IDs，不重复事实计算 | PASS |
| V3-10 | coverage/source failure | NO_MATCHES、COVERAGE_GAP、STALE、SOURCE_UNAVAILABLE 区分 | PASS |
| V3-11 | `今日战绩` | 只走 QuerySubgraph，不触发 Telemetry | PASS |
| V3-12 | `昨天谁最强` | 只走 QuerySubgraph，不触发 Telemetry | PASS |

## 3. V3.2 Review Matrix

| ID | 场景 | 预期 | 状态 |
| --- | --- | --- | --- |
| R01 | `帮我复盘今天` | `review_match` + Match Picker，多局不擅自选择 | PASS |
| R02 | `复盘今天最后一把` | `latest`，唯一比赛后才读取 Telemetry | PASS |
| R03 | `复盘刚才那把` | `latest recent` | PASS |
| R04 | `复盘昨天第三把` | stable ASC ordinal | PASS |
| R05 | `复盘昨天吃鸡那把` | `filtered(placement=1)` | PASS |
| R06 | `复盘今天伤害最高那把` | `rank(teamDamage DESC)` | PASS |
| R07 | Match Picker | 只显示时间/地图/排名、玩家基础数据和 team totals | PASS |
| R08 | Picker path | 不触发 Telemetry downloader | PASS |
| R09 | Telegram callback | short token、same chat、未过期、deterministic match ID | PASS |
| R10 | active follow-up | `这把谁最C`、指定玩家、`火箭筒呢`、`开车呢`、`最后团呢` | PASS |
| R11 | previous/next | 上一把/下一把基于 active ordinal | PASS |
| R12 | cache HIT | 不重复下载；ordinal 可重新绑定 | PASS |
| R13 | cache storage | 不持久化 normalized event stream，保留 derived facts/evidence | PASS |
| R14 | telemetry failure | 基础 Match Summary + `REVIEW_PARTIAL`，不伪装成没有比赛 | PASS |
| R15 | fight detector | 聚合 2~3 个重要团战，保留 evidence | PASS |
| R16 | key operations | 每名玩家 0~3 条，operation evidence-backed | PASS |
| R17 | vehicle | ride/drive/distance/speed/damage/destroy，缺数据不显示 | PASS |
| R18 | heavy weapon | 通用 stats，Panzerfaust pickup/shots/hits/kills | PASS |
| R19 | rocket unused/miss | `ROCKET_UNUSED`；无命中不产生 `ROCKET_HIT` | PASS |
| R20 | rocket causal multi-kill | 需要 attack/vehicle/kill 关联；时间接近不足以判定 | PASS |
| R21 | presentation | Sections → Platform Renderer，玩家 card 不跨 section 拼接 | PASS |
| R22 | message length | Telegram/KOOK 按 section 合理拆分 | PASS |

## 4. V3.1 Platform Regression

| 场景 | 预期 | 状态 |
| --- | --- | --- |
| Telegram normal/group adapter | normalized contract、sender/chat 正确 | PASS（fixture） |
| KOOK normal/private/group adapter | normalized contract、无 raw platform fields | PASS（fixture） |
| sender isolation | 同群不同 sender 不共享 Context/ResultSet | PASS |
| Platform Renderer | Telegram buttons、KOOK text、长度边界 | PASS（fixture） |
| Tool / `/pubg` | 继续调用同一 Runtime | PASS（静态/运行检查） |
| Python plugin tests | adapter/registry 4 cases | PASS |

## 5. Live Runtime Checks

已完成：

- `GET http://127.0.0.1:5310/healthz`：HTTP 200，`review: v3.2`，container `healthy`。
- Ubuntu CasaOS image：`local/pubg-query-engine-v3:3.2.2-accuracy`，health `healthy`。
- n8n Data Gateway/Sync v3 active，历史 Query 与 today freshness 检查保持原行为。
- V3.2 Picker、callback、direct review、HIT、active follow-up、previous/next、REVIEW_PARTIAL fixture 均通过。
- Feature Store 已从 `45,596,728` bytes 压缩到当前 `2,499,450` bytes；原始大文件和旧版本记录均保留备份。
- Telegram Bot API 配置有效，bot 为 `Arthur_amadeus_bot`；KOOK `user/me`、`gateway/index`、WebSocket HELLO 有效。

Accuracy patch real Match `ccc10bbc-a496-4907-b1a3-d9f4f004ca25`：parser-3 命中后 3 fights、最长 `76.517s`、6 team kills、8 team DBNOs、`842.958` team damage，integrity `PASS`；诊断记录 `candidateCombatEvents=8866`、`trackedRelevantEvents=70`、`ignoredGlobalEvents=8796`。回复不含 `42杀`、`43倒地`、`00:00`，并将未确认座位语义渲染为“乘车”。

## 6. External Smoke-Test Boundary

真实 Telegram/KOOK 非 Bot 入站消息和客户端实际显示仍未产生可审计事件。Bot 自发消息不能替代真人入站，因为平台会忽略/标记 Bot 自己的消息。

最小外部验证：

1. Telegram 目标群由非 Bot 成员发送 `帮我复盘今天`，点击一个按钮，再发送 `这把谁最C`。
2. KOOK 目标群由非 Bot 成员发送 `昨天战绩`，再发送 `哪一把伤害最高`。
3. 检查单次回复、Picker 显示、ResultSet follow-up、sender isolation 和桌面/移动端显示。

当前状态：`BLOCKER_EXTERNAL`。
