# Project State

## Product Radar stalled similarity feed recovery（DEPLOYED / VERIFIED：2026-09-09）

线上 Similarity Watch 之所以两天没有有效检查，不是正常的“0 匹配”：两个 Bunjang 高结果量查询在无 watermark 的首次扫描触及 500 条/10 页安全上限，旧实现因此永远拒绝建立初始 watermark，产生 `WATERMARK_NOT_REACHED`。与此同时，changedetection 虽按时抓取动态 Bunjang 页面，却提取不到可比较的文本，因而未触发 webhook；Product Radar 当时没有独立的 due-feed scheduler。

- 首次截断扫描现在将最新 listing 安全写为静默 baseline，并将订阅游标推进到该 baseline 后，保证不会为存量历史商品发送通知；后续轮询只处理 watermark 之前的新商品。
- Product Radar runtime 每 30 秒检查一次 due Feed，实际执行仍服从 Feed 的 interval、deterministic jitter 与 backoff。changedetection webhook 继续保留，但不再是 Bunjang SearchFeed 的唯一执行条件。
- baseline 和正常执行均写入 Watch runtime 计数；状态卡的 Watch 总计与 per-Feed 总计因此可相互验证。
- 47/47 tests、typecheck、build、secret scan 和 diff check 均通过。commit `58a5305` 已 push；image `local/product-radar:git-58a5305f94e6`（digest `sha256:3b51f6efb4ade8a4b359229ebf06af8816bcd0936cb7d554f2203e4eab55061f`）已在 CasaOS 激活，回滚备份为 `.codex-backup.20260909-163000` / `.env.codex-backup.20260909-163000`。
- 部署启动 sweep 已对现有 Watch 成功建立两个 baseline：Watch runtime `2 / 2 / 0`（检查/成功/失败），两个 Feed 均为 ACTIVE 且各有 watermark 与成功运行。Product Radar healthy、`/health=ok`、doctor 0 failure / 0 warning；没有手工创建、删除或修改 Watch，也没有手工通知。

## Product Radar rich status presentation（DEPLOYED / VERIFIED：2026-09-09）

LangBot Product Radar 的单条状态和多条汇总现在复用同一份完整可观测性展示，避免“状态查询”比“统计查询”遗漏关键数据：

- `runningForSeconds` 显示为中文可读时长；`lastRunAt` / `nextRunAt` 显示为相对的天、小时、分钟、秒，而非 ISO 时间或原始秒数。
- 展示 Core 已返回的检查、成功、失败、新商品、候选处理、图片对比、达到阈值、最高相似度、通知、Token/calls，以及每个 Feed 的累计运行计数和最后错误。
- 这只是 LangBot presentation boundary 变更：不修改 Product Radar Core、调度、数据库或真实 Watch；DEGRADED 的 `WATERMARK_NOT_REACHED` 等原因会被如实呈现。
- 本地 33/33 plugin tests、Python compile、workflow plan、secret scan 和 diff check 通过。commit `71183b9` 已 push；plugin `0.5.3` 的 LangBot task `111` 已 `INSTALL_READY`，package SHA-256 `44e49a6a4ca163d0ae04d2000265c8fa79a189a9616b22a858b6405582fcea05`，rollback dir `.backups/langbot/20260909-161810`。
- `scripts/doctor.sh` 为 0 failure / 0 warning；Product Radar `/health=status=ok` 且 healthy/running，LangBot/plugin runtime running。真实 Telegram/KOOK 渲染 smoke 仍待用户发送状态查询。

## Product Radar V0.3.1 Runtime Observability（DEPLOYED / VERIFIED：2026-09-09）

本轮在既有 Generic Query Runtime/NLU、shared SearchFeed 和 deterministic Core 边界上增加运行可观测性，没有引入 PUBG-specific parser、第二次 Vision、FashionSigLIP/DINO/Qdrant 或抓取绕过：

- SQLite 采用 additive migration，持久化 Watch runtime stats/history、SearchFeed run/success/error/backoff、usage ledger、24h heartbeat delivery 和 `platform + chat + sender + domain` opaque context binding。
- `GET /api/watches/:id/status|stats|usage` 返回状态、运行时计数、Feed 健康、last/next run、相似度/通知/token；实际通知送达才递增 `notificationsSent`，0 match 不降级。
- Luna intent/TargetProfile 单次 multimodal structured parse 的 provider usage 记账到对应 Watch；轮询、SearchFeed、Sharp matcher 不新增 LLM 调用或 token 账本记录。
- Similarity Watch 默认启用 24h heartbeat；period/channel/recipient 唯一约束保证幂等，通道失败互不阻塞并由 outbox 重试；LangBot status/stats 语义复用 active context。
- 插件重载后从 Product Radar 恢复精确 ownership context，使“取消监控/不要盯着了”继续进入 deterministic delete path；无法唯一确定时澄清，不猜测删除。
- 本地验证已通过：Product Radar 46/46、typecheck/build、LangBot 23/23、Python compile、secret scan、diff check；根测试 129 pass / 1 skip。
- source commit `a446838fc992` 已 push 到 `origin/main`；Host BuildKit 构建并导入 `local/product-radar:git-a446838fc992`，digest 为 `sha256:933c98b5b184b655517735d3677762a420c06c86cf4eda85d6848018eeb5f4c8`；CasaOS 已执行 `docker compose up -d --no-build`，回滚备份为 `.codex-backup.20260909-144144` / `.env.codex-backup.20260909-144144`。
- LangBot Product Radar plugin `0.5.0` 已安装，task `97` 为 `INSTALL_READY`，package SHA-256 为 `17ee72dadfe014715f47863e8e086eeb85f8b6fb00e4d885ad4adc7d0a81bc04`，rollback dir 为 `.backups/langbot/20260909-144208`；`scripts/doctor.sh` 为 0 failure / 0 warning。
- live `/health` 为 `ok`，既有 3 个 Watch、2 个 SearchFeed、2663 个 listing 保持；迁移已把历史 4 条 SearchFeed run 回填为每个旧 Feed `runCount=2/successCount=0/failureCount=2` 与 `WATERMARK_NOT_REACHED`；status API 返回 Product Watch HEALTHY、两个 Similarity Watch DEGRADED（原因是历史 watermark gap），未创建/删除真实 Watch，未发送手工 Telegram/KOOK 通知。由于现有 3 个历史 Watch 尚无可恢复的旧 ownership binding，多目标取消仍会澄清，不会猜测删除。

## Product Radar numbered watch selection UX（DEPLOYED / VERIFIED：2026-09-09）

本次只改 LangBot Product Radar plugin 的交互边界，不修改 Product Radar Core 或现有 Watch 数据：

- `watch_presentation.py` 将列表按 API 返回顺序渲染为 `1号 / 2号 / 3号`，删除选择按钮的 callback data 使用 `pr1:delete:<watchId>`。
- “取消监控”输出选择菜单；Telegram 通过现有 inline keyboard marker 发送按钮，KOOK 等无按钮平台保留 `取消1号` 文本 fallback。
- 已显示列表的序号会以 caller context 保存；Luna structured command 支持 `watchOrdinal`，离线 fallback 也支持 `取消1号`、`查看1号`、`第2个监控的记录`。
- 删除操作完成后重新读取 `list_watches` 并在同一条回复中返回最新列表；回调只接受当前 caller 最近一次列表中的 Watch ID。
- 本地验证：LangBot plugin tests 29/29、Python compile、`git diff --check`、`pnpm check:secrets`。
- source commit `0de93ca` 已 push；LangBot plugin `0.5.1` 安装 task `102` 达到 `INSTALL_READY`，package SHA-256 为 `ebcb43cd290b7634727be8ac3bc3ca21c38dbf7c07780ac63b06a1736a34fa5f`，rollback dir 为 `.backups/langbot/20260909-152749`。
- 部署后 `scripts/doctor.sh` 为 0 failure / 0 warning；`product-radar`、changedetection、LangBot/plugin runtime 均 running/healthy；Product Radar `/health` 为 `ok`，API 仍返回 3 个既有 Watch。未重建 Product Radar runtime image，也未创建/删除/修改真实 Watch。
- 尚未发送真实 Telegram/KOOK 测试消息；平台入站 smoke 仍待用户在目标会话完成。

## Product Radar status query fallback（DEPLOYED / VERIFIED：2026-09-09）

16:01 的真实 LangBot 日志显示，用户消息 `监控的怎么样了` 已进入 LangBot，但 Product Radar 的 Luna intent call 报 `ActionCallError`；Product Radar listener 因此返回未处理，后续普通聊天生成了“之前那件红色羽绒服的监控已经取消”等错误语义。Product Radar API 实际仍有 1 条 enabled Similarity Watch，状态为 `DEGRADED`，两个 Feed 的 `lastError` 都是 `WATERMARK_NOT_REACHED`。

- `intent_planner.py` 增加窄范围、明确 Product Radar 语义的 status offline fallback，Luna 暂时失败时不会让清晰的状态询问落入普通聊天。
- `product_radar.py` 对没有指定 Watch 的 status/stats 请求按当前列表汇总；单条暂停或降级 Watch 也能返回真实状态；Feed 错误会显示在状态行中。
- 本地验证：LangBot plugin tests 31/31、Python compile、`git diff --check`、`pnpm workflow:plan`。
- source commit `00e6889` 已 push；LangBot Product Radar plugin `0.5.2` 安装 task `109` 达到 `INSTALL_READY`，package SHA-256 为 `3105e395b73344cea48dd78294f917200083ccafa9bdbd5a77fab69ecd3b0912`，rollback dir 为 `.backups/langbot/20260909-160922`。
- 部署后 `scripts/doctor.sh` 为 0 failure / 0 warning；相关容器均 running/healthy，Product Radar `/health` 为 `ok`，API 仍为 1 条 enabled Watch。未重建 Product Radar runtime image，也未创建/删除/修改真实 Watch。
- 尚未发送真实 Telegram/KOOK 测试消息；平台入站 smoke 仍待用户发送“监控的怎么样了”。

## Product Radar cancellation routing fix（DEPLOYED / VERIFIED：2026-09-09）

截图反馈对应的根因是 Product Radar fallback 将 `取消监控` 无条件编码为 pending proposal 的 `control=cancel`；当已有 Watch 时 listener 只清理 proposal，或在无 proposal 时回复“没有对应的待确认监控”，不会调用删除 API。现已改为按当前 ownership-aware context 分流：pending proposal 才 cancel，active Watch 执行 `delete_watch`，无唯一上下文则 clarification；`不要盯着了` 等自然停用表达也复用 active Watch 删除路径。

- Source commit：`bc8d140220a82b429a84982e0e9f207bcf729f20`，已 push 到 `origin/main`。
- LangBot plugin task `89` 已 `INSTALL_READY`；live manifest version/label 为 `0.4.1`。
- LangBot Python tests 19/19、Python compile、secret scan、diff check 通过；部署后 Product Radar `healthy`、`/health=ok`，既有 3 个 Watch 保持不变。
- 未发送真实 Telegram/KOOK 消息；需用户在原会话重试以验证真实 inbound/delete delivery。若 active context 已因重启过期，应指定商品 URL 或 Watch ID，避免跨用户误删。

## Product Radar V0.3 Phase A hardening（DEPLOYED / VERIFIED：2026-09-09）

本轮在既有 Luna/Mastra/NLU 与 V0.3 shared-feed 架构上做边界硬化，没有引入 PUBG-specific parser，也没有新增视觉模型或抓取绕过：

- TargetProfile 增加可向后兼容的 `userSearchTerms`；用户词保持 `user` provenance，provider-derived explicit terms 不覆盖用户条件。Bunjang planner 支持 modelName，并在最多四条 query 内选择 explicit、specific、medium、broad 层。
- SearchFeed 扫描改为完整抓取/解析后事务提交 listing/event；中途失败和 `WATERMARK_NOT_REACHED` 保持原 watermark、无 partial candidate/notification。Retry-After 进入 backoff，legacy similarity 删除不会误删仍被共享 feed 使用的 sensor。
- preview 摘要显示实际 similarity threshold 与 Sharp perceptual matcher；LangBot plugin manifest 升至 `0.4.1`，仍由 GPT-5.6 Luna 在一次 multimodal call 输出 intent/entities/TargetProfile。
- 本地验证：Product Radar TypeScript 42/42、typecheck/build、LangBot Python 16/16、Python compile、secret scan、workflow plan、diff check 均通过。
- source commit `0cdba7c37a6a09a0740eedabd17b9adabb511682` 已 push；immutable image `local/product-radar:git-0cdba7c37a6a` 已在 OrbStack `ubuntu`/CasaOS 激活，digest 为 `sha256:ef5c7309eae244cd6c9c2ef9d566f4f4e7a27f9d72474a93bde355dd3f1bb7db`。外部 `.env` 与 compose 备份分别为 `.env.codex-backup.20260909-114724`、`.codex-backup.20260909-114724`；changedetection `0.60.3` 与 datastore 未变更。
- LangBot Product Radar plugin `0.4.1` 已安装并达到 `INSTALL_READY`（task `84`，package SHA-256 `09d0783fbe072999bf0b8f10a48c9b09adbcb6fc8f73e881cfa08ea7c33c90f3`，rollback dir `.backups/langbot/20260909-114754`）。live `/health` 为 `status=ok`，既有 3 个 Watch（1 Product、2 Similarity）保持不变，`scripts/doctor.sh` 为 0 failure / 0 warning。未发送真实 Telegram/KOOK 消息，真实平台送达仍待人工入站 smoke。

## Product Radar Generic Natural Language Intent Parsing（DEPLOYED / VERIFIED：2026-09-09）

Product Radar LangBot source 已从旧的固定文本/图片 fallback 入口升级为独立的通用语义边界：

- `components/platform/normalized.py` 统一 inbound message、attachment、callback 与 ownership key；Telegram raw message 优先使用真实 `from.id` / `chat.id`。
- `components/intent_planner.py` 以 GPT-5.6 Luna 输出 `domain + intent + watchType + entities + constraints + targetProfile`；非 Product Radar 消息返回 none，图片-only 不进入路由。
- `components/context.py` 按 `product_radar + platform + chat + sender` 管理 active Watch/pending proposal；`command_adapter.py` 将结构化结果转成 deterministic Core API payload。
- listener 支持 create/list/get/update/pause/resume/delete，并复用 active Watch 解析价格、频率、品牌等 follow-up；Product Radar Core 不再被 listener 交给第二次 Vision/NL extraction。
- 新增 paraphrase、negative routing、multimodal 单调用、explicit-over-vision、Telegram identity 和 context isolation 回归；LangBot Python 16/16、Python compile、secret scan、plugin dry-run 通过。
- 插件 source manifest 已升至 `0.4.0`。commit `9888e3c58ca5b8cd4fb37b202fb4abc0a3f70bf2` 已 push 到 `origin/main`，并通过 LangBot plugin API 安装；task `83` 达到 `INSTALL_READY`，package SHA-256 为 `7ed45be07f37c9911b50c0bdac8087bb883de0876a1c20108b4826047e34cfc9`，rollback dir 为 `.backups/langbot/20260909-111116`。
- live 核验：OrbStack `ubuntu` 的 `product-radar` `healthy/running`，LangBot 与 plugin runtime running；Product Radar `/health` 为 `status=ok`，`GET /api/watches` 保持既有 3 个 Watch（1 Product、2 Similarity）；`scripts/doctor.sh` 为 0 failure / 0 warning。未执行 Docker build 或 CasaOS Compose 变更，未创建测试 Watch，未发送真实 Telegram/KOOK 消息；人工平台入站 smoke 仍待用户完成。


## Product Radar Language Intent Planner（DEPLOYED / VERIFIED：2026-09-08）

Product Radar LangBot UX 已增加类似 PUBG planner 的意图解析边界：

- deterministic fast path 处理明确控制词；
- 对模糊 inbound text 使用一次性 LLM JSON intent extraction；
- `list/confirm/cancel/stop/watch/none` action 由 listener 路由；
- provider error 仍 fallback，不影响图片 Watch 创建；
- 不参与 15 分钟 SearchFeed polling。

最终 plugin task `71` 为 `INSTALL_READY`，Python tests 9/9 通过。


## Product Radar existing Watch list / bot offline diagnosis（DEPLOYED / VERIFIED：2026-09-08）

用户输入 `我在盯着什么` 时，旧 intent 只识别 `我现在盯着什么`，导致 Product Radar list listener 没有稳定命中。现已修复并部署 task `67`：

- Product Radar API 当前有 3 个 Watch：1 个 Product Watch、2 个羽绒服 Similarity Watch。
- Plugin runtime 到 `product-radar:5315/api/watches` HTTP 200。
- LangBot/Telegram/KOOK 容器运行中，近期 Telegram outbound success 可见；没有证据表明 bot 进程全部离线。
- `/watches` 与自然语言列表现在显示实际 Similarity query，不再显示空 target。


## Product Radar active Watch 取消监控修复（DEPLOYED / VERIFIED：2026-09-08）

用户反馈 active Watch 回复“取消监控”无法真正停止。LangBot listener 原来只把“取消监控”当作 pending proposal cancel，现已修复：

- pending proposal：`取消监控` 仍只取消 proposal。
- active Watch：`取消监控` 调用 active stop path，PATCH `enabled=false` 并 pause Feed sensor。
- plugin reload 后没有 in-memory conversation mapping 时，唯一 active Similarity Watch 可安全匹配；不会影响 Product Watch。
- final LangBot plugin task `58` 为 `INSTALL_READY`。


## Product Radar image + 用户文字 Timeout Hotfix（DEPLOYED / VERIFIED：2026-09-08）

针对用户图片 + `帮我盯着这件羽绒服` 报错 `Product Radar unavailable: TimeoutError`：

- Runtime image 已更新为 `local/product-radar:git-49725f014c47`（digest `sha256:77d54cfcd93baf4e728a44ba1dac85742c87b29c0b54e9ea64ccca0c5ed56c53`）。
- Preview 现在并行查询多个 SearchPlan query、并行准备 reference image，并限制 preview Sharp scoring 为 12 个候选。
- LangBot plugin task `51` 为 `INSTALL_READY`，HTTP client 默认 timeout 为 90 秒且支持外部覆盖。
- 真实羽绒服图 `363252234` + 用户文字测试：preview 200 / 19.18s / 103 candidates / queries `패딩`+`다운 자켓` / 0 warnings；临时创建 201 / 900s / baseline 494 / 0 baseline notifications；测试 Watch 已删除。
- Product Radar、changedetection healthy；原 Product Watch 仍为 enabled、120 秒。


## Product Radar Bunjang Search Response Hotfix（DEPLOYED / VERIFIED：2026-09-08）

用户反馈 `Bunjang search response did not contain a product list` 后，新增 parser resilience 和 preview partial-failure handling：

- Parser 兼容当前/历史 Bunjang response 的嵌套结果数组与 `nextCursor`。
- Preview 不再因一个 query 的 transient malformed response 直接失败；成功 query 仍生成 TargetProfile/SearchPlan/candidate preview，异常 query 写入 `searchWarnings`。
- 最终 image-only live preview 返回 54 candidates、0 warning；runtime image `local/product-radar:git-23836b200afe`，health `ok`。
- 最终真实 Watch、数据库 snapshot、changedetection sensor、notification outbox 均保持正常。


## Product Radar V0.3 Phase A（DEPLOYED / VERIFIED：2026-09-08）

V0.3 Phase A 已在 V0.2 之上完成源码实现并实际部署到 OrbStack `ubuntu`/CasaOS：

- `apps/product-radar/src/core/target-profile/` 提供 TargetProfile schema、provenance、hard/soft constraint merge 和 provider failure fallback。
- `apps/product-radar/src/core/search/` 提供 SearchPlan、SearchFeed、deterministic scheduling/backoff、incremental pagination、feed router；`sources/bunjang/search-planner.ts` 只承载 Bunjang localization。
- SQLite migration additive：`target_profiles`、`search_feeds`、`watch_feed_subscriptions`、`feed_listing_events`、`search_feed_runs`；V0.2 watches/listings/events/outbox/image features 不删除。
- 本地验证：Product Radar TypeScript 38/38、LangBot Python 7/7、Python compile、Product Radar typecheck/build、secret scan 已通过；部署前 workflow 分类为 `RUNTIME / PRODUCT_RADAR`。
- 部署 image：`local/product-radar:git-8b0b96e4c2c6`（digest `sha256:a60b0b75eaaa192c0fbecc7ba442323b607d0a7f20d193011131066beaa35d26`）；CasaOS env rollback backup：`/var/lib/casaos/apps/product-radar/.env.codex-backup.20260908-130726`。
- LangBot plugin task `41` 为 `INSTALL_READY`，Product Radar/changedetection/LangBot containers healthy/running；LangBot model registry 已确认包含 `gpt-5.6-luna`，Product Radar vision plugin 默认使用该 UUID；最终 Product Radar `/health` `ok`，原 Product Watch `9ec10408-e55b-43a8-821b-f3427005656e` 保持 enabled、120s，最终 0 SearchFeed/0 test subscriptions。
- Real smoke baseline 222（one explicit feed）与 full layered preview 1225 候选均未通知；webhook rerun `newListings=0`, `matchedListings=0`, `eventIds=[]`，duplicate webhook 返回 `status=duplicate`；restart 后 TargetProfile/SearchPlan 仍可读。
- 运行时保留 Sharp matcher、0.60 business threshold、Telegram/KOOK DM、确认/取消/停止、Seller/Product Watch。


更新时间：2026-09-07（Asia/Shanghai）

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

## Codex Global Completion Notification Bridge：DEPLOYED / VERIFIED（2026-09-06）

全局 Codex notify 已写入 `/Users/blacksidev/.codex/config.toml` 的 root-level `notify`，实际执行
`/Users/blacksidev/.codex/bin/codex-notify.sh`；source 为 Git 中的 `integrations/codex/codex-notify.sh`，
所以其他仓库和 `/tmp` 等 cwd 也能使用。脚本接受 Codex legacy argv payload，只处理
`agent-turn-complete`，归一化 completion 字段，使用 2 秒连接/5 秒总 timeout，网络失败 fail-open，日志
不记录 payload 或 secret。

n8n `Codex Completion Notification`（ID `codex-completion-notification-20260906`）已激活，Webhook
`/webhook/codex-complete`。它校验外部 `CODEX_NOTIFY_SECRET`，用唯一 Data Table
`codex-completion-idempotency-20260906` claim `threadId + turnId`，再通过现有 LangBot Platform
Adapter sender 同时发送 Telegram/KOOK 固定 `person` DM。目标只读取 global variables
`TELEGRAM_ADMIN_USER_ID` / `KOOK_ADMIN_USER_ID`，不读取 inbound chat、channel、context 或 payload recipient；
两个平台失败互不阻塞并记录 `sent/failed`。

实际证据：global Codex turn（cwd `/tmp`）成功触发 n8n（production execution `2968`），双平台均 sent；最终
runtime smoke execution `2992` 的发送目标类型均为 `person` 且与当前 Admin variables 匹配；runtime smoke 验证缺 secret 401、
安全 projectName、重复事件 duplicate suppressed；受控双向 failure-isolation 验证 Telegram failed/KOOK
sent（execution `2981`）与 Telegram sent/KOOK failed（execution `2989`），随后恢复真实外部 variables。最后一次 workflow rollback backup 位于
`/home/node/.n8n/workflow-backups/codex-codex-completion-notification-20260906-before-20260906-114742.json`。
真实 shared secret、LangBot API credential、Admin IDs 和 n8n variables 不入 Git。

## HomeHub Docker Executor + PUBG KD 修复：DEPLOYED / VERIFIED

HomeHub source 已新增受限 `DockerApiCommandExecutor`，通过只读 Docker socket 使用 Docker Engine API，
严格限制 Service Registry 中的容器名和 `ps` / `inspect` / bounded `logs` / `stats` 观察；变更只允许
`start` / `restart`，不再调用 Docker Compose，也不会提供 `exec`、`run`、`rm` 或任意 shell passthrough。
Docker socket 不可用、权限失败或 daemon 不可达时保持 `UNKNOWN`，不会误判为 `DOWN`。

runtime compose 模板已声明 `/var/run/docker.sock:/var/run/docker.sock:ro` 和 `DOCKER_SOCKET_GID`，
HostCollector 默认不读取容器自身 `/proc` 作为 macOS Host 指标；无 macOS Host Executor 时 CPU、内存和
主机状态为 UNKNOWN，并返回 `macOS executor unavailable` 原因。新增 `GET /status` 可输出真实 Docker
service inventory。生产 canonical compose 仍需执行 `scripts/deploy-homehub-docker-socket.sh --apply`，
随后由 `scripts/smoke-homehub-docker.sh` 完成实际容器内验证。2026-09-06 实际运行验证通过：
image `local/pubg-query-engine-v3:git-1a8a825812b6`，compose rollback backup
`/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260906-105507`，socket
为只读 bind mount、UID 1000 node 通过 GID 104 访问；7 个 allowlisted containers 被 client 列出，
`GET /status` 返回 8 healthy、3 down（postgres/redis/glances 不存在）、1 unhealthy（Jellyfin 日志错误）
和 1 unknown（macOS cloudflared），没有全量 UNKNOWN。主机指标保持 `UNKNOWN` 并明确说明无 macOS executor。

## 2026-09-06 快速 Bug 修复：DEPLOYED / VERIFIED

PUBG KD 展示层已统一为 1 位小数：TypeScript runtime、legacy V2 Python renderer 和 legacy n8n
`PUBG 今日战绩` workflow 均已更新；内部 KD 仍保留数值精度用于排序，零死亡分母显示 `—` 而不是 `∞`。

macOS NAS status 已升级为 V2 结构化数据与移动端卡片，补充 macOS 版本/build、型号、CPU、load、uptime、
登录用户、内存、系统盘/Avalon、网络/网关、电源、cloudflared 和高占用进程；`df -Ph` 修复了磁盘单位被
block 数字覆盖的问题。NAS plugin manifest 为 `0.1.4`，外部 forced-command 安装通过 Git-owned
`scripts/deploy-nas-control.sh` 管理，默认 dry-run，apply 时保留 timestamped rollback backup。

Telegram patch 在 outbound API、Markdown conversion 和 streaming path 过滤完整/未闭合 `<think>` block，
think-only message 会被抑制；HomeHub status 不会把容器 CPU/内存冒充 macOS 主机指标，UNKNOWN 原因改为
中文说明，并将 executor unavailable 的服务行本地化。源代码与定向回归测试已完成；生产激活仍需提交干净
source 后执行对应 release/import/apply，LangBot plugin API key 继续只从仓库外恢复。2026-09-06 已完成 runtime
image `local/pubg-query-engine-v3:git-1b52d2c89f3e`、n8n daily-stats workflow、LangBot patched image
`local/langbot-agent:5a051b8756c4-20260906-132959` 和 macOS external forced-command 的实际部署与 smoke；
各 rollback backup 已记录在 docs/CURRENT_TASK.md。真实 `/v3/query`「最近20场战绩」已返回 KD `1.5 / 0.9 /
0.7 / 0.4`、合计 `1.0`，无 `∞`/`Infinity`；active LangBot virtualenv helper smoke 也已通过。
`macos-nas-control` v0.1.3 已通过外部 API key file 安装并初始化，active plugin runtime 真实 NAS formatter
smoke 通过；credential 仍不入 Git。

2026-09-06 追加修复 macOS APFS 根卷磁盘统计：`df` 的根系统 snapshot Used 不代表整个 APFS
container，NAS command 现在使用 `total - available` 计算实际占用，并输出 `使用率`；同时将 uptime
和 pmset 电源状态转换为中文。`macos-nas-control` `0.1.4` 已通过 LangBot Plugin API 重新安装，task `19`
和 active plugin runtime 真实 NAS formatter smoke 均通过；当前系统盘显示约 `424GiB / 460GiB`、使用率
`92.1%`，不再把 `16GiB` snapshot Used 当作整盘占用。

PUBG KD 修复同时覆盖 n8n v3 match normalization、runtime legacy record normalization 和 renderer：旧记录
缺失 `deaths` 时按 placement proxy 补齐；零死亡分母不再显示数学 `∞`，而显示未定义 `—`。源码定向与
完整 runtime tests 已通过，生产 `/status` smoke 也通过；零死亡 KD 不再向用户渲染 `∞`，而显示 `—`。
n8n `PUBG Sync Matches v3` 和 legacy `PUBG 今日战绩` 已从 Git workflow source 重新导入、激活并重启
n8n；外部 backups 位于 `/home/node/.n8n/workflow-backups/`。真实 runtime `最近20场战绩` smoke 返回
有限 KD（1.47、0.91、0.74、0.38，合计 0.96），response/JSON 不含 `∞` 或 `Infinity`。

## 状态

Monorepo 迁移、Codex 工程规范、HomeHub V1 和 HomeHub V1.1 Security & Runtime Reliability
实现阶段已完成；HomeHub V1.1 已通过测试并提交为 `e0a3ed5`，PUBG Intent Router 时间词误判 task
已通过 targeted verification 并以独立 commit `d12b733` 提交。生产 runtime 已在 OrbStack `ubuntu` / CasaOS
使用 immutable image `local/pubg-query-engine-v3:git-46efb62eba0c` 部署并验证 healthy。仓库继续作为代码、
配置模板、workflow、文档和 Codex 状态的 Git source of truth；没有把运行时数据或真实 credentials 放入仓库。

## Telegram / KOOK `Request Failed` 事故：RESOLVED / VERIFIED（2026-09-05）

2026-09-05 晚间 KOOK 和 Telegram 均出现多条 `Request Failed`。只读检查确认这不是两个平台
适配器同时掉线，而是它们共用的 LangBot `arthur-combo` 模型请求链路认证失败：LangBot 的
`9Router` provider 仍保存一个 3 字符的旧/占位 API key，而 9router 本地数据库当前 active key
为另一把 35 字符 key。使用前者访问 `http://9router:20128/v1/models` 返回 HTTP 401
`API key required for remote API access`；使用后者返回 HTTP 200。

最近一批错误为：KOOK 23:13:57、23:14:31、23:14:47；Telegram 23:14:55、23:41:47、
23:41:50（Asia/Shanghai）。平台传输仍有成功记录，Telegram/KOOK `/whoami` 和部分普通消息
可出站；LangBot、插件 runtime、9router 和 Mastra runtime 容器仍在运行，`scripts/doctor.sh`
报告 0 failure / 0 warning。

用户已在 LangBot 管理界面修正 provider credential。复核确认 LangBot provider key 与 9router
active key 完全一致，访问 `/v1/models` 返回 HTTP 200；修复后 Telegram 私聊和群聊测试均成功
完成流式回复，用户确认 KOOK 与 Telegram 均恢复。未重建镜像，LangBot 也无需重启。

修复过程和回滚步骤保留在 `.agent/tasks/2026-09-05-kook-telegram-request-failed.md`，本次
完成记录见 `.agent/checkpoints/2026-09-05-kook-telegram-request-failed-resolved.md`。
9router 同时存在 Kiro OAuth `invalid_grant` 和 Codex Luna 短时 account lock 告警，属于独立的
上游可用性问题，修复 key 后仍需观察 fallback。

## Developer Workflow Optimization V1：COMPLETE（未部署）

开发/验证/部署已采用 FAST / RUNTIME / RELEASE 分层。`scripts/developer-workflow.sh` 依据 Git diff
识别 docs/tests/.agent、HomeHub/runtime source、Docker/package/lockfile、LangBot plugin/patch 和 env-only
scope，并默认选择最低足够流程。普通 HomeHub/runtime TS 修改进入 RUNTIME：typecheck/build、映射后的
定向 tests、非 Docker `/healthz` + `/homehub/health` smoke；不会自动 Docker build、Compose restart 或
CasaOS deploy。

`apps/agent-runtime/Dockerfile` 已改为 manifest/lockfile -> BuildKit cached `pnpm install` -> source ->
build/deploy，且 production stage 使用 `COPY --chown` + 单独 `/data` 创建。2026-09-05 host BuildKit
实测：原 Dockerfile 单一 HomeHub source 改动 build 为 132.25s（`pnpm install` 114.0s），新 Dockerfile
为 22.37s（install `CACHED`），减少 83.1%；最终 image 从 474,477,455 B 至 360,758,644 B（-24.0%）。
优化 image 的容器 `/healthz` 和 `/homehub/health` smoke 已通过。

新增 `scripts/deploy-agent-runtime.sh` 默认 dry-run；显式 apply 一律使用
`docker compose up -d --no-build`。只有干净已提交 source 下的 `--apply --build` 执行 tests、secret scan、
host Buildx immutable commit-tag image build、transfer 到 Ubuntu、compose update、health/smoke 与 rollback
compose backup。此阶段未传入或部署新 image，当前 CasaOS runtime 仍保持既有 `3.3.4-admin-03b0e41`。
详见 `docs/DEVELOPER_WORKFLOW.md`。

## Codex Goal 预算策略

仓库根目录 `AGENTS.md` 与用户级 `/Users/blacksidev/AGENTS.md` 均规定：禁止为 goal
手动设置、指定、增加或限制预算；调用 `/goal` 或 `create_goal` 时不得传入 `token_budget`，
只能使用 Codex 默认预算机制。该约定不覆盖 Codex 平台自身的系统上限；达到系统上限时应在
新的任务或会话继续。

## HomeHub `/whoami` 状态：IMPLEMENTED / DEPLOYED / INBOUND SMOKE PENDING

只读 `/whoami` 已进入 Git source of truth。runtime 提供 `/whoami`、`/homehub/whoami` 和
`/v3/whoami` POST aliases，LangBot V3 plugin 注册 `/whoami` Command。输出同时包含文本和
结构化 `data`/`PresentationModel`，字段为 `platform`、`platformUserId`、`chatId`、
`chatType`、`displayName`、`internalUser`、`role`。

身份解析只使用平台事件归一化后的 `NormalizedBotMessage.user.platformUserId`：Telegram
来源是事件 `from.id`，KOOK 来源是事件 `author_id`（或 Adapter 暴露的同一稳定 sender ID）。
未建立映射时输出 `internalUser: unbound`、`role: unbound`；昵称、用户名和 display name
不参与身份判定。

`/whoami` 不读取或写入 Context，不调用 DataProvider、ActionEngine、审计或危险工具。当前
runtime 镜像已在 OrbStack ubuntu/CasaOS 健康运行，LangBot V3 plugin 3.2.4 已通过本地 API
安装并 ready；真实 Telegram/KOOK 入站事件烟测仍待执行。

部署记录：Git `main` 已推送至 `origin`，runtime 镜像为
`local/pubg-query-engine-v3:3.3.3-whoami-ddfee46`（image id
`sha256:4e902c2b578777be6c42733d180da5dc8e72e883139611833856504d336b8383`），CasaOS compose
回滚副本位于 `/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260905-214712`。

## `/whoami` 平台来源修复状态：DEPLOYED / RECHECK PENDING

已修复 LangBot command event 缺少 `platform` 导致 Telegram 被当成 KOOK 的问题。当前
LangBot 与 plugin runtime 使用 `local/langbot-agent:1adbc1d-whoami-display-20260905`，其中
`PersonCommandSent`/`GroupCommandSent` 会从 `query.adapter` 传递真实平台；plugin gateway
监听 command event 后才调用 `/v3/whoami`。等待真实 Telegram 用户再次发送命令确认最终入站输出。

## Admin Identity 配置状态：DEPLOYED / INBOUND RECHECK PENDING

runtime 启动配置读取 `TELEGRAM_ADMIN_USER_ID` 和 `KOOK_ADMIN_USER_ID`，配置值存在时只按
平台稳定 ID建立同一个 `arthur` / `ADMIN` mapping；缺少或占位值时不建立绑定。真实值已
写入本机被 Git 忽略的 `.env`，没有写入源码或 `.env.example`。CasaOS runtime 已通过外部
env 文件加载这两个变量并重启生效；真实 Telegram/KOOK 入站复测仍待执行。

active runtime image：`local/pubg-query-engine-v3:3.3.4-admin-03b0e41`；外部 identity env
file：`/DATA/AppData/pubg-query-engine-v3/admin-identity.env`。回滚 compose 副本和部署过程
记录在 `.agent/checkpoints/2026-09-05-homehub-admin-identity-deployment.md`。

## 当前运行时观察

以下信息来自本机 Ubuntu/CasaOS 的只读检查，用于迁移基线，不是新机器的硬编码地址：

| 组件 | 当前观察 |
| --- | --- |
| OrbStack machine | ubuntu running |
| LangBot | langbot + langbot_plugin_runtime，镜像 local/langbot-agent:1adbc1d-whoami-display-20260905，兼容 LangBot 4.10.8 定制镜像 |
| 9router | 9router running；`/api/health` 可用；LangBot provider key 已与当前 active API key 同步，`/v1/models` 验证通过 |
| Mastra/PUBG runtime | pubg-query-engine-v3，镜像 local/pubg-query-engine-v3:3.3.4-admin-03b0e41，healthy，端口 5310 |
| Telemetry | 嵌入 runtime，parser telemetry-parser-5 |
| Review | feature version review-features-5 |
| n8n | n8n running，主机端口 5679 |
| n8n sandbox | compose 已存在，TLS/data 在 /DATA/AppData/n8n-sandbox |
| Postgres / Redis | 当前 Ubuntu 可观察到共享服务；n8n 是否使用 Postgres 需以恢复后的 env 和连接测试为准 |
| Cloudflare Tunnel | 当前容器列表未发现 tunnel；仓库只提供配置模板和检查逻辑 |

Runtime 的 PUBG API key 使用 /run/secrets/pubg_api_key 文件注入；仓库只保存
secret file 路径和空的环境变量，不保存 key。

## 已归档

- Mastra/PUBG V3 runtime、Telemetry、Platform Adapter、WhatsApp 和测试；
- PUBG V2 Python domain、V2 LangBot plugin 和 legacy workflow；
- LangBot V3/V2、organize-emby、macOS NAS control 自定义插件；
- KOOK、Telegram polling、消息转换、PUBG picker、WhatsApp patch/resource；
- n8n V3/V2、PUBG daily stats、organize-emby workflow；
- CasaOS 架构与平台适配历史文档的脱敏归档；
- bootstrap、doctor、backup、restore、secret scan 和插件构建脚本；
- LangBot deploy dry-run/apply 脚本、项目地图和四个可迁移 Codex skills；
- workflow / plugin / service 兼容说明以及 Codex checkpoint。

## HomeHub V1.1 Security & Runtime Reliability 状态：IMPLEMENTED / TARGETED VERIFIED / COMMITTED / DEPLOYED（2026-09-05）

V1.1 已在 Git source 中完成统一授权、管理员身份、运行时执行边界和健康状态语义修复：

- `packages/homehub-domain/src/authorization/authorization-core.ts` 提供平台无关的身份映射和 Action policy；
- `packages/homehub-domain/src/execution/runtime-executor.ts` 提供 Docker、Ubuntu、macOS Host 和 LangBot Component executor；
- `ServiceRegistry` 为 LangBot、Telegram/KOOK、PUBG Runtime、n8n、Postgres、Redis、Emby、Jellyfin、qBittorrent、aria2、Glances、cloudflared 声明执行位置；
- HomeHub Entry / ActionEngine / organize-emby confirmation 使用精确 platform + chat + platform user + action 绑定；
- `HealthResult.summary` 增加 `down`，executor/observation failure 只产生 `unknown`，不会加入 `abnormal`；
- host metrics 失败保留 null，不回填 0%；`/homehub/authorize` 仅返回共享授权决策，不执行操作。

V1.1 的验证证据包括 affected typecheck、HomeHub security/runtime 定向测试、local endpoint smoke、Python plugin
compile、LangBot plugin dry-run/package validation、secret scan 和 diff check。代码已提交为 `e0a3ed5`，并已部署到 CasaOS；当前 image 为 `local/pubg-query-engine-v3:git-46efb62eba0c`。

## Production Deployment 状态：HEALTHY（2026-09-05）

- image：`local/pubg-query-engine-v3:git-46efb62eba0c`
- machine：OrbStack `ubuntu` / CasaOS
- compose：`/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml`
- rollback backup：`/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260906-012427`
- `pubg-query-engine-v3`：`Up (healthy)`
- `/healthz` 与 `/homehub/health`：HTTP 200 / healthy
- 首次 build 因 host proxy `127.0.0.1:7897` refused 失败，未触碰 compose；使用 `--no-proxy` 重试成功。
- 部署未修改 AppData、媒体库和 secrets。

## 后续 task 状态：PUBG Intent Router 时间词误判 / IMPLEMENTED / COMMITTED

TimeRange 已从正向 PUBG intent 中移除；router 先判断 Domain/Intent，再允许时间范围作为参数进入 planner。
结构化 active PUBG follow-up 只接受紧凑时间追问或 PUBG 对局引用，长技术句不会仅凭日期前缀继承 PUBG。
目标回归全部通过：“昨天战绩”进入 PUBG、“前天呢？”在 PUBG 上下文中进入 PUBG、硬件时序句不进入 PUBG、
“昨天 Emby 挂了吗”进入 HomeHub。代码与状态文档已单独提交；只运行 affected typecheck、targeted tests、
secret scan 和 diff check，未构建 Docker image 或执行 Release。

## HomeHub V1 状态：IMPLEMENTED / V1.1 PRODUCTION DEPLOYED

HomeHub V1 已进入 Git source of truth，包含：

- `packages/homehub-domain`：平台无关的服务 registry、schema、主机指标、健康诊断、操作授权、上下文和审计；
- `apps/agent-runtime/src/runtime/homehub-runtime.ts`：runtime facade 与健康/查询入口；
- `apps/agent-runtime/src/homehub`：HomeHub entry 与安全媒体整理操作器；
- `/homehub/health`、`/homehub/route`、`/homehub/query` 和 Telegram polling 诊断 endpoint；
- `/v3/query` 对 HomeHub 路由的分流，避免 HomeHub 请求落入 PUBG planner。

安全约束：服务操作按风险等级要求确认；媒体整理必须指定下载项目，先预览，再确认、备份并逐项移动，
只允许 `/Volumes/Avalon/downloads` 到 `/Volumes/Avalon/media/{movies,tv}`，拒绝覆盖已有目标。
V1.1 已在 OrbStack `ubuntu` / CasaOS 执行 `--apply --build --no-proxy` 并验证 healthy；真实 Telegram/KOOK 入站授权烟测仍需单独执行。生产部署 checkpoint：`.agent/checkpoints/2026-09-05-homehub-v1.1-production-deployment.md`。

## 已验证的边界

- 第三方 LangBot 本体没有复制进仓库。
- node_modules、dist、__pycache__、.pyc、.lbpkg、日志和业务数据未纳入 Git。
- 原始 9router / aria2 compose 中的真实密钥没有迁移，只生成脱敏模板。
- 共享 media、下载目录、Postgres、n8n data、LangBot data 与 Redis 都与 Git 分离。
- 新机器恢复路径是 clone -> 恢复 secrets -> bootstrap -> 恢复数据 -> 启动 -> doctor。
- LangBot plugin 从 Git 构建 `.lbpkg` 后通过 API 安装；LangBot patch 只在 overlay image
  构建阶段应用，不直接改运行容器。

## 待人工完成的运行时动作

这些不是 Git 迁移缺口，而是每台新机器必须按实际环境完成的操作：

1. 在密码管理器中恢复 LangBot、n8n、PUBG、9router、aria2 和 Cloudflare secrets。
2. 在 n8n 重新创建 credentials，导入 workflow，并确认 Data Table / webhook 映射。
3. 如启用 Cloudflare，创建 tunnel、放置 credentials file，并按模板配置 ingress。
4. 构建与发布目标架构可用的 runtime / LangBot 定制镜像。
5. 启动后运行 scripts/doctor.sh、HomeHub endpoint 检查和真实平台入站烟测；不要用 bot 自发消息替代真实入站验证。

## 工程规范基线

- Git 仓库是唯一 source of truth，禁止 runtime-only 修改；Domain 不依赖平台，LLM
  保持在边界，核心逻辑 deterministic。
- n8n 修改必须导出 JSON；第三方 LangBot patch 必须可追踪、可重建、可回滚。
- 每个阶段必须更新状态文档、运行匹配测试、执行 secret scan，并写入 checkpoint。

## 下一步建议

后续开发应先读取 README.md、本文、docs/CURRENT_TASK.md、.agent/state.md，
再查看 Git 状态和最近五次提交。若修改部署，优先修改 infra/docker/ 模板或
实际 CasaOS compose，并同步更新本文件和 checkpoint。

## 最终验证

- 根 pnpm workspace install 使用唯一 pnpm-lock.yaml 成功；
- TypeScript typecheck/build 成功；runtime 92 项测试中 91 项通过、1 项因外部 fixture 缺失跳过；
- legacy-v2 Python 测试 30 项通过；
- shell/Python 语法、bootstrap/backup/restore smoke test 和 Compose config 通过；
- check-secrets 通过，且 staged 文件没有真实 credential 或运行时数据；
- Docker build 命令已写入 apps/agent-runtime/README.md；基础镜像元数据检查因 Docker Hub 网络超时未完成，
  需在网络可用时手动执行。

## WhatsApp 接入状态：BLOCKED / DEFERRED

状态更新：2026-09-05

Meta WhatsApp Cloud API 接入工作已暂停，原因和计划详见 docs/DECISIONS.md。

当前保留：
- apps/whatsapp-adapter：Meta Cloud API 的 webhook 验签、入站消息归一化、文本拆分和发送器边界 facade
- apps/agent-runtime/src/platform/whatsapp：完整实现的 WhatsApp platform adapter、renderer、webhook、sender 和 graph-api
- integrations/langbot/patches/whatsapp.yaml：LangBot 侧的自定义平台资源
- infra/cloudflare：Cloudflare Tunnel 配置模板（保留用于未来 Webhook / HomeLab API）

确保不影响其他平台：
- WhatsApp 相关代码仅作为静态导出，不影响 KOOK / Telegram runtime 路由
- Platform capabilities 定义保持静态配置，不引入运行时依赖
- Runtime 镜像中的 whatsapp 标签仅表示构建时包含相关代码，不会自动启用

恢复条件和操作步骤见 docs/DECISIONS.md。

## Product Radar V0.1（2026-09-07）

Product Radar source implementation is complete in commits `83c3557`, `ed394e9`, `efbf19e`, `53d1b84`, and `d73b9fc`, separately from the existing
agent-runtime. It is a standalone Node service at `apps/product-radar`, with SQLite persistence,
generic source/sensor ports, deterministic matching/diffing, and LangBot private notification
channels. Bunjang is the first adapter; the 2026-09-07 smoke successfully fetched five public
seller listings and one public product snapshot without login or anti-bot bypass.

Evidence:

- `pnpm --filter @agent/product-radar typecheck` passed.
- `pnpm --filter @agent/product-radar build` passed.
- `pnpm --filter @agent/product-radar test` passed: 21 tests.
- `PYTHONPATH=integrations/langbot/plugins/product-radar python3 -m unittest discover -s integrations/langbot/plugins/product-radar/tests` passed: 4 tests.
- `scripts/deploy-langbot.sh --dry-run --plugin product-radar --skip-runtime-check` passed and produced a local ignored `.lbpkg` only.
- `pnpm check:secrets` passed.
- Local runtime `/api/sources` returned Bunjang capabilities; `/health` correctly reported `degraded` with HTTP 503 while changedetection was intentionally absent.
- Product smoke persisted one baseline snapshot and emitted zero events/notifications. Seller smoke persisted five baseline listings and emitted zero events/notifications.

Product Radar was deployed through the explicit RELEASE path to `/var/lib/casaos/apps/product-radar/docker-compose.yml` on OrbStack `ubuntu`. The immutable Product Radar image is `local/product-radar:git-dd80fb7a606d`; the changedetection service is healthy and has persistent `/DATA/AppData/changedetection/datastore` storage. LangBot Product Radar plugin install task `24` reached `INSTALL_READY`; after adding the missing EventListener `spec: {}` manifest block, reinstall task `32` reached `INSTALL_READY` and both Command/EventListener components loaded. The latest plugin task `35` also uses the existing PUBG Telegram renderer marker, accepts plain `确认监控`, and supports `停止监控`. The patched LangBot image now routes `pr1:` callback data to the plugin listener. Product Radar and changedetection preview checks passed; no real Telegram/KOOK test notification was sent.

## Product Radar V0.2 Image Similarity Watch（2026-09-07）

V0.2 is deployed in the existing Product Radar CasaOS service using image
`local/product-radar:git-298f8ee28072`. It adds a generic `similarity` Watch,
image attachment ingestion from LangBot, a persisted deterministic perceptual
matcher, Bunjang keyword-feed candidate discovery, and
`SimilarListingMatchedEvent`. The initial candidate scope is the Bunjang Korean
keyword feed `의류` (up to 60 candidates), not an unrestricted marketplace crawl.

Verification:

- Product Radar TypeScript: 24 tests passed; typecheck and build passed.
- LangBot plugin Python: 7 tests passed; attachment base64 extraction and image-only intent passed.
- Real Bunjang image similarity smoke used product `424506121` as the reference. Preview returned 54 current `의류` candidates; top measured score was below 0.60, so no false match was generated.
- Deployed test Watch `v02-smoke-20260907` was created with `intervalSeconds=120`, sensor `time_between_check.seconds=120`, and baseline count 54 with zero baseline notifications.
- A real Product Radar webhook returned HTTP 202 and completed successfully; the run recorded one new candidate, zero matches/events, and zero notifications.
- The test Watch was paused and deleted. The pre-existing user Product Watch remains active and untouched; final Product Radar database watch count is 1 and changedetection contains only the pre-existing watches.

A semantic CLIP/SigLIP provider and live Telegram image acceptance test remain
follow-ups. V0.2 intentionally keeps the ImageMatcher port replaceable and does
not perform CAPTCHA/login/proxy bypass or large-scale crawling.
