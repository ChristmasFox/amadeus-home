# PUBG 复盘五块模板收敛（IMPLEMENTED / READY TO DEPLOY：2026-09-11）

- [x] 默认完整复盘收敛为 `overview / players / interactions / loot / closing` 五类展示块；四名队员仍各自保留一张点评卡。
- [x] 武器/开火、道具/恢复、载具、趣味事件和关键团战不再单独成栏；重要事实并入队员点评或环境/奖项总结。
- [x] 垃圾佬榜保留简版拾取、丢弃、车厢和外观计数；队内伤害账本、近战明细、环境数据和未参赛玩家 `-` 未改。
- [x] 默认模板定向回归 38 pass；待全量验证、提交 push、构建部署和指定比赛 smoke。

# PUBG 复盘点评移动端排版（IMPLEMENTED / DEPLOYED / VERIFIED：2026-09-11）

- [x] 仅在队员卡片的 `💬 点评` 展示边界增加移动端换行：优先按句号、问号、分号、逗号等标点断行，过长片段按 28 个字符兜底。
- [x] 点评原文、事实证据、近战账本、垃圾佬榜、环境破坏和未参赛玩家 `-` 均保持不变；短点评不被强行拆碎。
- [x] 新增回归断言，确认长点评实际换行且单行不超过 28 个字符；agent-runtime 全量测试 130 pass / 1 skip、typecheck、secret scan、diff check 已通过。
- [x] `ec1147b` 已提交并 push；CasaOS `ubuntu` 已激活不可变镜像 `local/pubg-query-engine-v3:git-ec1147b196aa`，回滚 compose 备份为 `/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260911-135154`。
- [x] `/healthz`、`/homehub/health` 和 `scripts/doctor.sh` 通过；指定比赛 `c2aea5a9-a86a-4f7b-b0a5-3d032541922d` 返回 `OK`，点评长文本已分行，`SG_LabmemNo008` 仍显示 `-`，近战/垃圾佬榜/环境破坏章节均保留。

# Telegram 插件 loading 与复盘垃圾佬榜收敛（IMPLEMENTED / DEPLOYED / VERIFIED：2026-09-11）

- [x] 为 PUBG V3/V2、Product Radar、Organize Emby 的长任务增加统一 `type=loading` 占位协议；Telegram 宿主收到后发送 `Thinking...`，最终正文编辑回同一条消息，普通最终回复和失败回复行为保持不变。
- [x] Telegram patch 在 picker patch 之后再次应用 loading 生命周期，避免 picker 的 `reply_message` 重写覆盖占位替换逻辑；补充 marker、替换分支和宿主源码 `py_compile` 校验。
- [x] 垃圾佬榜只保留拾取、丢弃、搜包、车厢存取和显式皮肤/服装计数；底层 `loot / lootActivity / vehicleTrunk` 数据与其他复盘章节不变，不再展开分类、特殊物资和逐条车厢流水。
- [x] 定向验证：LangBot patch 5/5、PUBG V3 plugin 14/14、agent-runtime 130 pass / 1 skip、Python/shell syntax、secret scan、diff check 均通过；容器内 typed loading 替换 smoke 通过，`scripts/doctor.sh` 为 0 failure / 0 warning。
- [x] source commit `941eb10` 已提交并 push；CasaOS `ubuntu` 已激活 `local/langbot-agent:941eb1089250-20260911-130202`，compose 回滚备份为 `/var/lib/casaos/apps/langbot/docker-compose.yml.codex-backup.20260911-130206`。
- [x] LangBot API 安装已就绪：PUBG V3 `3.3.1` task `12`、Product Radar `0.5.4` task `13`、Organize Emby `0.2.1` task `14` 均为 `INSTALL_READY`；未发送真实 Telegram/KOOK 消息，实际平台 inbound smoke 仍由用户触发。

# PUBG 对局复盘近战与战斗点评升级（IMPLEMENTED / DEPLOYED / VERIFIED：2026-09-11）

- [x] 近战解析优先采用 `Damage_Kick` / `Damage_Punch` 明确分类，按攻击方向合并展示脚/拳/其他近战；保留原始事件证据并输出命中数对账。
- [x] 队员卡片对 `not_recorded` 玩家只显示 `-`；记录玩家的点评串联武器命中、倒地转化、道具、恢复、载具、环境和队友误伤，保留证据边界，不凭皮肤结算字段推断拾取。
- [x] 增加垃圾佬物资搬运统计（原始拾取、丢弃、搜包、类别、显式皮肤/服装拾取）和环境破坏对象明细；只有遥测明确命名地形动作时才显示挖坑/地形动作。
- [x] 增加确定性本局奖项与更长的锐评；未改动真实平台消息发送逻辑。
- [x] 修复缺席玩家进入趣味榜和锐评重复展示的问题，并补充武器/护甲显示与回归断言。
- [x] 定向回归 18/18、根测试 130 pass / 1 skip、typecheck、secret scan、diff check 已通过；详见 `.agent/checkpoints/2026-09-11-pubg-review-v2-implementation.md`。
- [x] `971d4eb`、`f76d4a4`、`20c4b1f` 已提交并 push；immutable image `local/pubg-query-engine-v3:git-20c4b1f9bbaf` 已在 CasaOS `ubuntu` 激活，parser/feature 为 v6。
- [x] 指定比赛 `c2aea5a9-a86a-4f7b-b0a5-3d032541922d` live smoke 返回 `OK`：近战账本 `13/13`、友伤 `202.05`、缺席玩家 `-`、垃圾佬榜、环境破坏和护甲文案均核验通过；`/healthz` 与 `/homehub/health` healthy。
- [x] 最新镜像回滚配置备份：`/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260911-123456`；未发送真实 Telegram/KOOK 消息。

# Product Radar autonomous E2E acceptance & production repair（DEPLOYED / VERIFIED：2026-09-09）

## KOOK LangBot offline auto-recovery（IMPLEMENTED / DEPLOYED / VERIFIED：2026-09-10）

- [x] 复盘确认：重启前 KOOK `/api/v3/user/me` 为 HTTP 200、API code 0 但 `online=false`；LangBot 与 plugin runtime 仍 running，主日志没有对应 KOOK reconnect 记录；重启 LangBot 后连续探测恢复 `online=true`。具体底层 gateway 异常没有足够证据归结为单一原因。
- [x] 新增独立 `scripts/kook_watchdog.py`：每分钟由 systemd 触发，连续 3 次明确离线且 `langbot` 仍 running 才允许 `docker compose restart langbot`；15 分钟 cooldown，6 小时最多 3 次。
- [x] 增加 `KOOK_CONNECTION_DEGRADED`、`KOOK_AUTO_RESTART_REQUESTED/STARTED/FAILED`、`KOOK_CONNECTION_RECOVERED`、凭据/API/网络不可达、容器状态和重试耗尽等结构化 journal 事件；token 不进入 Git、日志或状态文件。
- [x] 已部署到 OrbStack `ubuntu`：`kook-watchdog.service` 与 `kook-watchdog.timer` 安装为 root-owned unit，timer 为 `enabled/active`；状态文件为 0600，监控器立即运行成功。
- [x] 部署后 live probe 返回 KOOK `online=true`、HTTP 200；LangBot 仍 running、restart count 为 0，未被 watchdog 额外重启；未构建镜像、未修改 LangBot Compose。
- [x] watchdog 6/6、根测试 129 pass / 1 skip、Python/shell syntax、`pnpm check:secrets`、`pnpm workflow:plan`、`git diff --check` 通过；checkpoint 为 `.agent/checkpoints/2026-09-10-kook-watchdog.md`。
- [ ] 未通过人为断网、改 token 或 kill 容器强制注入故障；当前验证覆盖正常探测、状态持久化、限频决策和线上安装，未宣称真实离线重启动作已被强制触发。

- [x] 确认并修复高结果量 Bunjang 首扫永久 `WATERMARK_NOT_REACHED` 的停滞路径：首扫达到安全上限时安全建立静默 watermark；后续由进程内 30 秒 scheduler 按 interval/jitter/backoff 主动执行，changedetection 动态页面无文本 diff 不再让监控永久停摆。
- [x] 修复 feed webhook 公共响应泄漏内部 `Map` 导致 `perWatch={}` 的误导性观测；runtime 统计仍在 SQLite 内按 Watch 正确结算，并补充失败后退避到期恢复 `HEALTHY` 的回归测试。
- [x] 真实 Bunjang smoke：seller baseline 5、product baseline 1、两者 baseline notification 0；similarity 真实参考商品 `424506121`，抓取 60 个候选，阈值 0.60。
- [x] 生产隔离 E2E Watch 通过 API-key 保护的 `e2e-test-*` listing injection 进入真实 `ListingDiscoveredEvent → feed router → ImageMatcher → SimilarListingMatchedEvent → outbox/notifications` 链路：正例 score 1.0、负例 score 0.045 未匹配、重复正例 duplicate 且无新增事件/通知；Telegram 与 KOOK 各 1 条 outbox 最终 sent。
- [x] 真实 changedetection UUID/URL/900 秒间隔映射核验通过；webhook 触发 Bunjang 真实抓取 1 页/5 条，无误报。E2E Watch、feed、sensor、listing、event、outbox 和 test run 记录均已清理，现有真实 Watch 未被删除或修改。
- [x] 线上最终状态：真实 Watch 1 条；`패딩`、`다운 자켓` 两条 shared feed 均 `ACTIVE`，最近执行成功、失败 0、watermark 存在；Watch runtime `HEALTHY`，`feedRuns=6 / successfulRuns=6 / failedRuns=0`，`newListings=81 / candidatesProcessed=81 / imageComparisons=81 / aboveThreshold=0 / notificationsSent=0`。
- [x] Product Radar 48/48、typecheck/build、LangBot plugin 33/33、真实 Bunjang smoke、`pnpm check:secrets`、`git diff --check`、`scripts/doctor.sh`（0 failure / 0 warning）通过。
- [x] source commit `ab91542` 已 push 到 `origin/main`；immutable image `local/product-radar:git-ab91542`（image id `sha256:bd09352adb493217bd6e89403629176546ba841e19e71e51d293823a35c41551`）已在 CasaOS `ubuntu` 激活；回滚备份为 `/var/lib/casaos/apps/product-radar/docker-compose.yml.codex-backup.20260909-165853` 与 `/var/lib/casaos/apps/product-radar/.env.codex-backup.20260909-165853`。

# Current Task

## Product Radar stalled similarity feed recovery（DEPLOYED / VERIFIED：2026-09-09）

- [x] 定位线上根因：Bunjang 高结果量搜索在首次扫描触及安全页数/条数上限时被永久标记为 `WATERMARK_NOT_REACHED`；而 changedetection 对动态搜索页提取不到文本，未发 webhook，导致两天没有后续 Product Radar 执行。
- [x] 首次有上限的扫描现在安全建立静默 baseline：保存最新 listing watermark、绝不把历史候选当作新上架或发通知；后续扫描以该 watermark 增量处理。
- [x] Product Radar 新增进程内 similarity Feed scheduler（默认每 30 秒评估 due Feed，实际按每条 Feed 的 interval/jitter/backoff 执行），因此 Bunjang 轮询不再依赖 changedetection 是否检测到网页文本变化；保留 changedetection 作为兼容触发器。
- [x] baseline 与后续 Feed 执行都会写入 Watch runtime stats；修复后 `feedRuns/successfulRuns/failedRuns` 不会再与 Feed 明细脱节。
- [x] 本地验证：Product Radar 47/47、typecheck、build、`pnpm workflow:plan`、`pnpm check:secrets`、`git diff --check` 通过。
- [x] source commit `58a5305` 已 push；immutable image `local/product-radar:git-58a5305f94e6` 已在 CasaOS 激活，image digest `sha256:3b51f6efb4ade8a4b359229ebf06af8816bcd0936cb7d554f2203e4eab55061f`，回滚备份为 `/var/lib/casaos/apps/product-radar/docker-compose.yml.codex-backup.20260909-163000` 与 `/var/lib/casaos/apps/product-radar/.env.codex-backup.20260909-163000`。
- [x] 线上验证：现有 Similarity Watch 已自动完成两个静默 baseline，`feedRuns=2 / successfulRuns=2 / failedRuns=0`；`패딩` 与 `다운 자켓` Feed 均为 `ACTIVE`、各有 watermark 和 1 次成功运行。Product Radar healthy/running、`/health=ok`，`scripts/doctor.sh` 为 0 failure / 0 warning；未创建、删除或修改 Watch，未发送手工通知。

## Product Radar rich status presentation（DEPLOYED / VERIFIED：2026-09-09）

- [x] 状态查询与统计查询统一输出完整监控详情：状态、类型、运行时长、上次/下次检查、检查成功/失败、新商品、候选处理、图片对比、达到阈值、最高相似度、通知与 Token 使用。
- [x] 时间不再直接显示秒数；运行时长及相对上/下次检查统一按 `天 / 小时 / 分钟 / 秒` 显示。
- [x] 每个 SearchFeed 展开其状态、检查/成功/失败次数和最后错误；因此 `DEGRADED` 可直接看到数据源原因，避免被误读为“没有监控”。
- [x] 新增纯展示模块回归：人类可读时长、相对时间、完整统计字段和 Feed 错误；LangBot plugin tests 33/33、Python compile、`pnpm workflow:plan`、`git diff --check`、`pnpm check:secrets` 全部通过。
- [x] source commit `71183b9` 已 push 到 `origin/main`；`scripts/deploy-langbot.sh --plugin product-radar --apply` 安装 plugin `0.5.3`，task `111` 达到 `INSTALL_READY`，package SHA-256 为 `44e49a6a4ca163d0ae04d2000265c8fa79a189a9616b22a858b6405582fcea05`，rollback dir 为 `.backups/langbot/20260909-161810`。
- [x] 部署后 `scripts/doctor.sh` 为 0 failure / 0 warning；Product Radar `/health` 为 `ok`，Product Radar healthy/running，LangBot 与 plugin runtime running；未重建 Product Radar image，未创建、删除或修改真实 Watch。
- [ ] 待用户在 Telegram 发送“监控的怎么样了”或“1号监控的记录”完成真实入站与渲染 smoke。

## Product Radar V0.3.1 Runtime Observability（DEPLOYED / VERIFIED：2026-09-09）

- [x] SQLite additive migration：Watch runtime counters/history、SearchFeed health counters/backoff、AI usage ledger、heartbeat delivery idempotency、ownership-aware persisted context；旧数据库通过 `ensureColumn` 兼容，未删除既有数据。
- [x] 真执行统计：feed/poll 成功/失败、候选/新商品、Sharp image comparisons、above-threshold、best score、实际成功通知数和最后错误；0 匹配保持 HEALTHY。
- [x] API：`GET /api/watches/:id/status`、`/stats`、`/usage`，`POST /api/usage` 与上下文绑定接口；状态覆盖 HEALTHY/DEGRADED/PAUSED/ERROR、last/next run、Feed health、token summary。
- [x] GPT-5.6 Luna structured NLU 增加 status/stats 语义与 usage extraction；创建、修改、状态查询、统计查询均按 Watch 记账，轮询/Sharp 不调用 LLM；取消监控在插件重载后恢复同一 ownership context，多目标继续澄清。
- [x] Similarity Watch 默认 24h heartbeat digest：无匹配也发送，period/channel/recipient 幂等，Telegram/KOOK 独立失败重试；增加 fake-clock、restart、API、paraphrase/negative routing tests。
- [x] 本地验证：Product Radar 46/46、typecheck/build、LangBot 23/23、Python compile、secret scan、`git diff --check` 通过；根测试 129 pass / 1 skip。
- [x] RELEASE：source commit `a446838fc992` 已 push；Host BuildKit immutable image `local/product-radar:git-a446838fc992` 已导入并以 CasaOS `docker compose up -d --no-build` 激活，digest 为 `sha256:933c98b5b184b655517735d3677762a420c06c86cf4eda85d6848018eeb5f4c8`。
- [x] LangBot Product Radar plugin `0.5.0` 已通过 API 安装，task `97` 达到 `INSTALL_READY`，package SHA-256 为 `17ee72dadfe014715f47863e8e086eeb85f8b6fb00e4d885ad4adc7d0a81bc04`，rollback dir 为 `.backups/langbot/20260909-144208`。
- [x] live 核验：Product Radar、changedetection `0.60.3` 和 LangBot/plugin runtime 均 running/healthy；`/health=status=ok`，3 个既有 Watch、2 个 SearchFeed 和 2663 条 listing 保持；历史 4 条 `search_feed_runs` 已回填为每个旧 Feed 2 次运行、0 次成功、2 次连续失败、`WATERMARK_NOT_REACHED`；未创建/删除真实 Watch，未发送手工通知。
- [x] 本次 CasaOS 回滚备份为 `/var/lib/casaos/apps/product-radar/docker-compose.yml.codex-backup.20260909-144144` 与 `/var/lib/casaos/apps/product-radar/.env.codex-backup.20260909-144144`；`scripts/doctor.sh` 为 0 failure / 0 warning。

## Product Radar numbered watch selection UX（DEPLOYED / VERIFIED：2026-09-09）

- [x] `list_watches` 统一为当前返回顺序的 `1号 / 2号 / 3号` 展示，并按 `platform + chat + sender + domain` 保存最近一次列表序号映射。
- [x] 单独说“取消监控”进入选择流程：Telegram 返回每条监控对应的 `取消1号`、`取消2号` 等 inline buttons；无按钮平台显示同样的编号和文字指引。
- [x] 点击按钮或发送“取消1号 / 取消第2个”均转为结构化 `delete_watch + watchOrdinal`，删除后自动返回新的编号监控列表；“查看1号 / 第2个监控的记录”复用同一序号上下文。
- [x] 序号解析受当前 Product Radar context 约束，无列表上下文时不把“取消1号”强行路由为 Product Radar；按钮回调校验所属调用者的列表映射，避免群聊成员串用。
- [x] LangBot plugin tests 29/29、Python compile、`git diff --check`、`pnpm check:secrets` 已通过；未修改 Product Radar 数据库中的真实 Watch。
- [x] source commit `0de93ca` 已 push 到 `origin/main`；`scripts/deploy-langbot.sh --plugin product-radar --apply` 安装 plugin `0.5.1`，task `102` 达到 `INSTALL_READY`，package SHA-256 为 `ebcb43cd290b7634727be8ac3bc3ca21c38dbf7c07780ac63b06a1736a34fa5f`，rollback dir 为 `.backups/langbot/20260909-152749`。
- [x] 部署后 `scripts/doctor.sh` 为 0 failure / 0 warning；Product Radar、changedetection、LangBot/plugin runtime 均 running/healthy，Product Radar `/health` 为 `ok`，API 仍为既有 3 个 Watch；未重建 Product Radar runtime image。
- [ ] 尚未发送真实 Telegram/KOOK 测试消息；需用户在目标会话发送“我现在盯着什么”或“取消监控”完成最终平台入站 smoke。

## Product Radar status query fallback（DEPLOYED / VERIFIED：2026-09-09）

- [x] 定位 16:01 线上问题：`监控的怎么样了` 已到达 LangBot，但 Product Radar Luna intent call 报 `ActionCallError`；插件返回未处理后由普通聊天接管，产生了“不准确的监控已取消”回复。
- [x] 增加受明确 Product Radar 语义约束的离线状态 fallback；`监控的怎么样了` 等表达直接进入 `get_watch_status`，不再落入普通聊天。
- [x] 无明确序号时，单条监控展示真实 status；多条监控汇总每条状态；Feed `lastError` 会随状态展示，便于区分启用但 DEGRADED 与已取消。
- [x] 线上只读核验：当前 API 有 1 条 enabled Similarity Watch，状态为 `DEGRADED`，两个 Feed 均为 `WATERMARK_NOT_REACHED`；未修改监控数据。
- [x] LangBot plugin tests 31/31、Python compile、`git diff --check`、`pnpm workflow:plan` 已通过。
- [x] source commit `00e6889` 已 push 到 `origin/main`；`scripts/deploy-langbot.sh --plugin product-radar --apply` 安装 plugin `0.5.2`，task `109` 达到 `INSTALL_READY`，package SHA-256 为 `3105e395b73344cea48dd78294f917200083ccafa9bdbd5a77fab69ecd3b0912`，rollback dir 为 `.backups/langbot/20260909-160922`。
- [x] 部署后 `scripts/doctor.sh` 为 0 failure / 0 warning；LangBot/plugin runtime、Product Radar 和 changedetection 均 running/healthy，Product Radar `/health` 为 `ok`，API 仍为 1 条 enabled Watch；未重建 Product Radar runtime image。
- [ ] 尚未发送真实 Telegram/KOOK 测试消息；需用户发送“监控的怎么样了”完成最终平台入站 smoke。

## Product Radar cancellation routing fix（DEPLOYED / VERIFIED：2026-09-09）

- [x] 修复 `取消监控` 被错误当成“取消待确认 proposal”的问题：有 pending proposal 时取消 proposal；已有当前 Watch 时转为真正的 `delete_watch`；没有唯一 active context 时要求指定目标，不再回复成功但保留 Watch。
- [x] 离线 fallback 补充 `不要盯着了`、`不要再盯了`、`不想盯了` 对当前 active Watch 的删除映射；保留 Luna structured intent 作为主语义入口。
- [x] LangBot plugin tests 19/19、Python compile、secret scan、`git diff --check` 通过；source commit `bc8d140220a8` 已 push，plugin task `89` 达到 `INSTALL_READY`，live manifest `0.4.1`。
- [x] 部署后 Product Radar 与 changedetection 仍 healthy，`/health` 为 `ok`，既有 3 个 Watch 未被验证过程修改；未发送真实 Telegram/KOOK 消息。
- [ ] 待用户在原 Telegram 会话再次发送 `取消监控` 或 `不要盯着了` 完成人工入站 smoke；若当前会话 active context 已过期，需指定商品 URL 或 Watch ID。

## Product Radar V0.3 Phase A hardening（DEPLOYED / VERIFIED：2026-09-09）

- [x] 保持 `NormalizedBotMessage → Domain/Intent → structured entities → Context → deterministic Domain` 边界；新增 `TargetProfile.userSearchTerms`，用户搜索词与视觉/OCR 词分离并在 planner 中优先。
- [x] Bunjang `SourceSearchPlanner` 现在保留 explicit/user terms，并在最多 4 条查询内按 specific/medium/broad 分层；支持 modelName，类别存在时保证 broad coverage，不使用永久 `의류` fallback。
- [x] shared SearchFeed 扫描改为先抓取/解析、成功后事务写入；分页 timeout、4xx/5xx、解析失败或安全上限不会写入部分候选、创建通知或推进 watermark；Retry-After 与确定性 backoff、共享 sensor cleanup 已补齐。
- [x] similarity preview 显示实际阈值与 Sharp perceptual matcher；LangBot plugin source 升至 `0.4.1`，仍由 GPT-5.6 Luna 完成单次 multimodal structured parsing。
- [x] 验证通过：Product Radar TypeScript 42/42、typecheck/build、LangBot Python 16/16、Python compile、`pnpm check:secrets`、`pnpm workflow:plan`、`git diff --check`。
- [x] source commit `0cdba7c37a6a09a0740eedabd17b9adabb511682` 已 push 到 `origin/main`；immutable image `local/product-radar:git-0cdba7c37a6a` 已导入 OrbStack `ubuntu`，digest 为 `sha256:ef5c7309eae244cd6c9c2ef9d566f4f4e7a27f9d72474a93bde355dd3f1bb7db`。
- [x] CasaOS Product Radar 已通过外部 `.env` 切换到新 image 并以 `docker compose up -d --no-build` recreate；远端备份为 `.codex-backup.20260909-114724` / `.env.codex-backup.20260909-114724`，changedetection `0.60.3` 与持久化 datastore 未变更。
- [x] LangBot Product Radar plugin `0.4.1` 已安装并达到 `INSTALL_READY`（task `84`，package SHA-256 `09d0783fbe072999bf0b8f10a48c9b09adbcb6fc8f73e881cfa08ea7c33c90f3`，rollback dir `.backups/langbot/20260909-114754`）。
- [x] live 核验通过：Product Radar 与 changedetection healthy，`/health` 为 `status=ok`，既有 3 个 Watch（1 Product、2 Similarity）保持不变，database watches/feed/listings 计数保持，`scripts/doctor.sh` 为 0 failure / 0 warning。
- [ ] 未发送真实 Telegram/KOOK 消息；人工平台入站 smoke 仍需用户在目标会话中完成，因此不宣称真实平台送达已验证。

## Product Radar Generic Natural Language Intent Parsing（DEPLOYED / VERIFIED：2026-09-09）

- [x] 先对照 PUBG V3 已工作的 `NormalizedBotMessage → Domain/Intent → structured entities → Context → deterministic Domain` 链路，在 Product Radar 内建立独立、平台无关的 normalized message / context / command boundary；未导入 PUBG-specific parser 或 intent。
- [x] Product Radar structured command 已固定 `domain=product_radar`、七种 watch intent、`similarity/seller/product` 三种 `watchType`，并覆盖 source、URL、reference image、TargetProfile 字段、搜索词、价格、货币、频率和相似度阈值。
- [x] GPT-5.6 Luna 负责自然语言语义解析；有图片时同一次 multimodal structured call 同时返回 Product Radar intent/entities 与 TargetProfile，listener 不再追加 Vision 调用；明确文本字段在归一化层覆盖冲突的视觉字段。
- [x] Product Radar Core 只接收 structured command 适配后的 payload；similarity 的完整 TargetProfile 通过 API 顶层字段传入，避免 Core 重新执行自然语言或 Vision 提取。
- [x] Context 绑定 `product_radar + platform + chat type/id + platform user id`；pending proposal 与 active Watch 均按该 key 校验，群聊成员不能继承他人的 context。
- [x] 图片单独发送不会触发 Product Radar；补充 7 种自然表达的 paraphrase tests、图片问答 negative routing tests、图片-only、Telegram sender/chat 归一化、context 隔离和三类 payload tests；LangBot Python tests 16/16、Python compile、secret scan、plugin dry-run、`git diff --check` 已通过。
- [x] commit `9888e3c58ca5b8cd4fb37b202fb4abc0a3f70bf2` 已 push 到 `origin/main`；通过 `scripts/deploy-langbot.sh --plugin product-radar --apply` 安装 Product Radar `0.4.0`，LangBot task `83` 达到 `INSTALL_READY`，package SHA-256 为 `7ed45be07f37c9911b50c0bdac8087bb883de0876a1c20108b4826047e34cfc9`，rollback dir 为 `.backups/langbot/20260909-111116`。
- [x] live 核验通过：OrbStack `ubuntu` 的 `product-radar` 为 `healthy/running`，LangBot 与 plugin runtime running；Product Radar `/health` 返回 `status=ok`，`GET /api/watches` 返回既有 3 个 Watch（1 Product、2 Similarity），未创建或修改测试 Watch；`scripts/doctor.sh` 为 0 failure / 0 warning。
- [ ] 未发送真实 Telegram/KOOK 消息；人工平台入站 smoke 仍需用户在目标会话中完成，因此不宣称真实平台送达已验证。


## Product Radar Language Intent Planner（DEPLOYED / VERIFIED：2026-09-08）

- [x] 新增一次性 inbound `resolve_product_radar_intent` 语言解析层，负责 list/confirm/cancel/stop/watch/none action，不参与轮询。
- [x] 保留 deterministic fast path，并在歧义文本上调用当前 GPT-5.6 Luna intent planner；provider 失败自动 fallback。
- [x] 支持自然表达：`我都在盯哪些东西？`、`刚才那件不要了`、`帮我看看现有监控`，不再依赖固定完整句子。
- [x] LangBot plugin task `71` 达到 `INSTALL_READY`；intent planner tests 已通过。


## Product Radar existing Watch list / bot offline diagnosis（DEPLOYED / VERIFIED：2026-09-08）

- [x] 修复用户输入 `我在盯着什么` 未命中 `is_list_request` 的问题；现在支持 `我在盯着什么`、`我现在盯着什么`、`当前监控`、`/watches` 等。
- [x] Watch list renderer 现在展示 Similarity Watch 的实际 query/SearchPlan，不再显示空 target。
- [x] LangBot plugin task `67` 达到 `INSTALL_READY`；Product Radar API 从 plugin runtime 网络返回 HTTP 200，实际数据库当前有 3 个 Watch。
- [x] 诊断确认 LangBot/Telegram/KOOK 容器仍 running，近期 Telegram outbound 有成功记录；“没有监控”来自 list intent 未匹配，而不是 Product Radar 数据库为空。


## Product Radar active Watch 取消监控修复（DEPLOYED / VERIFIED：2026-09-08）

- [x] `取消监控` 现在同时支持两种状态：待确认 proposal 取消、已确认 active Similarity Watch 停止轮询。
- [x] active Watch 取消会 PATCH `enabled=false`，同步 pause shared SearchFeed sensor；历史记录保留，但不会继续轮询或通知。
- [x] plugin reload 后 context 映射丢失时，如果当前只有一个 active Similarity Watch，仍会安全选择它，不会误停 Product Watch。
- [x] LangBot Product Radar plugin task `58` 达到 `INSTALL_READY`；Product Radar/changedetection healthy。


## Product Radar image + 用户文字 Timeout Hotfix（DEPLOYED / VERIFIED：2026-09-08）

- [x] 修复原因：Bunjang 多 query 顺序请求 + Sharp preview scoring + LangBot 20s HTTP timeout 叠加，导致 `Product Radar unavailable: TimeoutError`。
- [x] Similarity preview query fetch 改为并行；reference image preparation 与 search 并行；预览 Sharp scoring 限制为前 12 个候选，不影响创建后的长期 Feed/Matcher 逻辑。
- [x] LangBot Product Radar client timeout 从 20s 提升为可配置值，默认 90s（`PRODUCT_RADAR_HTTP_TIMEOUT_SECONDS`）。
- [x] 使用真实 Bunjang 羽绒服图 `363252234` + `帮我盯着这件羽绒服` 完成验证：preview HTTP 200、19.18s、baseline 103、queries=`패딩`/`다운 자켓`、warnings=0、无 TimeoutError；临时 Watch 创建 HTTP 201、900s、baseline 494、baseline notification 0，随后已删除。
- [x] Bunjang planner 不再发送原始中文 `羽绒服` query，改用 `패딩` / `다운 자켓` localized aliases；最终只保留原真实 Product Watch，SearchFeed/test sensor 已清理。


## Product Radar Bunjang Search Response Hotfix（DEPLOYED / VERIFIED：2026-09-08）

- [x] 修复 Bunjang search response parser：兼容 `searchResponse.data/items`、嵌套 `payload/items/products/results`、`nextCursor` 等返回形状，并优先选择非空 product-like array。
- [x] Similarity preview 改为 query 级容错：单个 query response 异常时保留其他 query 结果并显示 `searchWarnings`；不会因为一个 Feed 的暂时异常阻断 Watch 预览/创建。
- [x] 新 image-only preview smoke 已通过：` 의류` query 返回 54 candidates、无 `searchWarnings`，baseline/notification contract 和现有真实 Product Watch 未改变。
- [x] 已部署 image `local/product-radar:git-23836b200afe`，Product Radar 与 changedetection healthy；现有真实 Product Watch 仍为 enabled、120 秒。


# Product Radar V0.3 Phase A（DEPLOYED / VERIFIED：2026-09-08）

- [x] 新增平台无关 `TargetProfileExtractor` / `VisionProfileProvider`；用户明确品牌、型号、季节、价格、包含/排除条件优先于 vision/OCR/inferred，并记录 provenance/confidence。
- [x] LangBot 图片入口保留 base64/URL，接入一次性多模态 TargetProfile 提取；预览显示用户条件、系统识别和最终 SearchPlan；轮询不调用 LLM。
- [x] 新增 `SourceSearchPlanner` / `BunjangSearchPlanner`；生成 explicit/specific/medium/broad 分层韩语 query，保留用户 search term，不再永久只用 `의류`。
- [x] 新增 `SearchFeed` 独立 domain 与 SQLite `search_feeds`、`watch_feed_subscriptions`、`feed_listing_events`、`target_profiles`、`search_feed_runs`；同 source/query 复用一个 feed/sensor。
- [x] Similarity 默认 interval 改为 900 秒；feed 使用确定性 ±120 秒 jitter；显式 interval 保持，不影响 Product/Seller Watch。
- [x] changedetection 只触发 feed refetch；实现 watermark 增量分页（max pages 10、max listings 500）、WATERMARK_NOT_REACHED degraded、失败不推进 watermark、backoff/recovery。
- [x] 新增 ListingDiscoveredEvent 数据流和 shared-feed watch router；reference baseline 与 notification/event idempotency 保留。
- [x] ImageMatcher 增强为 provider/model/rawScore/matchScore abstraction，加入可替换 ImageFeatureProvider/ImageFeatureCache；当前 Sharp 行为和 0.60 阈值保持。
- [x] 新增 38 项 Product Radar TypeScript tests、7 项 LangBot plugin tests；已通过 typecheck/build、Python compile、git diff check。
- [x] RELEASE：Product Radar immutable image `local/product-radar:git-8b0b96e4c2c6` 已在 OrbStack `ubuntu`/CasaOS 激活；changedetection `0.60.3` 保持 healthy，未重建或删除其 datastore。
- [x] LangBot Product Radar plugin `0.3.0` 通过 `scripts/deploy-langbot.sh --plugin product-radar --apply` 安装，最终 task `41` 达到 `INSTALL_READY`；最新 rollback dir 为 `.backups/langbot/20260908-131244`；视觉 provider 默认锁定当前 LangBot registry 的 `gpt-5.6-luna`（UUID `581087d4-5793-4116-9aa1-d82e08ec6849`），仍可由外部 config/env 覆盖。
- [x] Real smoke：使用 Bunjang 公开服饰图 `424506121`，profile/user text、explicit query、900s interval、SearchFeed baseline、restart persistence、changedetection webhook、duplicate webhook 均验证；baseline/changedetection rerun 均 0 notification / 0 match / 0 event。
- [x] 清理测试 Watch `v03-smoke-20260908`、`v03-smoke-persist-20260908` 及其独占 Feed/sensor；最终只保留原 Product Watch `9ec10408-e55b-43a8-821b-f3427005656e`，interval 120s，Product Snapshot 与 changedetection sensor 正常。


更新时间：2026-09-07（Asia/Shanghai）

## Product Radar V0.1（DEPLOYED / VERIFIED：2026-09-07）

- [x] 新增独立 `apps/product-radar` runtime；Core 使用 generic Listing/Watch/Status/Event/Notification 抽象，不包含 Bunjang-specific domain type。
- [x] 新增 Source Adapter registry 与 capabilities；Bunjang 支持 Seller/Product，search/category/smart 明确返回 unsupported。
- [x] Seller Watch 实现目标校验、初始 baseline、seen 去重、ANY/ALL/排除词/价格区间 matcher；未命中 listing 也会写入 seen。
- [x] Product Watch 实现持久 ProductSnapshot baseline、price/status/title/seller/image 有意义 diff、before/after event，以及 UNKNOWN 安全处理。
- [x] 新增 SQLite 表：`watches`、`listings`、`watch_seen_listings`、`product_snapshots`、`sensor_watches`、`events`、`notification_outbox`、`poll_runs`；进程重启恢复状态。
- [x] 新增 `ChangedetectionSensorClient`：create/update/pause/resume/delete/get/health；changedetection webhook 只定位 watch，Product Radar 重新 fetch source。
- [x] 新增 LangBot Product Radar plugin：卖家/商品 URL 自然语言解析、确认摘要、Telegram inline callback marker、KOOK 文本 fallback、`我现在盯着什么？` 列表。
- [x] 新增 LangBot HTTP notification channels；Telegram/KOOK 使用固定外部 Admin recipient 的 private target，单平台失败不阻塞另一平台。
- [x] 新增 Product Radar Dockerfile、local compose、CasaOS template 和持久化 changedetection datastore；未重建 agent-runtime/HomeHub。
- [x] 21 项 Product Radar TypeScript tests、Python plugin tests、typecheck/build、Compose config、LangBot dry-run、secret scan 通过。
- [x] Bunjang Product smoke（2026-09-07）：公开商品 `418123655` 返回标题、₩1,400,000、ACTIVE、2 张图片和卖家 `4771473/기미히끼잉잉`；SQLite snapshot baseline 建立，baseline notifications 为 0。
- [x] Bunjang Seller smoke（2026-09-07）：公开卖家 `4771473` 通过 Bunjang shop search endpoint 取得 5 条当前 listings；SQLite seller baseline 建立，baseline notifications 为 0；未登录、未使用代理池或反爬绕过。
- [x] 已执行显式 RELEASE：Product Radar 与 changedetection 已部署到 OrbStack `ubuntu`/CasaOS；LangBot Product Radar plugin 已通过 API 安装并达到 `INSTALL_READY` task `24`；修正 listener manifest 后重新安装为 task `32`，Command 与 EventListener 均已加载；最新 task `35` 增加了使用现有 PUBG renderer marker 的按钮渲染、无 token 确认和停止监控；`d73b9fc` 已让 Telegram host callback router 接受 `pr1:`。
- [x] Product Radar `/health` HTTP 200、changedetection API HTTP 200、Seller/Product preview HTTP 200；未创建测试 Watch，未向真实 Telegram/KOOK 发送测试垃圾消息。

实现 checkpoint：`.agent/checkpoints/2026-09-07-product-radar-v0.1.md`；部署 checkpoint：`.agent/checkpoints/2026-09-07-product-radar-deployment.md`；实现 commits：`83c3557`、`ed394e9`、`380f132`、`efbf19e`、`53d1b84`、`d73b9fc`。

## Product Radar V0.2 Image Similarity Watch（DEPLOYED / VERIFIED：2026-09-07）

- [x] 新增 generic `similarity` Watch type、`SimilarityWatchRules`（默认阈值 0.60、candidateLimit 60）与 `similarityWatch` source capability；V0.1 的 seller/product/search/category 语义保持独立。
- [x] 新增 `ImageMatcher` port 与独立 `PerceptualImageMatcher` 实现：下载/解析图片、持久化 reference/candidate feature、cosine score、单候选图片失败隔离。
- [x] Bunjang 新增公开 keyword feed candidate discovery，默认使用韩文 `의류`，不做登录、CAPTCHA、代理池或全站大规模 crawling。
- [x] LangBot 支持图片附件（Telegram Image base64/URL）自动生成 Similarity Watch proposal；确认摘要显示阈值、候选范围和每 2 分钟频率。
- [x] Similarity baseline 静默写入 `watch_seen_listings`；新候选达到 60% 才产生 `SimilarListingMatchedEvent`；未命中仍写入 seen，事件和 outbox 继续幂等。
- [x] 产品部署镜像 `local/product-radar:git-298f8ee28072` 已通过 host BuildKit build/load 并在 OrbStack `ubuntu`/CasaOS recreate；`sharp` runtime dependency 已验证可加载。
- [x] 真实部署 smoke：Similarity preview HTTP 200，Bunjang `의류` 返回 54 个候选；创建测试 Watch `v02-smoke-20260907` HTTP 201，baseline 54、interval 120、baseline notification 0；真实 sensor webhook HTTP 202，执行成功且无假通知。
- [x] 测试结束：测试 Watch 已 pause（Product Radar enabled=false、changedetection paused=true）并 delete；changedetection 测试 watch 已删除，原有用户 Product Watch 未修改。
- [x] 24 项 Product Radar TypeScript tests、7 项 Python plugin tests、perceptual similarity smoke、typecheck/build、secret scan、Compose config 通过；本轮未发送 Telegram/KOOK 测试消息。

V0.2 checkpoint：`.agent/checkpoints/2026-09-07-product-radar-v0.2.md`。

## PUBG 对局复盘 V1（DEPLOYED / VERIFIED：2026-09-06）

更新时间：2026-09-06（Asia/Shanghai）

基于比赛 `d8c41c10-de9f-40b4-ac88-ede0ab554a31` 的真实 PUBG Match API/Telemetry 完成复盘 V1 source implementation，并已部署到 OrbStack `ubuntu` / CasaOS：

- [x] runtime immutable image `local/pubg-query-engine-v3:git-2f6a63b013ff` 已加载并运行；image deployment rollback compose：`/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260906-231814`。
- [x] CasaOS runtime compose 已切换 `PUBG_TELEMETRY_PARSER_VERSION=telemetry-parser-5`、`PUBG_REVIEW_FEATURE_VERSION=review-features-5`；配置 rollback compose：`/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260906-232046`。
- [x] n8n `PUBG Data Gateway v3`（ID `pubg-data-gateway-v3-20260902`）已从 Git source 导入并保持 active；external backup：`/home/node/.n8n/workflow-backups/codex-pubg-data-gateway-v3-20260902-before-20260906-231837.json`。
- [x] LangBot API task `14` 已安装 `local/pubg-stats` `3.3.0` 并达到 `INSTALL_READY`；LangBot deploy backup：`.backups/langbot/20260906-231910`。
- [x] 真实 `/v3/query` Match ID smoke 返回 `OK`，使用 `telemetry-parser-5/review-features-5`，命中荣都、武器信息、队友互动、恢复/能量、搜包、环境动作、一炮四轮和误伤三件套等 section；新 feature cache 创建于 `2026-09-06T15:21:25.459Z`。
- [x] `GET /healthz`、`/homehub/health`、n8n health、`scripts/doctor.sh`、`scripts/smoke-homehub-docker.sh` 均通过；runtime healthy，Docker smoke 为 8 healthy / 4 degraded / 1 down / 0 unknown。
- [x] source commits：`fb6000a`（复盘实现）、`2f6a63b`（状态文档）、`acdfc65`（parser/feature compose defaults）。
- [ ] 本轮未发送新的真实 Telegram 用户消息；如需平台端人工复测，发送“复盘这场比赛`d8c41c10-de9f-40b4-ac88-ede0ab554a31`”即可确认 LangBot 入站链路。

部署 checkpoint：`.agent/checkpoints/2026-09-06-pubg-review-v1-deployment.md`。

## PUBG 复盘 Telegram 超长消息修复（DEPLOYED / VERIFIED：2026-09-06）

- [x] 定位 23:26–23:27 Telegram `BadRequest: Message is too long` 根因：runtime 返回的 4,278 字符复盘被插件 adapter 合并为单条 `reply_message_chain`，没有使用 runtime 内部的多 message 分段。
- [x] Git patch `25d4535` / `cfaaacd` 已让 patched Telegram host adapter 在最终渲染后按 3,800 字符安全阈值顺序发送多个 chunk；reply markup/quote 仅保留第一段。
- [x] LangBot image `local/langbot-agent:cfaaacd35b87-20260906-233604` 已在 CasaOS `ubuntu` 激活；rollback compose：`/var/lib/casaos/apps/langbot/docker-compose.yml.codex-backup.20260906-233608`。
- [x] active container source、in-container split smoke（`[3600, 600]`）、LangBot plugin `3.3.0` readiness、runtime health、doctor 均通过。
- [ ] Codex 未代发新的真实 Telegram 用户消息；请用户重发复盘请求确认最终 Telegram outbound。

Hotfix checkpoint：`.agent/checkpoints/2026-09-06-pubg-review-v1-telegram-long-message-fix.md`。

## HomeHub V1.2 implementation（SOURCE COMPLETE；实际部署待执行）

截至 2026-09-06，V1.2 源码实现与本地验证已完成，实际 CasaOS/LangBot/macOS agent 部署仍待当前阶段的 RELEASE 操作：

- [x] Telegram/KOOK platform identity 只使用稳定 platform user ID；Telegram 群聊从 `message.from.id` / callback `from.id` 取用户，`chat.id` 只作为会话边界；群 ID 不进入 Admin mapping。
- [x] HomeHub confirmation 使用平台无关 presentation；Telegram 复用现有 PUBG inline keyboard/callback marker，生成短 `hh1:confirm|cancel:<actionId>` 数据，服务端精确校验 `platform + chatId + platformUserId + actionId`，支持原子 claim、replay/expiry/foreign 拒绝；KOOK 保留文本 fallback。
- [x] 文本唯一 pending action 的「确认」已从 `/v3/route` 路由到 HomeHub，能执行而不是要求重新说明操作。
- [x] 新增 `MacHostAgentCommandExecutor` 与 `infra/macos/mac_host_agent.py`，只允许 `/v1/health`、`/v1/host/status`、`/v1/cloudflared/status`，Bearer token 鉴权，禁止 `/exec`/`/shell`；HostAgent 不可用时主机与 macOS 服务为 UNKNOWN。
- [x] MacHostAgent 采集真实 macOS hostname、OS/build、model、CPU、load、uptime、APFS-aware disks、network、power、cloudflared 和 high CPU processes；本机实际 handler smoke 已返回 MacBookPro18,3、macOS 26.0.1、Avalon 约 92.4% 和 cloudflared running。
- [x] Service Registry 根据真实 CasaOS labels 映射 `postgres -> immich-postgres`（Immich/database）、`redis -> immich-redis`（Immich/redis），补齐实际运行的 `media-organizer-adapter`，Docker allowlist 同步实际 container names。
- [x] 健康判断以 executor/container/process/Docker health/application endpoint 为主，ERROR 日志仅产生 DEGRADED；stopped 为 DOWN，executor unavailable 为 UNKNOWN；`/status` formatter 改为 NAS/核心/媒体/基础设施/需要关注分组，不把完整日志塞入列表。
- [x] 新增 TypeScript/Python 回归：Telegram identity、buttons/callback ownership/replay/expiry/text fallback、MacHostAgent surface/metrics、running+ERROR != DOWN、service registry mapping；runtime 125 pass / 1 skip，secret scan、diff check、MacHostAgent tests 通过。
- [x] 用提交后的 immutable runtime/LangBot images 部署到 OrbStack `ubuntu`/CasaOS，并通过真实 `/status`、HostAgent reachability、Telegram callback/text smoke；部署后补充 checkpoint 与 rollback evidence。

源码 checkpoint：`.agent/checkpoints/2026-09-06-homehub-v1.2-implementation.md`。

## HomeHub V1.2 deployment（DEPLOYED / VERIFIED：2026-09-06）

- [x] macOS `com.local.homehub.mac-host-agent` 已由 launchd 启动并监听 `0.0.0.0:49152`；token 只在 `/Users/Shared/HomeHub/mac-host-agent.token` 与 CasaOS `/DATA/AppData/pubg-query-engine-v3/secrets/mac-host-agent-token`，不入 Git。
- [x] runtime immutable image `local/pubg-query-engine-v3:git-6a59a544bacf` 已部署；runtime compose rollback 为 `/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260906-151912`，HostAgent token mount/env compose rollback 为 `/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260906-152003`。
- [x] patched LangBot image `local/langbot-agent:415b6ea002d1-20260906-153202` 已激活；compose rollback 为 `/var/lib/casaos/apps/langbot/docker-compose.yml.codex-backup.20260906-153205`。`pubg-stats 3.2.4`、`organize-emby 0.2.0`、`macos-nas-control 0.1.4` 已通过 API task `12/13/14` 安装就绪。
- [x] live MacHostAgent through HomeHub returned hostname `Xu 的 MacBook Pro`, macOS `26.0.1 (25A362)`, model `MacBookPro18,3`, root/Avalon disks `92.2%/92.4%`, 30 network entries, AC power and cloudflared running; no container metrics were used.
- [x] real `/status` returned 14 registered services: 8 HEALTHY, 4 DEGRADED (LangBot/n8n/Jellyfin/media organizer recent errors), 1 UNHEALTHY (Postgres Docker HEALTHCHECK), 1 DOWN (Glances absent), 0 UNKNOWN. The main list contains compact diagnostics only; full log samples remain in diagnosis data.
- [x] `scripts/smoke-homehub-docker.sh` passed: read-only Docker socket, 10 allowlisted actual containers, and real macOS host metrics.
- [x] live `/v3/whoami` private/group smoke mapped Telegram user `5501555095` to the same `arthur/ADMIN` with distinct chat IDs (`5501555095` and `-5527996775`); live HomeHub prompt returned bounded confirm/cancel buttons; foreign callback was denied; owner cancel succeeded; `/v3/route` routed text `确认` to HomeHub.
- [x] live text fallback confirmed `重启 aria2`; action verification passed and canonical `aria2` was observed `Up` after restart.

Deployment checkpoint：`.agent/checkpoints/2026-09-06-homehub-v1.2-deployment.md`。

## HomeHub V1.2 follow-up（2026-09-06：磁盘容量 + Telegram fallback）

- [x] NAS/HomeHub status 磁盘行现在显示 `已用 / 全部，可用，使用率`，例如系统盘 `425 GiB / 460 GiB，可用 35.5 GiB，92.3% ⚠️`；APFS root accounting 继续复用 `total - available`。
- [x] 定位 Telegram 不回复根因：历史 outbound `BadRequest: Can't parse entities: can't find end of precode entity`。Telegram patched boundary 现在对 entity/Markdown 解析类 BadRequest 自动去除 `parse_mode/entities` 后以纯文本重试，其他 BadRequest 仍原样失败。
- [x] 新 runtime image `local/pubg-query-engine-v3:git-7df513bdcd27` 已部署，rollback compose 为 `/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260906-183922`。
- [x] 新 LangBot patched image `local/langbot-agent:7df513bdcd27-20260906-183935` 已激活，rollback compose 为 `/var/lib/casaos/apps/langbot/docker-compose.yml.codex-backup.20260906-183938`；active Telegram source 已确认含 entity fallback、identity correction 和 `hh1` callback 分支。
- [x] live `/status` 已显示系统盘/Avalon 已用、总量和可用空间；Docker smoke 仍为 8 healthy、4 degraded、1 down、0 unknown，HostAgent real macOS metrics 正常。

Follow-up checkpoint：`.agent/checkpoints/2026-09-06-homehub-v1.2-disk-telegram-followup.md`。

## HomeHub Docker Executor + PUBG KD 修复（DEPLOYED / VERIFIED）

- [x] 新增 `DockerApiCommandExecutor`：只通过 `/var/run/docker.sock` 使用 Docker Engine API，不依赖 Docker CLI。
- [x] Docker 容器名严格限制为 Service Registry 的 allowlist：`langbot`、`pubg-query-engine-v3`、`n8n`、`postgres`、`redis`、`emby`、`jellyfin`、`qbittorrent`、`aria2`、`glances`。
- [x] 观察仅支持受限 `ps`、脱敏 `inspect`、最多 200 行 `logs` 和 `stats`；变更仅支持 `start` / `restart`；明确拒绝 `compose`、`exec`、`run`、`rm`、prune 和任意 shell。
- [x] HomeHub Docker action 已从 Compose 改为安全的容器 `start` / `restart` API；socket/权限/daemon 失败统一保留为 `UNKNOWN`。
- [x] HostCollector 默认不再读取 HomeHub 容器 `/proc` 冒充 macOS Host；无 macOS Host Executor 时返回 `UNKNOWN` 和明确原因。
- [x] 新增 `GET /status` 与 `/homehub/status` 实时状态端点，新增只读 `scripts/smoke-homehub-docker.sh`。
- [x] 修复 PUBG KD：n8n 归一化记录补齐 `deaths` / `deathSemantics`，runtime 对旧记录缺失字段使用 placement proxy；零死亡 KD 不再向用户渲染 `∞`，而显示为未定义 `—`。
- [x] 定向 TypeScript、完整 runtime tests、secret scan 和 diff check 已通过。
- [x] 使用 `scripts/deploy-homehub-docker-socket.sh --apply` 修改 canonical CasaOS compose 并重建 runtime。
- [x] 使用 `scripts/smoke-homehub-docker.sh` 在实际 `pubg-query-engine-v3` 容器内验证 socket、Docker client 和 `/status`。

生产部署顺序：先提交干净 source，再执行 `./scripts/deploy-agent-runtime.sh --apply --build --no-proxy`，随后执行
`./scripts/deploy-homehub-docker-socket.sh --apply`（该脚本只做显式 `--no-build` compose recreate），最后保留
compose rollback backup、health 和 Docker smoke 证据。

部署证据（2026-09-06）：immutable image `local/pubg-query-engine-v3:git-1a8a825812b6`；
canonical compose rollback backup `/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260906-105507`；
container 以 `node` + supplementary group `104` 运行，`/var/run/docker.sock` 为只读 bind mount，
`test -S /var/run/docker.sock` 通过，受限 client 列出 7 个 allowlisted containers，`GET /status` 返回
13 个 registered services，其中 8 healthy、3 down（实际不存在的 postgres/redis/glances）、1 unhealthy（Jellyfin
最近日志错误）、1 unknown（macOS cloudflared）；没有出现全量 UNKNOWN。Host CPU/内存明确返回
`UNKNOWN — macOS executor unavailable; HomeHub container metrics are not host metrics`。
PUBG workflow 生产同步：已用 `scripts/deploy-n8n-workflow.sh --apply` 导入并重新激活
`PUBG Sync Matches v3` 与 `PUBG 今日战绩`；n8n 外部 rollback backups 分别为
`/home/node/.n8n/workflow-backups/codex-pubg-sync-matches-v3-20260902-before-20260906-105911.json`
和 `/home/node/.n8n/workflow-backups/codex-pubg-daily-stats-20260830-before-20260906-110037.json`。
真实 runtime `最近20场战绩` smoke 返回 20 场、玩家 KD `1.47 / 0.91 / 0.74 / 0.38`，合计 KD `0.96`，
response 与结构化 payload 均不含 `∞` 或 `Infinity`。

## 2026-09-06 快速 Bug 修复（DEPLOYED / VERIFIED）

- [x] PUBG 所有用户可见 KD（TypeScript runtime、legacy V2 Python、legacy n8n）统一按四舍五入保留 1 位小数；内部排序仍使用未格式化数值。
- [x] 零死亡 KD 继续显示 `—`，不会渲染 `∞` / `Infinity`。
- [x] macOS NAS `nas.status` 升级为 V2 结构化 payload：主机、macOS 版本/build、型号、CPU 核心、load、uptime、登录用户、内存、系统盘/Avalon、网络、网关、电源、cloudflared 和高占用进程；磁盘单位修复为 macOS human-readable 输出。
- [x] NAS formatter 增加移动端卡片样式、90% 磁盘告警和旧 payload 兼容；manifest 已升级至 `0.1.4`。
- [x] 新增 `scripts/deploy-nas-control.sh`，默认 dry-run；`--apply` 会创建 `.codex-backup.<timestamp>`、安装外部 forced-command 并执行真实 `nas.status` smoke。
- [x] Telegram outbound boundary 和 streaming chunk 增加 `<think>` / `</think>` 过滤；完整、未闭合和 think-only 内容均不会泄漏到 Telegram。
- [x] HomeHub status 将 host CPU/内存继续明确保持 UNKNOWN（不冒充 Docker 容器指标），但改为中文原因说明；服务级 macOS/Docker executor UNKNOWN 也不再显示原始英文报错。
- [x] 定向 TypeScript、完整 runtime（118 pass / 1 skip）、legacy Python（31 pass）、NAS/Telegram patch tests、shell/Python syntax、LangBot patch dry-run、secret scan 已通过。
- [x] runtime image `local/pubg-query-engine-v3:git-1b52d2c89f3e` 已部署；compose rollback backup 为 `/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260906-132837`；真实 HomeHub `/status` smoke 通过（7 healthy、2 unhealthy、3 down、1 unknown），Docker socket 与 allowlist client 正常。实际 `/v3/query`「最近20场战绩」返回 KD `1.5 / 0.9 / 0.7 / 0.4`、合计 `1.0`，无 `∞`/`Infinity`。
- [x] n8n `PUBG 今日战绩` 已重新导入/激活，live export 确认 KD formatter 使用 `toFixed(1)`；外部 rollback backup 为 `/home/node/.n8n/workflow-backups/codex-pubg-daily-stats-20260830-before-20260906-132906.json`。
- [x] LangBot patched image `local/langbot-agent:5a051b8756c4-20260906-132959` 已激活，compose rollback backup 为 `/var/lib/casaos/apps/langbot/docker-compose.yml.codex-backup.20260906-133002`；live Telegram source 已确认 outbound/Markdown/streaming think filter 存在，patch chain 编译通过，active virtualenv helper smoke 通过。
- [x] macOS external forced-command 已安装并通过真实 `nas.status` smoke；旧文件 rollback backup 为 `/Users/blacksidev/.local/bin/nas-control.codex-backup.20260906-132920`；当前 payload 已改为 APFS 实际占用计算（系统盘约 `424GiB / 460GiB`、使用率约 `92.1%`），并输出中文运行时间和电源状态。
- [x] NAS formatter 修复 `df` 在 macOS APFS 根快照上把快照 Used 当成整盘 Used 的问题；运行时间和 `pmset` 电源文本改为中文卡片。
- [x] NAS formatter `0.1.4` 已通过 LangBot Plugin API 重新安装激活（task `19`）；真实 active plugin runtime 输出系统盘约 `424GiB / 460GiB`、使用率 `92.1%`，运行时间和电源均为中文。
- [x] `macos-nas-control` v0.1.4 已通过 LangBot Plugin API 安装并初始化（task `19`）；使用仓库外 key file，未输出或提交 credential。已在 active `langbot_plugin_runtime` 内调用真实 macOS `nas.status`，APFS 磁盘、中文 uptime、电源和 V2 移动端 formatter smoke 全部通过。

## Codex Global Completion Notification Bridge（DEPLOYED / VERIFIED）

- [x] 全局 hook 已安装到 `/Users/blacksidev/.codex/bin/codex-notify.sh`，配置位置为
  `/Users/blacksidev/.codex/config.toml` root-level `notify`；不依赖 agent-monorepo 或当前 cwd。
- [x] Git source 为 `integrations/codex/codex-notify.sh`；安装脚本复制 source，不在全局 config 写入 secret。
- [x] 当前 Codex legacy notify argv payload（`type=agent-turn-complete`、`thread-id`、`turn-id`、`cwd`、
  `last-assistant-message`）已归一化为 webhook 所需的 event/threadId/turnId/cwd/projectName/
  lastAssistantMessage/timestamp。
- [x] script 使用 curl 2 秒连接/5 秒总 timeout，过滤非 completion event，日志不含 payload/secret，网络失败返回 0。
- [x] n8n workflow `Codex Completion Notification` 已激活，source 为
  `integrations/n8n/workflows/codex-completion-notification.workflow.json`，生产 ID
  `codex-completion-notification-20260906`，Webhook `/webhook/codex-complete`。
- [x] n8n shared secret 与固定 admin identities 通过外部文件同步到 global variables；真实值未入 Git。
- [x] idempotency Data Table `codex-completion-idempotency-20260906` 已创建，`eventKey` 唯一索引为
  `threadId:turnId`；重复事件在发送前返回 `duplicate: true`。
- [x] Telegram/KOOK 均复用 LangBot `/send_message` outbound sender，固定 `target_type: person`；目标
  只来自 `TELEGRAM_ADMIN_USER_ID` / `KOOK_ADMIN_USER_ID`（Arthur Admin identity），不使用 payload/chat/channel。
- [x] 两个 sender 均 `continueOnFail: true`，结果分别记录 `telegram: sent|failed`、`kook: sent|failed`。
- [x] global Codex turn smoke（cwd `/tmp`）已进入 n8n，Telegram 与 KOOK 均 `sent`；runtime smoke 已验证
  缺失 secret 拒绝、项目名从 cwd 安全解析、双平台发送和重复抑制。
- [x] 受控 failure-isolation smoke 已验证 Telegram failed 时 KOOK sent、KOOK failed 时 Telegram sent；测试后
  两个平台 admin variables 与 shared secret 均从原外部配置恢复并核对。
- [x] static workflow smoke、notify script smoke、runtime webhook smoke、secret scan、JSON/shell 校验通过。

n8n workflow 最后一次生产导入的外部 rollback backup 为
`/home/node/.n8n/workflow-backups/codex-codex-completion-notification-20260906-before-20260906-114742.json`。
shared secret 外部文件为 `~/.codex/secrets/codex-notify-secret` 与
`/DATA/AppData/n8n/secrets/codex-notify-secret`，不在仓库内。

## 当前阶段

**PUBG Intent Router 时间词误判 — 已完成并提交。**

本阶段已完成生产发布。HomeHub V1.1 已以 `e0a3ed5` 提交；PUBG Intent Router 时间词修复已以独立 commit `d12b733` 提交；部署脚本修复已以 `46efb62` 提交。生产 runtime 已在 OrbStack `ubuntu` / CasaOS 激活 immutable image，未执行无关服务重启。


## HomeHub V1.1 Production Deployment（2026-09-05）

状态：**PUSHED / BUILT / DEPLOYED / HEALTHY**。

- [x] `main` 已 push 到 `origin/main`，包含 V1.1、安全修复、PUBG Router 修复和部署脚本修复。
- [x] 首次 RELEASE 构建在 final dependency deploy 阶段因 host 的 `127.0.0.1:7897` proxy refused 失败；未更新 CasaOS compose，旧生产容器仍保持 healthy。
- [x] 修复 `scripts/deploy-agent-runtime.sh` 的 `set -u` 空数组展开问题，提交 `46efb62` 并再次 push。
- [x] 使用 `./scripts/deploy-agent-runtime.sh --apply --build --no-proxy` 完成 host BuildKit 构建、image transfer 和 CasaOS `docker compose up -d --no-build`。
- [x] immutable image：`local/pubg-query-engine-v3:git-46efb62eba0c`。
- [x] canonical compose：`/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml`；当前 compose image 与运行容器均为 `local/pubg-query-engine-v3:git-46efb62eba0c`。
- [x] rollback compose backup：`/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260906-012427`。
- [x] 生产容器 `pubg-query-engine-v3` 状态为 `Up (healthy)`，`/healthz` 返回 200，`/homehub/health` 返回 `status=healthy`。
- [x] 未修改 `/DATA/AppData`、媒体库或 secrets；部署仅替换 runtime image 并保留 compose 回滚副本。

回滚：在 Ubuntu root shell 中将 compose image 恢复为 backup 中的旧 image，然后执行
`cd /var/lib/casaos/apps/pubg-query-engine-v3 && docker compose up -d --no-build`，再验证两个 health endpoint。

## Telegram / KOOK `Request Failed` 诊断（2026-09-05）

- [x] 只读检查 OrbStack `ubuntu` / CasaOS 中的 `langbot`、`langbot_plugin_runtime`、
  `9router` 和 `pubg-query-engine-v3`；LangBot 与插件 runtime 正常运行，runtime 为 healthy。
- [x] 确认 2026-09-05 23:13:57、23:14:31、23:14:47 的 KOOK 失败，以及
  23:14:55、23:41:47、23:41:50 的 Telegram 失败，均落在同一条 `arthur-combo` 模型请求链路。
- [x] 根因已交叉验证：LangBot `9Router` provider 保存的 API key 长度为 3，
  `9router` 数据库当前 active API key 长度为 35；使用 LangBot 当前 key 请求 `/v1/models`
  返回 HTTP 401 `API key required for remote API access`，使用 9router active key 返回 HTTP 200。
- [x] 排除 Telegram/KOOK 传输层为主因：两平台的 `/whoami` 和部分后续消息仍成功出站，
  `scripts/doctor.sh` 通过（0 failure、0 warning）。
- [x] 记录次要运行时告警：9router 的 Kiro OAuth refresh token 返回 `invalid_grant`，
  Codex Luna 曾出现短时 account lock；它们不是本次 401 的直接根因。
- [x] 用户已将 9router active API key 重新绑定到 LangBot `9Router` provider；只读复核确认
  provider key 与 9router active key 完全一致，使用该 key 请求 `/v1/models` 返回 HTTP 200。
- [x] 修复后 Telegram 私聊和群聊测试均成功完成模型流式响应（各 2 chunks），最近日志没有
  新增该 HTTP 401；用户确认 KOOK 与 Telegram 均已恢复。
- [x] 不需要重建镜像或重启容器；LangBot 通过管理 API 保存 provider 更新后立即恢复。
- [ ] 9router 的 Kiro `invalid_grant` 和 Codex Luna account lock 仍是独立的上游告警，后续
  如需稳定 fallback 再单独处理；不影响本次 key 修复结论。

## Developer Workflow Optimization V1（2026-09-05）

- [x] 落地 `FAST` / `RUNTIME` / 显式 `RELEASE` 规则与 `scripts/developer-workflow.sh` 自动 scope 分类。
- [x] docs、tests、`.agent` 默认 FAST；`apps/agent-runtime/src/**` 与
  `packages/homehub-domain/src/**` 默认 RUNTIME，且不触发 Docker build。
- [x] Dockerfile、`.dockerignore`、package manifest、`pnpm-lock.yaml` 标记
  `RELEASE_BUILD_REQUIRED`；LangBot plugin/patch 与 env-only 分别路由到专用 no-build workflow。
- [x] `apps/agent-runtime/Dockerfile` 已把 manifests/lockfile 与 `pnpm install` 放到 source copy 前，
  并用 BuildKit `/pnpm/store` cache mount；final stage 改用 `COPY --chown`，避免 `chown -R` 大层重写。
- [x] 新增非 Docker `scripts/smoke-agent-runtime.sh`，验证 `/healthz` 与 `/homehub/health`。
- [x] 新增 `scripts/deploy-agent-runtime.sh`：默认 dry-run，任何 apply 都使用
  `docker compose up -d --no-build`；仅 `--apply --build` 允许 host BuildKit 构建、commit-tag image
  transfer、健康检查与 compose rollback backup。
- [x] 已完成 workflow 分类测试、RUNTIME 定向 typecheck/tests/local smoke、optimized image container smoke；
  BuildKit benchmark 证明单一 HomeHub TS 改动仍命中 `pnpm install` cache。
- [x] 关键时间记录：原 Dockerfile 的 source-change build 132.25s（install 114.0s）→ 新 Dockerfile
  22.37s（install `CACHED`），降低 83.1%；image size 降低 24.0%。
- [x] 详细规则、环境边界和 benchmark 写入 `docs/DEVELOPER_WORKFLOW.md`。

## Codex 配置变更（2026-09-05）

- [x] 已在仓库根目录 `AGENTS.md` 与用户级 `/Users/blacksidev/AGENTS.md` 写入强制规则：禁止为 goal 手动设置、指定、增加或限制预算；调用 `/goal`/`create_goal` 时省略 `token_budget`，使用 Codex 默认预算机制。
- [x] 完成只读 `/whoami` 命令：Telegram/KOOK 私聊和群聊/频道均通过统一平台契约处理。

## `/whoami` 平台来源修复（2026-09-05）

用户实测发现 Telegram `/whoami` 曾错误显示 `platform: kook`。根因是 LangBot 的
`PersonCommandSent`/`GroupCommandSent` 命令事件原本没有携带平台字段，旧兼容默认值把
Telegram session 当成了 KOOK。

- [x] build-time patch 为 LangBot command event 增加平台字段，并按实际 source adapter 判定 `telegram`/`kook`。
- [x] EventListener 接管 command event 后再执行 `/whoami`，继续使用真实 `sender_id`，不使用昵称判断。
- [x] patched LangBot image `local/langbot-agent:1adbc1d-whoami-display-20260905` 已激活，plugin 3.2.4 已重新安装并 ready。
- [x] runtime 与 LangBot 容器健康检查通过。
- [ ] 等待真实 Telegram 用户再次发送 `/whoami` 完成最终入站回归确认。

## HomeHub `/whoami` 完成清单

- [x] 通过 `NormalizedBotMessage.user.platformUserId` 使用平台真实唯一用户 ID。
- [x] 通过 `IdentityRegistry` 只按平台和稳定用户 ID解析 `internalUser`/`role`；未绑定返回 `unbound`。
- [x] 通过独立的只读 runtime path 和 `PresentationModel` 返回结构化身份信息，不读取或写入 Context，不调用数据层、Action 或危险工具。
- [x] LangBot V3 增加 `/whoami` Command，复用 Telegram/KOOK session Adapter 和 `/v3/whoami` endpoint。
- [x] 增加 Telegram 私聊/群聊、KOOK 私聊/频道、同昵称不同 userId 和无状态修改测试。
- [x] 推送 `main` 到 `origin`，在 Ubuntu/CasaOS 激活 runtime 镜像并安装 LangBot V3 plugin 3.2.4。
- [x] 通过 runtime `/healthz`、`/v3/whoami`、`scripts/doctor.sh` 完成部署后验证；保留 compose 回滚副本。
- [ ] 使用真实 Telegram/KOOK 用户事件执行最终入站烟测。

## Admin Identity 配置（2026-09-05）

- [x] 新增 `TELEGRAM_ADMIN_USER_ID`、`KOOK_ADMIN_USER_ID` 环境配置项，未将真实 ID 写入源码。
- [x] 系统启动时将已配置的平台 ID 映射为 `internalUser: arthur`、`role: ADMIN`。
- [x] 已将真实值写入本机忽略文件 `.env`，该文件未进入 Git。
- [x] 已将这两个环境变量通过外部 env 文件应用到 CasaOS container，并完成 runtime 重启。

## HomeHub V1.1 Security & Runtime Reliability（2026-09-05）

状态：**IMPLEMENTED / TARGETED VERIFIED / DEPLOYED**。

- [x] 新增平台无关 `AuthorizationCore`：`PlatformIdentity → InternalIdentity → Role → Authorization`；未配置映射默认 `PUBLIC`，副作用 Action 默认 DENY。
- [x] Telegram / KOOK 统一使用 `NormalizedBotMessage.user.platformUserId`，不读取 nickname、displayName、username 或 chat name；管理员映射只来自 `TELEGRAM_ADMIN_USER_ID` / `KOOK_ADMIN_USER_ID`，内部用户为 `arthur`。
- [x] 所有 HomeHub restart/start/stop/organize media 经过授权、风险判断、确认、执行和验证；`pendingAction` 精确绑定 platform、chatId、platformUserId、actionId；外国用户确认会被拒绝并审计。
- [x] Service Registry 为 13 个服务声明 `runtime` / `executor`，区分 Docker、LangBot Component、Ubuntu Process 和 macOS Host Service；`cloudflared` 没有 macOS Host Executor 时返回 UNKNOWN。
- [x] Host / Docker 检查改为当前运行边界的 direct executor，不再调用 `orb -m ubuntu`；executor 或 observation failure 不再转换为 DOWN。
- [x] Health 状态区分 HEALTHY、UNHEALTHY、DOWN、UNKNOWN；未知状态不进入 abnormal service 数量；CPU/Memory/Disk 不可读时返回 null，渲染为“未知”。
- [x] organize-emby plugin 在 Preview / Execute 前调用共享 `/homehub/authorize`，Authorization transport failure fail closed；插件 Preview key 同时保存 platform、chat、platform user 和 action ID。
- [x] 运行 `pnpm workflow:verify`：affected typecheck、HomeHub security/V1 定向测试、`/healthz` + `/homehub/health` local smoke 全部通过。
- [x] 运行 `scripts/deploy-langbot.sh --plugin organize-emby --dry-run --skip-runtime-check`：plugin package / secret scan 通过；未安装 plugin、未 build image、未修改 CasaOS。
- [x] 运行 Python `py_compile/compileall`、`git diff --check`。
- [x] V1.1 implementation commit：`e0a3ed5`（feat: harden homehub authorization and runtime health）。

HomeHub V1 已完成 Git source-of-truth 中的 domain、runtime facade、HTTP 接线、服务诊断、
确认式操作、审计、上下文和安全媒体整理预览/执行流程。`/whoami` runtime 已部署到
OrbStack ubuntu/CasaOS，真实 Telegram/KOOK 入站烟测仍作为后续人工任务保留。

Meta WhatsApp Cloud API 的商业版能力是接入稳定性与合规的必要前提。
当前开源版限制与平台变更频率较高，暂不继续投入实现和部署。

## 后续 small-scope task：PUBG Intent Router 时间词误判（2026-09-05）

状态：**IMPLEMENTED / TARGETED VERIFIED / COMMITTED**。

- [x] TimeRange 只能作为参数，不能单独触发 PUBG。
- [x] 先判断 Domain/Intent，再解析 TimeRange；使用正向 PUBG intent 与结构化 follow-up，不堆 negative keywords。
- [x] 明确 PUBG 语义或 activeDomain=pubg 的有效追问才进入 PUBG；长技术句不会因日期前缀继承 PUBG context。
- [x] 回归：`昨天战绩` → PUBG；PUBG 上下文后的 `前天呢？` → PUBG；`昨天超的是CL30, tRCD 36, tRP 36, tRAS 80` → NOT PUBG；`昨天 Emby 挂了吗` → HomeHub / NOT PUBG。
- [x] 仅运行 affected typecheck + targeted router/query tests、`git diff --check` 和 secret scan；未执行 Docker build / Release。
- [x] 独立代码/文档 commit：`d12b733`。

## HomeHub V1 完成清单

- [x] 新增 `packages/homehub-domain`，包含 schema、服务注册、主机采集、诊断、操作授权、上下文和审计。
- [x] 在 `apps/agent-runtime` 接入 HomeHub runtime、HTTP endpoint 和 PUBG/HomeHub 路由分流。
- [x] 对高风险服务保留确认门槛，操作结果执行后验证并写入审计日志。
- [x] 接入媒体整理的明确目标、预览、确认、备份、允许目录约束和目标冲突拒绝流程。
- [x] 增加 HomeHub 与媒体整理回归测试，并修复默认请求字段、查询分类和高风险授权顺序问题。
- [x] 完成 typecheck、build、runtime tests、legacy-v2 tests、secret scan 和 diff 检查。

## 完成清单

- [x] **Monorepo Migration Phase**
  - [x] 建立 pnpm workspace monorepo 结构
  - [x] 归档 Mastra/PUBG、Telemetry、Platform Adapter、WhatsApp 和 V2 domain
  - [x] 归档 LangBot 自定义插件、patch、资源和兼容说明
  - [x] 归档 n8n workflow JSON 与 credential placeholder
  - [x] 提供 CasaOS/Docker、Cloudflare、macOS 脱敏模板
  - [x] 建立 bootstrap.sh、doctor.sh、backup.sh、restore.sh
  - [x] 建立 check-secrets.sh、.gitignore、.env.example
  - [x] 建立 README、架构、状态、决策、清单和 checkpoint
  - [x] GitHub 远程配置并验证推送

- [x] **Codex Engineering Specifications Phase**
  - [x] 完善 AGENTS.md 为全局工程规则
  - [x] 创建 4 个可迁移的 Codex Skills（agent-checkpoint、langbot-development、n8n-workflow-development、release-and-migration）
  - [x] 新增 docs/PROJECT_MAP.md 说明目录职责
  - [x] 新增 scripts/deploy-langbot.sh 实现 Git-first 部署流程
  - [x] 更新 README.md 反映 GitHub 配置和部署说明
  - [x] 创建工程规范完成 checkpoint（.agent/checkpoints/2026-09-05-codex-engineering-specs.md）

- [x] **WhatsApp 接入暂停 Phase**
  - [x] 在 docs/DECISIONS.md 记录暂缓原因和恢复条件
  - [x] 在 docs/PROJECT_STATE.md 更新 WhatsApp 接入状态
  - [x] 确认 WhatsApp 代码不影响 KOOK / Telegram runtime
  - [x] 确认无默认启用配置，代码仅作为静态导出
  - [x] 保留 Cloudflare Tunnel 配置用于未来 Webhook / HomeLab API
  - [x] 保留已完成的 Adapter/实验代码作为 future integration reference

## 暂缓原因

Meta WhatsApp Cloud API 的商业版能力（如 webhook 批量验证、会话模板、高并发消息队列）是接入稳定性与合规的必要前提。当前开源版限制与平台变更频率较高，暂不继续投入实现和部署。

详见 docs/DECISIONS.md 的"2026-09-05：WhatsApp 接入暂缓"章节。

## 保留的代码和配置

- apps/whatsapp-adapter：Meta Cloud API 的 webhook 验签、入站消息归一化、文本拆分和发送器边界 facade
- apps/agent-runtime/src/platform/whatsapp：完整实现的 WhatsApp platform adapter、renderer、webhook、sender 和 graph-api
- integrations/langbot/patches/whatsapp.yaml：LangBot 侧的自定义平台资源
- infra/cloudflare：Cloudflare Tunnel 配置模板（保留用于未来 Webhook / HomeLab API）

## 确保不影响其他平台

- WhatsApp 相关代码仅作为静态导出，不影响 KOOK / Telegram runtime 路由
- Platform capabilities 定义保持静态配置，不引入运行时依赖
- Runtime 镜像中的 whatsapp 标签仅表示构建时包含相关代码，不会自动启用

## 验证结果

- [x] **Monorepo 基础验证**
  - [x] pnpm install 生成根 pnpm-lock.yaml
  - [x] pnpm typecheck、pnpm build
  - [x] pnpm test：83 个 runtime tests（82 pass，1 个外部 fixture 缺失而 skip）
  - [x] pnpm test:legacy-v2：30 个 Python tests 通过
  - [x] pnpm check:secrets
  - [x] Shell/Python 语法、脚本 dry-run/help smoke test
  - [x] 所有脱敏 Compose 模板通过 docker compose config

- [x] **工程规范验证**
  - [x] pnpm check:secrets（通过）
  - [x] git diff --check（通过）
  - [x] 4 个 Skills 符合 skill-creator 规范
  - [x] deploy-langbot.sh 语法验证（bash -n）
  - [x] Git 仓库干净并成功推送到 origin/main

- [x] **WhatsApp 暂缓验证**
  - [x] 确认 WhatsApp 代码仅作为静态导出
  - [x] 确认无默认启用配置
  - [x] 确认不影响 KOOK / Telegram runtime
  - [x] Cloudflare Tunnel 配置保留

## 会话启动协议

新会话先读取：

    README.md
    docs/ARCHITECTURE.md
    docs/PROJECT_STATE.md
    docs/CURRENT_TASK.md
    docs/PROJECT_MAP.md
    .agent/state.md

然后执行：

    git status --short --branch
    git log -5 --oneline --decorate

按需读取 skills/*/SKILL.md 了解特定工作流程。

## 后续工作规则

任何后续部署或运行时变更必须：

1. 遵循 AGENTS.md 中定义的全局工程规则；
2. 使用相应的 Codex Skills（如 langbot-development、n8n-workflow-development）；
3. 确认目标是 OrbStack ubuntu 内的 CasaOS；
4. 只从外部 secret store 恢复 credential；
5. 更新本文件、docs/PROJECT_STATE.md 和一个新的 checkpoint；
6. 跑与改动匹配的测试以及 pnpm check:secrets。

## 恢复条件

1. 获得 WhatsApp Business API 商业版授权
2. 明确所需的消息模板、会话状态和 webhook 验签能力
3. 完成与现有 runtime 的集成测试和性能基准

## 恢复操作

1. 重新评估 Meta Cloud API 最新能力与合规要求
2. 更新 docs/CURRENT_TASK.md 状态
3. 启用 apps/agent-runtime/src/platform/whatsapp 相关代码
4. 配置 Cloudflare Tunnel 和 LangBot webhook 集成

## 下一个潜在任务

当前代码阶段没有未完成的本地实现；后续仅需按 `.agent/tasks/homehub-runtime-smoke.md` 在目标
Ubuntu/CasaOS 环境执行人工烟测。WhatsApp 接入已按需求暂缓。可以支持：
- Codex 新会话从 Git 恢复上下文
- Mac mini 迁移使用已建立的恢复流程
- LangBot 和 n8n 变更遵循文档化的工作流程
- 使用 deploy-langbot.sh 进行安全的插件/patch 部署
- 在满足恢复条件后重新启动 WhatsApp 接入工作

如需开始新阶段，请更新此文件中的"当前阶段"和"完成清单"。
