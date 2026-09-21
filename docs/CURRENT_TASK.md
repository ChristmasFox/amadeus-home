# 当前任务

更新时间：2026-09-21（Asia/Shanghai）

## 2026-09-21：Amadeus 1.4.4 Operation Skuld 存储与运行时收口（源码阶段完成）

当前执行目标为 `docs/AMADEUS_1_4_4_OPERATION_SKULD_STORAGE_RUNTIME_HYGIENE_GOAL.md`。
已完成 host profile、外置盘 fail-closed preflight、Immich copy-first/checksum 迁移工具、
旧源保留与独立 reclaim gate、Immich/9Router/changedetection migration coverage、加密
secret export/import rehearsal、service inventory、Docker 日志 rotation、受保护 GC、storage
health/scheduler 和动态版本 readiness。`pnpm test`、`pnpm typecheck`、`pnpm build`、
`pnpm check:secrets`、architecture/storage/migration/notification tests 与脚本语法均通过。

下一阶段为 1.4.4 release commit/push 后的 canonical CasaOS live apply：先外置 9Router/Immich
runtime secrets、备份并验证 8TB 外置盘，再迁移 Immich 媒体并保留旧源，随后应用日志 policy、
受保护 GC、scheduler 和 live doctor/readiness。Mac mini cutover 不在本轮；旧源 reclaim 保持
`SOURCE_RECLAIM_PENDING`，除非另有显式 gate。

## 2026-09-21：Amadeus 1.4.3 WhatsApp 私聊会话隔离（已部署）

本轮确认 WhatsApp 私聊数据串流的根因是 OpenClaw 未配置 `session.dmScope`，默认值为
`main`：不同发送者的 DM 都进入 `agent:main:main`，而 `toolsBySender` 只限制工具，不隔离
历史上下文、记忆或模型 prompt。现已把声明式配置固定为
`dmScope=per-account-channel-peer`、`groupScope=per-group`，并在部署预检中硬性拒绝共享 DM
会话；非 owner 仍只允许 `web_search`/`web_fetch`。

`VERSION=1.4.3`、release notes、session-isolation/deploy contract tests、脚本语法、OpenClaw
定向 build/typecheck/test 和 secrets scan 均通过。implementation commit `4c61b1e` 已提交；
已 apply 到 CasaOS `ubuntu`：OpenClaw image 为
`local/openclaw-amadeus:git-4c61b1ef2b02-20260920155823`，Product Radar 复用
`local/product-radar:git-4d11f3e02074-20260920153810`，checkpoint 为
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260920155823`。live OpenClaw healthy，运行时
配置已核实为上述 session scope，并已出现按 WhatsApp 对端隔离的新 direct session key。

部署脚本现在要求当前版本严格高于 live image source commit 中的 `VERSION`，并用稳定的
`amadeus-release:<版本>` 幂等 key 写入 checkpoint 与生产 owner outbox，等待对应 `.sent.json`；
本次 `OWNER_NOTIFICATION=sent`，版本事实为 `1.4.3`。旧 `agent:main:main` 共享会话暂不删除，
仅保留作取证/恢复，不再作为 WhatsApp DM 路由目标。

## 2026-09-20：Amadeus 1.4.2 Worldline 与 Operation Skuld（已部署）

当前执行目标为 docs/AMADEUS_1_4_2_WORLDLINE_UNIFICATION_AND_SKULD_READINESS_GOAL.md。已完成
Worldline structured notification contract、正式主题词汇与确定性 policy/adapter/renderer；
Product Radar、市场、媒体、HomeLab、PUBG sync、VPS、Codex/release owner producer 已统一到
transport-neutral owner outbox。已补齐主动通知 producer inventory、infra classification、
host profile、可配置 Amadeus network、FashionSigLIP worker health、Skuld manifest/runbook、
backup metadata 与 read-only readiness/temporary restore rehearsal。

`VERSION=1.4.2` 与 release notes 已通过检查；`pnpm test`、`pnpm typecheck`、`pnpm build`、
secret scan、architecture fitness、migration-readiness test、脚本语法和 OpenClaw/Product Radar
生产镜像构建均已通过。implementation commit `af54e7d` 已 push，并已部署到当前 CasaOS `ubuntu`；
新镜像、checkpoint、health/preflight/smoke、doctor 和 `OPERATION_SKULD=READY` 证据见
`docs/reports/AMADEUS_1_4_2_DEPLOYMENT.md`。Operation Skuld 不执行 Mac mini cutover；真实自然语言
inbound/final-reply 仍按验收边界保持 pending，不发送未经请求的真实群聊消息。

部署通知 follow-up：初次 1.4.2 deploy 的 owner smoke 只写入 checkpoint，没有进入生产 outbox；这是本次未发通知的根因。已补发 `amadeus-release:1.4.2:manual-resend` 并确认 `.sent.json`，同时修复 deploy source 为成功部署后写入生产 outbox 并等待发送完成。

执行唯一目标：完成 OpenClaw Amadeus 全能力迁移。旧 LangBot/n8n/旧插件/旧通知路径全部
退出；OpenClaw/Kurisu 是唯一 Agent runtime。PUBG plugin/domain、当前 9Router、Product
Radar、changedetection、media adapter 和必要聊天入口按边界保留。

## 2026-09-20：WhatsApp 全量私聊与非 owner 工具隔离（已完成）

按用户授权，WhatsApp 顶层及 `secondary` 账号 DM 已改为 `dmPolicy=open`、`allowFrom=["*"]`，
`configWrites=false`；Telegram 仍为 allowlist，未扩大 Telegram DM 范围。发送者工具策略保持
owner `tools.profile=full`，非 owner 只允许 `web_search`/`web_fetch`，不加载服务器、文件、执行、
节点、自动化、媒体、插件等写入面；`commands.ownerAllowFrom` 与 owner outbox 仍只指向原 owner。

同时为 Product Radar 的 `create/update/delete/pause/resume/run/context_*` 增加运行时 owner 门禁，
避免仅靠发送者工具过滤形成绕过路径。源码与部署模板已提交（最终 commit `4d11f3e`），镜像已
apply 到 CasaOS `ubuntu`：OpenClaw/Product Radar 均 healthy，WhatsApp linked/running，配置 reload
active，编译后的 Amadeus bundle 已包含 Product Radar owner guard。配置变更前恢复点为
`/DATA/AppData/openclaw/backups/whatsapp-dm-open-20260920T152658Z`，本次发布 checkpoint 为
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260920153810`；health、preflight、媒体网络、
NAS 只读、owner outbox smoke 和 secrets scan 均通过。

## 2026-09-20：Immich 与 9router 更新（已完成）

本轮在 OrbStack `ubuntu` 的 CasaOS 中完成两项服务更新。Immich server 与 machine-learning
更新到 `v3.2.2`，数据库从旧 `tensorchord/pgvecto-rs:pg14-v0.2.0` 按官方迁移路径切换到
`ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0`，并移除旧数据库启动参数/旧
checksum healthcheck，加入 `shm_size: 128mb`。Immich 数据库原地启动迁移后四个容器均 healthy，
扩展检查包含 `vchord 0.4.3`、`vector 0.8.1` 和 `vectors 0.2.0`。

9router 先从 `decolua/9router:latest` 固定到 `0.5.75`，随后因 npm `latest` 已为 `0.5.81`，基于
固定的 `decolua/9router:0.5.75` 构建并切换到仓库内 Dockerfile 生成的 `local/9router:0.5.81`。
容器使用 npm 包自带的直接 server 入口，避免桌面 CLI 在 headless 容器中退出；持久化 data、端口
`20128` 和 secret 保持不变。更新前备份分别为
`/DATA/AppData/immich/backups/pre-update-20260920T132238Z` 与
`/DATA/AppData/9router/backups/pre-update-20260920T132238Z`；旧 9router 镜像回滚标签为
`decolua/9router:rollback-20260920T132238Z`；npm 版本切换前的恢复点为
`/DATA/AppData/9router/backups/pre-npm-0.5.81-20260920T142239Z`，并保留
`local/9router:rollback-0.5.75-20260920T142239Z`。本地 compose 校验、0.5.81 包版本、容器
零重启、公网 Immich `/api/server/ping`（200）、Immich 首页（200）、9router dashboard（200）和
无 key API（401）均已验证。

## 2026-09-20：Amadeus 1.4.1 已部署，deployment evidence 收尾

`docs/AMADEUS_1_4_1_PUBG_PRESENTATION_HARDENING_GOAL.md` 已完成：PUBG 全 native tool presentation
registry、stats/search/compare/match/review/period/team-damage/status renderer、Domain-owned
fresh-result-set period review、owner outbox 结构化分片、SOUL persona-only 和递归 architecture
fitness check 均已落地。定向 Presentation 6/6、Domain 23/23、PUBG plugin 9/9、Amadeus 18/18、
typecheck、architecture、version fixtures、workflow、secrets scan、全仓 build/test 和 release
check 均通过。`VERSION=1.4.1` 的 implementation commit `032e314` 已 push，并已通过
`./scripts/deploy-openclaw.sh --apply --build-auto` 部署到 CasaOS。

live OpenClaw image 为 `local/openclaw-amadeus:git-032e31477b45-20260920065322`，Product Radar
复用 `local/product-radar:git-7d85bc10f15d-20260920041059`，外部恢复 checkpoint 为
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260920065322`。OpenClaw/Product Radar health、
PUBG/Amadeus Skill/tool preflight、media network、NAS read-only、owner WhatsApp outbox smoke 和
legacy runtime retirement 均通过；独立 `doctor.sh` 为 0 failure / 0 warning。未发送未经请求的
真实群聊测试消息，真实自然语言 inbound/final-reply 仍按边界记录为 pending。

## 2026-09-20：PUBG 队友动作/误伤调用链补强（1.4.0 已部署）

针对真实 WhatsApp 回合“昨天队内误伤情况详情”和“昨天007踢了004几脚”的调用轨迹完成
read-only 审计：两次都只调用了 `pubg_search_matches`，得到 7 场基础 Match API 记录后就结束；
没有调用 `pubg_get_review_facts`，而现有单局 review contract 也无法一次性覆盖整个周期。
根因是模型把基础 Match API 的 `coverage=OK/complete=true` 误当作 Telemetry 完整，且缺少
周期批量队友伤害 Domain use case；不是 PUBG plugin 加载、API 健康或 Telemetry downloader
故障。

已新增 `pubg_query_team_damage` native contract：Domain 内按语义 selector 确定性解析 06:00
周期、刷新 Match、逐局确保 Telemetry，并返回全方向/定向 `actor → victim` 聚合、每局证据、
`source`/`meleeKind` 筛选和 `partial/null` 未知语义。Skill 明确要求周期队友动作直接调用该
工具，不得先查基础比赛后停止。新增 Domain 回归覆盖 06:00、007/004 alias、跨局 KICK 聚合
及 Telemetry 不完整语义；本地 Domain 22/22、Plugin 9/9、全仓 build/typecheck/test、
architecture、secrets 和 workflow verify 均通过。实现提交 `6ee03d0` 已 push，并通过
`./scripts/deploy-openclaw.sh --dry-run` 与 `--apply --build-auto` 部署到 CasaOS。

live OpenClaw image 为 `local/openclaw-amadeus:git-6ee03d0617fd-20260920044911`，
Product Radar 复用 `local/product-radar:git-7d85bc10f15d-20260920041059`，外部恢复 checkpoint
为 `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260920044911`。部署输出和独立核验均确认
OpenClaw/Product Radar health、媒体网络、NAS 只读、owner outbox、legacy runtime retirement、
`pubg_query_team_damage` live tool/Skill 和 `doctor.sh`（0 failure/0 warning）通过；未发送
未经请求的真实群聊测试消息。

## 2026-09-20：版本递进规则调整

用户要求从下一版本起所有版本统一通过 `bump patch` 按 `0.0.1` 递增：patch 位为 `0..9`，到 9 后
minor 进 1；minor 位为 `0..99`，到 99 且 patch=9 后 major 进 1。当前已发布的 `1.4.0` 保持不变，
下一版本为 `1.4.1`；`0.9.9 -> 0.10.0`，`0.99.9 -> 1.0.0`。
`bump minor` 和 `bump major` 不再支持。版本脚本、README、根工作规则和本 Goal 已同步，验证与策略
记录见本次 checkpoint；本变更不需要重新部署已匹配 1.4.0 的运行时镜像。

## 2026-09-20：Amadeus 架构收敛 Phase 1-2（已完成）

已从远端拉取并 rebase 最新 `docs/AMADEUS_ARCHITECTURE_CONVERGENCE_GOAL.md`。Phase 1 将
`plugins/amadeus/src/index.ts` 收敛为 36 行 bootstrap，按 capability 拆出 registration module，
共享 tool wrapper、Identity lifecycle 和 owner worker 保持既有契约；Phase 2 移除了 global
`before_prompt_build` 业务 routing guidance，拆分 Product Radar、Media、NAS、HomeLab、KOOK、
Owner Notification 等 Skill，并把 PUBG/时间/Identity workflow 留在对应 capability owner。

定向验证：`pnpm test:amadeus`、PUBG plugin 9/9、`pnpm typecheck:amadeus` 和
`git diff --check` 通过；SOUL/workspace prompt ownership 与 global business injection 扫描通过。
随后 Phase 3-5 已在下方完成，Phase 6 release 仍待执行。

## 2026-09-20：Amadeus 架构收敛 Phase 3-5（已完成并已部署）

已新增纯 `packages/presentation`：实现 `PubgMatchReviewPresentation`、
`PubgPeriodReviewPresentation`、`OwnerNotificationPresentation`，runtime validation、证据引用校验、
未知值保留、同日 `HH:mm`/跨日 `YYYY-MM-DD HH:mm` formatter 和 deterministic renderers。PUBG
复盘工具通过结构化 `presentation` 返回，OwnerNotifier 在发送和重试边界 hard-validate 后统一渲染；
旧 outbox `title/message` 只做读取时兼容，新写入统一为结构化合同。

PUBG Domain 的 06:00 relative-period 与 explicit range 回归已补齐，Telemetry calendar-day report 与
互动查询仍由不同 use case 保持分离；PUBG tool local display fields 已接入 Presentation formatter，默认
正文不暴露内部 resolver metadata。市场、媒体、HomeLab、PUBG sync、Product Radar、Codex hook 和
release smoke 均已迁移到 owner contract。

治理已完成：根 `AGENTS.md` ownership matrix/checklist、`docs/CAPABILITY_TEMPLATE.md`、
`scripts/check-architecture.mjs` 及 fixture test 已加入，`pnpm check:architecture` 和
`workflow:verify` 路径已接入。`pnpm build`、`pnpm typecheck`、`pnpm test`、`pnpm check:secrets`、
architecture fixture、workflow scope tests 与 `git diff --check` 当前通过。

Phase 6 已完成：版本 `1.3.0`、实现提交 `7d85bc1` 已 push；`deploy-openclaw.sh --dry-run` 和
`--apply --build-auto`、`doctor.sh`、live checkpoint/health/preflight/smoke 全部通过。部署证据见下方
条目，尚需提交并 push 本次 docs-only evidence。

## 2026-09-20：Amadeus 架构收敛 release 已部署

实现提交：`7d85bc10f15d`（`feat: converge Amadeus architecture and presentation`）；版本：`1.3.0`。
部署命令为 `./scripts/deploy-openclaw.sh --dry-run`、`./scripts/deploy-openclaw.sh --apply --build-auto`，
策略按 live immutable image 判定后实际重建 OpenClaw 与 Product Radar。live images 为
`local/openclaw-amadeus:git-7d85bc10f15d-20260920041059` 与
`local/product-radar:git-7d85bc10f15d-20260920041059`；外部恢复 checkpoint 为
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260920041059`。

部署输出确认 `OPENCLAW_HEALTH=passed`、`PRODUCT_RADAR_HEALTH=passed`、
`MEDIA_ADAPTER_NETWORK=passed`、`NAS_SSH_READONLY_SMOKE=passed`、
`OWNER_WHATSAPP_OUTBOX_SMOKE=passed`、`LEGACY_RUNTIME=retired`；`./scripts/doctor.sh` 为 0 failure、0
warning。live preflight 确认 Amadeus 19 tools、PUBG 8 tools、owner notification worker、全部新 Skills
和六个预期 cron；live bundle 还确认 owner contract、renderer、time formatter 和 PUBG integration。
未发送未经请求的真实群聊测试消息；真实用户自然语言入站验收仍按既有约束记录为 pending，不冒充为已完成。

## 2026-09-20：修复 VPS Caddy 多服务 525（已完成）

Cloudflare 解析和回源链路本身正常，但 VPS 生效的 Caddy 配置只包含 `sub`、`emby`、`claw`
和 `immich` 四个 HTTPS site；缺少其他已有 frps 映射对应的站点时，Cloudflare 到 VPS 的 TLS
握手返回 `525`。已在 Caddy 中补齐 `jellyfin.nyannyan.top` → `8097`、`aria.nyannyan.top` →
`6880`、`qb.nyannyan.top` → `8080`、`monitor.nyannyan.top` → `61208` 和
`9router.nyannyan.top` → `20128`，并保留 Immich → `2283`。

Caddy 配置校验通过并平滑 reload，证书已签发；公网验证返回 Jellyfin `302`、AriaNG `200`、
qBittorrent `200`、Glances `200`、9Router `/` `307`，9Router `/v1/models` 在未提供 key 时
返回预期 `401`。Immich `/api/server/ping` 返回 `200 {"res":"pong"}`。未修改 frps/frpc、
OpenClaw、Cloudflare DNS 或任何 SSH/防火墙配置；live 回滚副本为
`/etc/caddy/backups/Caddyfile.pre-public-services-20260919T161251Z`。

## 2026-09-19 follow-up：NAS OpenClaw 美股指数通知（已部署）

用户确认关注纳斯达克100和标普500，并沿用部署通知的命运石之门主题风格。实现边界是
`plugins/amadeus` 的确定性 `amadeus_market_indices` 工具与 owner outbox，不恢复旧 briefing
producer；美东 09:35/16:05 工作日 cron 自动适配北京时间夏令时/冬令时。必须先完成
Amadeus 定向测试、secrets scan、版本发布、CasaOS apply，并验证两个 cron、工具 bundle、
健康状态和可恢复 checkpoint；接口异常或休市不得发送编造/旧行情。

本轮已完成：版本 `1.2.0`、提交 `5117aa5` 通过 `--apply --build-auto` 部署到 CasaOS；镜像为
`local/openclaw-amadeus:git-5117aa593fbc-20260919102358`，checkpoint 为
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260919102358`。live health、插件/Skill
preflight、NAS 只读、owner outbox 和 Gateway 行情工具 smoke 均通过；真实 smoke 因周六返回
`market_closed`，没有发送市场通知。后续只需等待下一个美股交易日自然触发开盘/收盘消息。

## Amadeus 版本管理（历史记录，2026-09-19）

当时版本源为根目录 `VERSION`，版本为 `1.2.0`，曾使用
`show/check/bump patch|minor|major`；该历史策略已被上方 2026-09-20 的统一 `bump patch`
进位规则取代。`RELEASE_NOTES.md` 是部署完成通知的唯一正文来源，且只保留
本次版本的简短新增/修复，不是累计 changelog；标题固定为 `Amadeus <版本> · 世界线收束`，末尾自动追加
`El Psy Kongroo.`；`RELEASE_NOTES.md` 不要自行重复写这句，部署脚本会统一追加一次。

## 2026-09-19 follow-up：部署通知结尾去重（已部署）

已定位重复原因：发布说明正文包含 `El Psy Kongroo.`，部署脚本又无条件追加一次。现在部署边界会
先移除发布说明中独立的同名结尾，再统一追加一次；1.1.7 发布说明不再手写该句。

版本 `1.1.7`、提交 `e85ff3c` 已通过 `--apply --build-auto` 部署；本次复用已验证镜像
`local/openclaw-amadeus:git-fdf331cbca89-20260919071937`，恢复 checkpoint 为
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260919072713`。实际送达的 owner smoke 通知已
核实 `El Psy Kongroo.` 全文只出现 1 次；OpenClaw `running/healthy`，health、preflight、媒体网络、
NAS 只读和 owner outbox smoke 均通过。

## 2026-09-19 follow-up：PUBG 全部时间统一北京时间（已部署）

修复 PUBG tool 输出的时间展示层：内部 UTC 时间戳继续保留为机器证据，同时所有用户可见时间
增加并强制使用 `dataUpdatedAtLocal`、`asOfLocal`、`startedAtLocal`、`fromLocal/toLocal`，并由
`displayTimezone` 明确标记为 `Asia/Shanghai`。这修复了 `2026-09-17T22:00:00Z` 被错误显示为
北京时间 `2026-09-17 22:00` 的问题；正确显示应为 `2026-09-18 06:00`。D-mail 的更新时间也统一
转换为北京时间。

本地 PUBG Domain 20/20、Plugin 9/9、Identity 10/10、Amadeus 11/11、受影响 typecheck/build、
secrets scan 和 diff check 已通过。版本 `1.1.5`、提交 `fdf331c` 已通过 `--apply --build-auto`
部署到 CasaOS；线上镜像为 `local/openclaw-amadeus:git-fdf331cbca89-20260919071937`，恢复 checkpoint 为
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260919071937`。live OpenClaw 为 `running/healthy`，
插件 bundle 已核实 `dataUpdatedAtLocal`、`fromLocal/toLocal`、`startedAtLocal` 和北京时间规则；
部署 health、preflight、媒体网络、NAS 只读和 owner outbox smoke 均通过。未发送未经请求的真实群聊测试消息。

## 2026-09-19 follow-up：PUBG 方向性结果与来源时间范围（已部署）

已修复两类最终渲染问题：队友误伤/踢击/拳击等关系查询明确按 `行为者 → 受害者` 处理，
“反过来”是交换方向后的独立查询，不得把前一方向的正确结果改写成错误；同时所有 PUBG
native tool 输出增加必填 `dataSourceRange`，Telemetry 复盘继承本轮刷新搜索的精确业务日区间，
最终回复必须同时展示 `dataUpdatedAt` 和来源时间范围（比较查询按分段展示）。本地 PUBG Domain
20/20、Plugin 9/9、Amadeus 11/11、build/typecheck、secrets scan 和 diff check 已通过。

版本由 `1.1.3` 升至 `1.1.4`，提交 `04e8902` 已通过 `--apply --build-auto` 部署到 CasaOS；线上镜像为
`local/openclaw-amadeus:git-04e8902c815a-20260919064258`，恢复 checkpoint 为
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260919064258`。live 容器为 `running/healthy`，
启动日志确认 `amadeus`、`pubg`、Telegram、WhatsApp 正常注册；live workspace、PUBG Skill、native
tool bundle 已核实方向性规则和 `dataSourceRange`。未发送未经请求的真实群聊测试消息。

## 2026-09-19 follow-up：PUBG 路由事实强制走工具（已部署）

修复了普通 PUBG 事实追问被会话上下文直接回答的问题：只要消息被识别为 PUBG 并路由到任一
PUBG tool，最终数据必须来自本轮 native tool 返回的持久化 SQLite 缓存/更新结果；上下文只能
辅助解析人物、时间和范围，不能提供击杀、伤害、误伤、Telemetry 或复盘数值。默认刷新策略会
先刷新比赛发现，再读取缓存并只获取新增或缺失数据。

本轮版本由 `1.1.2` 升至 `1.1.3`，提交 `36020fc` 已通过 `--apply --build-auto` 部署到 CasaOS；
线上镜像为 `local/openclaw-amadeus:git-36020fc00a21-20260919062713`，恢复 checkpoint 为
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260919062713`。PUBG Domain 20/20、Plugin 9/9、
Amadeus 11/11、build/typecheck、secrets scan、OpenClaw/Product Radar health 和所有部署 smoke
均通过；容器为 `running/healthy`。live workspace、PUBG Skill 和 native tool descriptions 已核实
新规则。未发送未经请求的真实群聊测试消息。

## 2026-09-19 follow-up：PUBG 周期复盘顺序修复（已部署）

本轮改动仅位于 PUBG Domain/plugin：周期复盘在没有显式 `sort` 时按比赛实际开局时间升序输出，
保证从第一局到最后一局阅读；“最近一局/最后一局/最新比赛”使用 `recentN` 时仍按最新优先，
显式 `sort` 仍由调用方控制。LLM 通过 PUBG tool description/Skill 识别意图并发出
`sort="asc"`，全局 OpenClaw/Amadeus 路由和其他插件未改变。

新增回归覆盖周期查询与 recent 查询的相反排序契约。PUBG Domain 20/20、Plugin 9/9、Amadeus
11/11、受影响 typecheck/build 和 secrets scan 均通过。版本由 `1.1.1` 升至 `1.1.2`，提交
`956853c` 已部署到 CasaOS；线上镜像为
`local/openclaw-amadeus:git-956853caa816-20260919060947`，恢复 checkpoint 为
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260919061408`。OpenClaw/Product Radar health、
preflight、媒体网络、NAS 只读 smoke 和 owner WhatsApp outbox smoke 均通过；容器为
`running/healthy`，live bundle 已核实新排序契约。未发送未经请求的真实群聊测试消息。

## 2026-09-19 follow-up：PUBG Telemetry 复盘新鲜度与缓存语义修复（已部署）

本轮已完成源码、回归验证和 release 部署：LLM 只负责识别 PUBG 操作与周期，工具接受
结构化 `relative_period` selector，Domain 统一按 `Asia/Shanghai` 的 `06:00` 业务日解析，避免
模型直接计算日历午夜。`pubg_search_matches` 在存在 selector 或 `recentN` 时强制刷新；
`pubg_get_review_facts` 必须接收当前会话、当前 5 分钟内、由刷新搜索产生且包含目标 Match 的
`resultSetId`，否则返回 `review_search_required` 或 `match_not_in_search_result`。

Telemetry 用户可见语义改为 `HIT`、`FETCHED`、`UNAVAILABLE`；成功请求写入缓存返回
`status=FETCHED/cacheStatus=FETCHED/cacheLookup=MISS/availability=AVAILABLE`，不再把成功抓取渲染为
裸 `MISS`。新增 relative-period 与 result-set 新鲜度回归，PUBG Domain 19/19、Plugin 9/9 测试、
受影响 typecheck 已通过。版本由 `1.1.0` 升至 `1.1.1`，已执行 `--apply --build-auto` 发布。

当前 live 状态：`DEPLOYED_LIVE_FRESH_REVIEW_GUARD_ACTIVE`。提交 `5eaf652` 已部署到 CasaOS，线上
镜像为 `local/openclaw-amadeus:git-5eaf65238c58-20260919053516`，恢复 checkpoint 为
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260919053516`。OpenClaw 容器为 `running/healthy`，
启动日志确认 `amadeus`、`pubg`、Telegram、WhatsApp 正常注册；live bundle 已检出
`relative_period`、`review_search_required`、`cacheLookup` 和新鲜度守卫。Hourly cron 为
`5 * * * *`、daily cron 为 `0 0 * * *`，均为 `Asia/Shanghai` isolated job；小时任务最近一次状态为
`ok`。部署脚本的 OpenClaw/Product Radar health、preflight、媒体网络、NAS 只读 smoke 和 owner
WhatsApp outbox smoke 均通过。真实群聊仍需用户触发一次“复盘昨天/今天”完成入口验收。

## 2026-09-19 follow-up：PUBG Telemetry 小时预取、MISS 语义与 D-mail 汇总

源码已部署的基础能力：每小时 `Asia/Shanghai` 的 `05` 分刷新所有配置玩家，
只拉取新比赛详情，并以并发 2 预取新 Telemetry；失败写入 retry ledger，下一轮只重试到期项目，
不会把 1 小时内的每场新对局重复请求。Telemetry 成功拉取返回 `FETCHED/cacheStatus=FETCHED/cacheLookup=MISS/availability=AVAILABLE`，
缓存读取返回 `HIT`，真正不可用返回 `UNAVAILABLE`。所有 PUBG 工具输出 `dataUpdatedAt`，最终回复必须展示该时间。

每天 00:00 运行 `pubg_telemetry_sync_report`，汇总上一自然日 00:00–24:00，再把工具返回的
`Amadeus • D-mail` notification 原样交给 `amadeus_notify_owner`；正文保留事实计数和重试状态，
末尾为 `El Psy Kongroo.`。交互查询仍保持旧业务日 06:00。官方 API 限流以
[PUBG API Rate Limits](https://documentation.pubg.com/en/rate-limits.html) 为准，定时器不做高频循环。

当前 live 状态：`DEPLOYED_LIVE_SCHEDULED_PREFETCH_PENDING_FIRST_DAILY_REPORT`。提交 `4cf3f40` 已通过
`--apply --build-auto` 部署到 CasaOS，线上镜像为
`local/openclaw-amadeus:git-4cf3f4011d61-20260919045321`，恢复 checkpoint 为
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260919045321`。8 个 PUBG native tools、
`05 * * * *` hourly cron、`00:00` daily cron、health、preflight、owner outbox smoke 均通过。
首次 hourly 手动回放成功且未投递通知：118 场被发现、0 新对局、0 Telemetry fetch、0 unavailable、
0 pending；SQLite 两张新账本表已创建。首个真实 00:00 D-mail 与真实 Telegram/WhatsApp PUBG 回复
仍待用户入口/定时器自然运行验证。

## 2026-09-19 follow-up：PUBG 最近一局刷新与增量缓存

当前实现状态：`DEPLOYED_LIVE_INTERACTIVE_INBOUND_PENDING`。`pubg_search_matches` 在请求“最近一局/最后一局/最新比赛”时强制刷新玩家比赛列表；只把不在 SQLite 缓存中的比赛 ID 请求到 Match API，新增详情写回缓存，列表没有新增时继续使用缓存详情。`last_n_matches` 统计也强制走同一刷新路径。

PUBG Skill、native tool description 和 Kurisu workspace context 已明确禁止从上一轮直接复用旧 matchId；必须先搜索本次最新 matchId，再读取 Telemetry。搜索结果的 `queryResolved.refresh` 记录了本次刷新、API 调用和新增/缓存比赛数量，便于验收。新增 domain 增量同步与 recent search 回归测试均已通过。本轮已通过 `--apply --build-auto` 部署：线上镜像为 `local/openclaw-amadeus:git-db0a2dfa5c75-20260918164913`，恢复 checkpoint 为 `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918164913`；OpenClaw/Product Radar 健康、媒体网络、NAS 只读 smoke 和 owner WhatsApp outbox smoke 均通过。仍待用户从真实 WhatsApp 群聊触发一次“最近一局”完成入口体验验收。

## 2026-09-19 follow-up：PUBG 业务日与查询边界加固（已部署，真实入口验收待完成）

当前实现状态：`DEPLOYED_LIVE_REAL_INPUT_PENDING`。用户确认 PUBG 继续沿用旧业务日：`Asia/Shanghai` 每日
`06:00` 到次日 `06:00`。Domain 默认、OpenClaw 配置模板、插件 manifest、Skill 和按日聚合现在统一
使用 `06:00`；显式 selector 的 `timezone/businessDayStart` 也会真正作用于 `groupBy=day` 和比较分段。

本轮同时修复查询边界：PUBG API 玩家发现失败但本地已有缓存时返回 `partial + STALE`，不再把已有 rows
包装成 `error + SOURCE_UNAVAILABLE`；人物复盘按已解析的 `playerIds` 裁剪，不再从昵称查询膨胀回完整队伍；
未知 KD/排名/比例不会再被转换为 0 参与排名、Chicken Index、highlight、trend 或 compare delta。

新增回归覆盖 06:00 相对日期、按日边界、未知指标、人物复盘范围和 API 不可用缓存降级。提交
`1c2a585` 已通过 `--apply --build-auto` 部署；线上镜像为
`local/openclaw-amadeus:git-1c2a585b2eef-20260918172435`，恢复 checkpoint 为
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918172435`。live config 已核实
`timezone=Asia/Shanghai`、`businessDayStart=06:00`，PUBG 六个 native tools runtime inspect
均已加载；OpenClaw/Product Radar health、媒体网络、NAS 只读 smoke、owner WhatsApp outbox
smoke 和旧 LangBot/n8n 退休检查均通过。仍待用户从真实 Telegram/WhatsApp 群聊触发昵称、本人、
队伍、06:00 边界和最近一局复盘，完成入口体验验收。

## 2026-09-18 follow-up：VPS 手动 eventKey 隔离、部署文案与 PUBG team 查询修复

当前实现状态：`DEPLOYED_LIVE_REPLAY_PASS_INTERACTIVE_INBOUND_PENDING`。VPS owner 通知现在识别 OpenClaw isolated
cron 的 `:run:manual:` session 标记；手动、调试或补跑即使误传正式
`vps-report:<date>:<morning|evening>`，也会在 owner tool 边界改写到独立的
`vps-report:manual:...` key，不再消费正式 09:30/23:00 定时任务的 sent marker。部署脚本和
VPS Skill 同时要求模型主动使用 manual key，正式定时 key 保持稳定。部署成功验收文案已改为
Amadeus/世界线风格，但仍保留 owner outbox 与 WhatsApp sent marker 的事实语义。

PUBG team 查询的根因是 `prepareIdentitySubject(team=true)` 只返回 `playerIds`，丢失了
selector、metrics、operation、groupBy、limit 和 refresh，随后 domain 查询访问缺失 selector
而进入 `plugin_runtime_error`。现在只替换身份字段并保留完整查询参数，新增回归覆盖了完整的
team stats input。Amadeus 11、PUBG plugin 9 定向测试、受影响 typecheck、脚本语法、secrets
scan 和 diff 检查通过。提交 `05b3be7` 已通过 `--apply --build-auto` 部署，线上镜像为
`local/openclaw-amadeus:git-05b3be7caa7a-20260918161553`，恢复 checkpoint 为
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918161553`。部署后无投递回放已确认全队
查询和“胶昨天战绩”均成功，未向真实群聊发送未经请求的测试消息；仍待用户从 WhatsApp 入口做
最终体验确认。

## VPS Read-only Capability + Daily Report 子目标（2026-09-18）

当前实现状态：`LIVE_DEPLOYED_REPORT_SMOKE_PASS_INTERACTIVE_INBOUND_PENDING`。Amadeus 已加入五个只读 VPS native
tools 和 `skills/vps`：KiwiVM 固定 service/live/raw-usage API，固定 SSH uptime/resource
probe，固定 Caddy/Xray/Hysteria2/frps service probe；没有 restart/stop/start/reinstall/password
reset/任意 shell/关键词路由。流量状态原子持久化在 `/data/vps-usage-state.json`，以成功 counter/time
为 baseline 并保留 quota/reset 元数据；失败保持上一份成功数据并返回 stale/error。

部署模板已声明外部 KiwiVM credentials、VPS read-only SSH key、known-hosts mount，迁移脚本已
加入 secret 校验、状态 checkpoint、工具/Skill preflight 和 09:30/23:00 Asia/Shanghai VPS
report cron。受限 SSH key/user 和固定 probe 已在 `amadeus-gateway` provision 并通过插件真实
调用验证；KiwiVM secret 已放入 CasaOS 外部 secrets，最新镜像已 apply。Gateway 自然语言 smoke
实际调用五个 VPS tools 且无失败；晚间 cron 已通过 WhatsApp provider 返回真实 sent message，报文
包含十格流量条、增量和四个服务。仍待用户从真实 WhatsApp 入站发送一条自然语言 VPS 查询，以
完成最终聊天入口证据；在该证据出现前不得宣称 Definition of Done。

## 2026-09-19 follow-up：VPS 订阅复用旧链接、统一文件名与套餐流量头

当前实现状态：`LIVE_APPLIED_SUBSCRIPTION_HEADERS_PASS`。新增轻量的
`infra/vps/subscription/amadeus_gateway_subscription.py` 和 systemd/Caddy 模板：保留已有
`/<token>/<format>` 订阅 URL，原样返回 QX/Clash/Shadowrocket 正文，并以
`Content-Disposition: inline; filename="amadeus-gateway"` 统一文件名；`Subscription-Userinfo`
和 `X-Amadeus-Gateway-Usage` 使用 KiwiVM 整台 VPS 的已用、总量、剩余和重置时间。当前不区分
用户或 Xray/HY2，KiwiVM 失败沿用上一次成功样本并标记 `stale`，没有样本不回零。

本地 Python 单元测试 5/5、编译、`git diff --check` 和 secrets scan 已通过。live apply 已完成：
VPS 外部凭据位于 `/etc/amadeus-gateway/kiwivm-credentials.json`，新 service 为
`enabled/active`，Caddy 为 `enabled/active` 且旧静态 handler 已替换为两个本地反代。443/8443
上的四种原订阅路径均为 HTTP 200，正文逐字节保持一致，响应文件名为 `amadeus-gateway`，
`Subscription-Userinfo` 为 `fresh`。apply 前备份为
`/var/lib/caddy/backups/amadeus-gateway-subscription-20260919084939`。

## 跨渠道 Identity 子目标（2026-09-18）

当前实现状态：`DEPLOYED_LIVE_REAL_INPUT_PENDING`。新增 platform-neutral
`packages/identity` SQLite 库和 Amadeus native Identity tools：
`identity_resolve`、`identity_get_person`、`identity_bind_channel`、
`identity_add_alias`、`identity_link_account`、`identity_list_candidates`、
`identity_confirm_candidate`，以及 `skills/identity`。预设从仓库外
`identityPresetsFile` 导入；文件在 OpenClaw 运行后新增或修改时，会按文件指纹在下一次 Identity
tool 调用前安全刷新，已确认数据不会被预设覆盖；Telegram/WhatsApp sender/account/conversation metadata 只从
OpenClaw trusted context 读取，生产 ID/JID 不进入 Git。

2026-09-18 follow-up 已补上 OpenClaw typed `before_dispatch` → tool context 的短时 reply
metadata bridge，并在 `agent_end` 清理；只保留可信 channel-native sender id，按 session 隔离，
不保存消息正文或显示名。Pinned OpenClaw 2026.9.4 的 Telegram bundle 和外部持久化 WhatsApp
channel package 现在也通过 source-controlled、版本锚定补丁，把 Telegram `text_mention` 的
真实 user ID、同一会话内已由 trusted sender metadata 观察到的 `@username` 对应 ID、WhatsApp
`mentionedJid` 和稳定 sender JID 送入同一 `toolBindings.identity.mentions`/sender context；不从
prompt、昵称、手机号文本或未观察到的用户名推断，过期/冲突用户名 fail closed。该 follow-up 已随
`c33684a` 构建并 apply；随后 `29ad1b9` 增加外部 preset 文件的运行时安全刷新，`1ccd6f0`
补上 PUBG plugin 缓存 IdentityStore 的同等刷新，并完成选择性 build/apply；线上镜像为
`local/openclaw-amadeus:git-1ccd6f09c6f1-20260918103442`，runtime inspect 已确认
`before_dispatch` 和 `agent_end` 两个 typed hook 在线。

PUBG plugin 已在边界消费 canonical Person 的 `provider=pubg` account；没有 binding、没有
PUBG account、alias 仍是 observed candidate 或解析歧义时，返回明确 identity error，不再把
群成员的“我”静默解析成默认队伍。`team=true` 是显式队伍请求。源码、配置、Skill、本地测试和
trusted channel metadata 的 CasaOS build/apply 均已完成；线上运行
`local/openclaw-amadeus:git-1ccd6f09c6f1-20260918103442`。最近真实 WhatsApp 群入站已调用
`identity_resolve(self)` 并返回 `unbound / trusted_channel_identity_is_not_bound`，随后没有调用
PUBG tool；用户已提供 4 个 WhatsApp 人员的昵称、别名和 PUBG 外部账号，外部 preset 已加载为
4 个 Person、8 个 alias、4 个 `provider=pubg` account。随后按用户明确授权通过现有
`identity_bind_channel` 逻辑，为当前 `secondary` 群账号写入 4 人各自的 LID/手机号 confirmed
binding，共 8 条；自然语言请求是否主动调用 alias resolver、真实群内 PUBG 端到端体验和重启后
持久化仍需继续验收。

### 昵称匹配链路修复（2026-09-18）

本轮已确认失败点不是 Identity 数据：已确认昵称和 PUBG account 均存在，真实群聊失败是模型在
“胶昨天战绩”“猴昨天战绩”前直接生成了未确认回复，没有调用 `identity_resolve` 或 PUBG tool。
源码现已把昵称请求固定为 `identity_resolve(alias/mention/reply)` → `personIds` → PUBG tool：
PUBG/Identity Skill、Identity/PUBG tool descriptions 和 Amadeus `before_prompt_build` 静态上下文
均已补上强制顺序与示例，并增加对应 hook/description 回归断言。Amadeus/PUBG typecheck、build、
定向测试、`git diff --check` 和 secrets scan 已通过；已随 `083f26b` 构建并 apply 新镜像
`local/openclaw-amadeus:git-083f26b1fb13-20260918125134`，runtime 已确认
`before_prompt_build` 注册、三个相关 Skill eligible/model-visible。仍待真实群聊重新发送昵称
战绩请求，确认本轮实际产生 `identity_resolve` → PUBG tool 调用。无投递 smoke 已确认这条
工具链已发生，但暴露出第二层配置问题：此前登记的 `SG_Labmem007/008/004` 与现有
`SG_LabmemNo007/008/004` production team names 不一致，导致 canonical player ID 未命中，
随后官方 exact lookup 返回 `identity_pubg_account_unresolved`。当时的临时兼容 alias 已在用户
随后更正原始账号后撤回：三个账号的正确值是 `SG_LabmemNo007`、`SG_LabmemNo008`、
`SG_LabmemNo004`。本轮同步移除了 Git fixture 和 production team config 中的三个错误 alias，
并把外部 `identity-presets.json` 与 Identity SQLite 的三条 PUBG external account 记录改为
`No` 版本，同时重算对应 `account_id`。修改前可恢复备份为
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918130716-identity-pubg-no-correction`；
更正提交 `c3ec1ac` 已构建并 apply，线上镜像为
`local/openclaw-amadeus:git-c3ec1acca74d-20260918130917`，部署恢复点为
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918130917`。部署后发现 preset 原子替换
留下了 root-only 权限，已将该外部文件恢复为运行时 `node(1000):node(1000)`、`0600`；随后
“胶昨天战绩”和“猴昨天战绩”均实际完成 `read` → `identity_resolve` → `pubg_query_stats`，
各 3 次调用、0 失败并返回 4 场真实数据。为避免未经请求向群聊发测试消息，最后一步仍由用户
在真实群里发送一句昵称战绩请求完成入口验收。

### 群内预设昵称免确认修复（2026-09-18）

随后真实群聊 transcript 显示，模型虽然调用了 `identity_resolve`，但传入
`scope=group`；Identity 旧实现把这个 scope 当成 group-only，因此查不到属于全局预设的
“胶/猴”，返回 `alias_not_found` 后才要求用户确认 PUBG ID。本轮已改为 group alias 优先、
找不到时回退全局预设 alias，并在 Skill/tool guidance 中明确预设成员无需二次确认。提交
`6ec7538` 已构建并 apply，线上无投递 smoke 的“胶昨天战绩”已实际完成
`read` → `identity_resolve` → `pubg_query_stats`，3 次调用、0 失败并返回 4 场真实数据；
未知或 observed candidate 仍保持确认门槛。

### 第一人称 PUBG 身份解析修复（2026-09-18）

新的真实群聊 transcript 显示，当前发送者的可信 WhatsApp LID
`263376739561510@lid` 已绑定到 `Arthur`，外部 PUBG 账号也已是
`SG_LabmemNo007`；但处理“我昨天战绩呢”时，模型错误把请求生成成 `team=true`，跳过了
`identity_resolve(reference=self)`，随后误报 Arthur 未绑定账号。本轮已在 Amadeus dispatch
guidance、Identity/PUBG Skill 和 `pubg_query_stats` description 中明确：`我/我的/本人/自己`
必须先解析当前可信发送者并把 `personId` 传给 PUBG tool；`team=true` 仅用于用户明确要求全队，
不能用于第一人称请求。提交 `f4abc5d` 已构建并 apply，线上镜像为
`local/openclaw-amadeus:git-f4abc5dafb60-20260918132941`，恢复点为
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918132941`。Identity 10、PUBG domain 9、
PUBG plugin 9、Amadeus 10 定向测试及受影响 typecheck/build、secrets scan 和部署 smoke 均通过；
未向真实群聊发送未经请求的测试消息，仍待用户触发一条“我昨天战绩”完成入口验收。

## 当前进度

- 代码阶段：PASS。新增 native plugins/amadeus、owner outbox、VPS 只读通知、
  Codex hook 和 CasaOS 模板；Product Radar 已去掉旧通知依赖；OpenClaw owner 工具策略改为
  `tools.profile="full"`，不再用只包含 PUBG 的严格 allowlist。全局 workspace 已收敛为
  架构、工具真实性、通知和安全原则；PUBG 领域规则全部下沉到 `plugins/pubg` skill，SOUL
  不再固化 PUBG 能力清单。
- 本地测试阶段：PASS。最新 apply 前 build、typecheck、测试和 secrets scan 复跑通过：
  Identity 9、PUBG domain 9、PUBG plugin 8、Amadeus 10、Product Radar 51。
- 部署脚本阶段：PASS。scripts/deploy-openclaw.sh 已改为显式 apply 的一次性迁移入口，包含
  checkpoint、当前 OpenClaw secret 校验、镜像构建、旧 app/data 退休、VPS report cron 和 owner
  WhatsApp smoke；不再从旧 LangBot DB 或旧路径做运行时 fallback。Codex hook 已修复为实际
  使用远端 owner outbox，且不再因缺少 `os` 导入而静默丢弃事件。
- 真实切换阶段：PASS。最新镜像已在 OrbStack Ubuntu CasaOS 运行；OpenClaw、Product Radar、
  media adapter、NAS 只读 smoke、VPS report cron 和 owner WhatsApp outbox 均通过。
- 部署后阶段：PASS。基础迁移 checkpoint 为
  `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918082357`；Telegram username/trusted
  channel metadata 的最新 checkpoint 为 `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918101625`；旧 LangBot/n8n
  容器、app/data 路径和 KOOK watchdog timer 已退休。全局上下文、Codex hook、内部服务
  proxy bypass 和自然语言工具选择均已完成 live 复核。
- Identity preset refresh 部署阶段：PASS。最新 checkpoint 为
  `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918103442`；OpenClaw、Product Radar、
  media adapter network、NAS 只读 smoke 和 owner WhatsApp outbox smoke 均通过。外部
  `identity-presets.json` 已由用户提供的 4 人映射填充并经运行时读取验证；当前 Identity 表为
  `persons=4`、`aliases=8`、`external_accounts=4`、`channel_identities=8`。本次绑定前的可恢复
  备份为 `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918203921-identity-bind`；
  身份数据仍留在 CasaOS 外部运行时目录。
- 部署构建优化阶段：PASS。`scripts/deploy-openclaw.sh` 新增
  `--build-auto`、`--build-openclaw`、`--build-radar` 和 `--no-build`；按 live image 的
  Git commit 选择性构建，并对未构建镜像做 stale check。该流程已用于本次 Identity reply
  bridge，线上镜像和恢复点见上述 Identity 状态及
  `.agent/checkpoints/2026-09-18-openclaw-identity-reply-bridge-deployed.md`。

- VPS live acceptance 阶段：PASS（真实入站查询待用户触发）。最新 checkpoint 为
  `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918122319`，线上镜像为
  `local/openclaw-amadeus:git-e15607cdbbfb-20260918122319`。两个 VPS cron 为
  `30 9`/`0 23 Asia/Shanghai`，allowlist 仅包含四个 VPS read tools 与
  `amadeus_notify_owner`；OpenClaw 重启后 schedule、VPS usage baseline 和 progress-bar prompt
  均保留。VPS 晨间报告首次暴露的 cron owner-context bug 已由 `c1fe427` 修复；随后 VPS 晚间报告真实发送并以
  `sent` marker 与 WhatsApp provider message ID 验证。最新 `e15607c` 将十格进度条设为 Skill
  和已有 cron 的硬格式。CPU throttling 若 API 返回 unknown 必须继续标为 unknown，不得当作健康。

VPS 子目标当前本地 evidence：`pnpm --filter @agent/amadeus-plugin typecheck`、`build:amadeus`、
Amadeus 10 tests、`bash -n scripts/deploy-openclaw.sh`、`py_compile scripts/openclaw_prepare.py`、
manifest JSON validation 和 `git diff --check` 已通过。
- 昵称匹配修复 evidence：Amadeus 10、PUBG plugin 8 定向测试，受影响 package
  typecheck/build、`pnpm check:secrets` 和 `git diff --check` 已通过；新镜像已 live apply，
  恢复点为 `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918125134`，真实群聊
  端到端无投递工具调用验证已通过（“胶”与“猴”各一次，失败数 0）；未向群聊发送未经请求的
  测试消息，真实 WhatsApp 入口由用户触发验收。

## PUBG-only 根因修复验收

- live `tools.profile=full`，没有 `tools.allow` 严格白名单；WhatsApp 群组为 `open`、
  `requireMention=false`，群组没有 `tools`/`toolsBySender` 限制，因此成员继承完整 OpenClaw
  工具能力，而不是只继承 PUBG。
- `pubg` 6 个工具和 `amadeus` 7 个工具均显示 `origin= bundled`、`trust= bundled`、
  `status=loaded`；这也修复了 Amadeus owner notifier 被非信任插件拒绝的问题。
- WhatsApp secondary account 为 linked/healthy，真实 owner outbox smoke 已生成 sent marker。
  未向群聊发送未经请求的测试消息；群聊能力边界已由 live config 和 plugin/tool inspect 验证，
  可由用户在群内发一条普通能力消息做最终体验确认。

## 迁移后能力选择验收

- OpenClaw 自然语言只读请求成功选择 `amadeus_product_radar`，返回当前 1 个监控项；
  `successfulToolNames` 只有 `amadeus_product_radar`，tool failures 为 0，未发送通知或修改配置。
- Codex hook smoke 已写入远端 outbox 并生成 sent marker；事件没有 channel/recipient/to 字段，
  仍由 OpenClaw owner worker 负责 WhatsApp 送达。
- OpenClaw 内部服务名已加入 `NO_PROXY`，Product Radar 原生工具不会再误走宿主代理；
  `tools.profile=full`、WhatsApp group `open`、免 mention 且无群组工具限制仍保持。

## 不接受的替代

不恢复 LangBot/Mastra/n8n 业务链，不做 shadow/double-run/关键词路由/兼容 fallback；
不把 Telegram/KOOK proactive notification 重新接回；不把真实平台送达用 health、mock、
provider trace 或插件 smoke 冒充。

## 恢复边界

所有旧 app/data、compose、database、OpenClaw config/secrets 和 Codex hook 都必须在
仓库外 dated checkpoint；不删除现有 Avalon media library。媒体工作只允许明确单项并遵循
备份、preview、确认和 collision 检查。
