# Agent State

更新时间：2026-09-20（Asia/Shanghai）

当前执行 `docs/AMADEUS_ARCHITECTURE_CONVERGENCE_GOAL.md`。已从 `origin/main` 拉取目标并
rebase 本地提交；Phase 1-2 已完成源码验证：Amadeus thin bootstrap/capability registrations、
capability Skills、global prompt ownership cleanup 和收紧 persona meme trigger 均已落地。
Phase 3-5 也已完成：Presentation contracts/renderers/time formatter、owner hard validation、PUBG
structured presentation、architecture fitness check 和 workflow integration 均已验证。下一步只做
Phase 6 release validation、minor version bump、implementation commit/push、CasaOS deploy 和
deployment evidence commit/push；其中 implementation commit/push、1.3.0 release build/apply、live
health/preflight/smoke 与 doctor 已完成，当前只剩 docs-only deployment evidence commit/push。

本轮真实 WhatsApp trajectory 审计发现周期队友动作查询只走基础 Match API，新增
`pubg_query_team_damage` 作为 Domain-owned batch Telemetry contract，覆盖全队误伤详情和
007 → 004 KICK 计数；Domain 22/22、Plugin 9/9、全仓验证已通过。版本 `1.4.0` 的提交
`6ee03d0` 已 push 并完成 CasaOS apply；live image、tool/Skill preflight、health、外围 smoke
和 doctor 均通过。部署证据已提交并 push，当前只剩本次版本策略单独提交。

版本策略已按用户要求调整：当前 live release 保持 `1.4.0`，以后只使用 `bump patch` 按 `0.0.1`
递增，`0.0.9 -> 0.1.0`、`0.9.9 -> 1.0.0`，不再使用 `bump minor`/`bump major`。

本次 1.3.0 live release：implementation commit `7d85bc1`；OpenClaw image
`local/openclaw-amadeus:git-7d85bc10f15d-20260920041059`；Product Radar image
`local/product-radar:git-7d85bc10f15d-20260920041059`；checkpoint
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260920041059`。health、plugin/Skill preflight、
owner worker/outbox、NAS read-only、media connectivity、legacy runtime retirement 和 doctor 均 PASS。
没有发送未经请求的真实群聊消息，真实自然语言 inbound/final-reply 仍明确标记为 pending。

当前 Goal：按 docs/OPENCLAW_AMADEUS_MIGRATION_GOAL.md，将仍有价值的旧多领域能力迁移到
OpenClaw/Kurisu native Amadeus plugin 与独立服务，并退休 LangBot、n8n、旧 runtime、
旧通知 bridge 和旧 proactive producer。

当前子目标：完成 PUBG Telemetry 小时预取、缓存语义修正、D-mail 每日 owner 汇总，并继续
实现跨 Telegram/WhatsApp 的 canonical Person identity、昵称候选学习和
provider-neutral external account；Identity reply metadata bridge、provider-native channel metadata
和 Telegram trusted username patch 已完成新的 CasaOS apply，线上真实 sender binding/账号 linking
仍待真实用户入口验收；VPS 只读查询、真实 WhatsApp 早晚报告 smoke 和重启持久化已完成，仍待
用户从真实 WhatsApp 入站发送一条自然语言 VPS 查询。

当前状态：PUBG Telemetry 预取与 D-mail 基础能力已部署；PUBG 全部用户可见时间统一北京时间的 1.1.5 已完成 release build/apply，live Amadeus 已加载并通过 health、preflight、插件注册和 bundle 规则核验。本轮又定位并修复部署通知结尾重复，1.1.7 已完成 release apply，实际 owner smoke 已核实结尾语全文只出现一次。此前方向性结果与来源时间范围修复已完成 1.1.4 release build/apply，既有复盘新鲜度、relative_period 06:00 解析、缓存语义、周期复盘顺序和“所有 PUBG 路由事实必须走工具”修复已完成 release build/apply；PUBG 工具默认从持久化 SQLite 缓存/更新结果取事实，上下文只解析参数，不提供数据；周期复盘默认正序、最近一局保持倒序；部署通知已改为只读取单次发布摘要，不累计历史内容；全局上下文拆分、旧 secret fallback 清理、Codex hook 修复、内部服务 proxy bypass、
提交/push、CasaOS apply、外部 checkpoint、真实 WhatsApp owner smoke、自然语言工具选择和旧
app/data 退休均 PASS；本轮 Telegram trusted username patch 与 Identity preset 动态刷新已通过
选择性镜像构建重新 apply 到线上；PUBG plugin 现会同步刷新缓存的 IdentityStore。

VPS 公网入口 follow-up 已完成：Cloudflare 525 的根因是 Caddy 缺少已有 frps 映射的
`jellyfin`、`aria`、`qb`、`monitor` 和 `9router` site；现已补齐并取得证书，Immich、Jellyfin、
AriaNG、qBittorrent、Glances、9Router 的公网回源均通过。OpenClaw 配置未修改；Caddy 回滚副本
保留在 VPS `/etc/caddy/backups/Caddyfile.pre-public-services-20260919T161251Z`。

已落地：

- plugins/amadeus：Product Radar、Emby media safety flow、NAS、HomeLab、KOOK lookup、
  briefing、owner notifier/retry worker；
- Product Radar channel-free owner outbox 和 Codex channel-free hook；
- OpenClaw Amadeus config/template、workspace policy、固定 image Dockerfile；
- Product Radar compose 去除 LangBot/Telegram/KOOK notification keys；
- NAS source 移到 infra/macos/nas-control.sh；
- briefing config 保留旧日报的来源/主题/调度意图，但通知目标固定为 WhatsApp owner；
- scripts/deploy-openclaw.sh 和 scripts/openclaw_prepare.py 的一次性迁移/退休流程。
- 全局 workspace 只保留通用规则；PUBG 领域规则在 `plugins/pubg/skills/pubg/SKILL.md`；
  OpenClaw prepare 不再读取旧 LangBot DB，Codex hook 使用远端 owner outbox。
- owner 工具策略固定为 `tools.profile="full"`；live baseline 的 PUBG-only allowlist 根因已记录并
  在部署 preflight 中设为硬失败条件。PUBG/Amadeus 已作为 bundled/trusted plugins 加载，
  因此 Amadeus owner notifier 可正常调用 Gateway runtime。
- `packages/identity`、Amadeus `identity_*` tools/Skill 和 PUBG identity boundary 已加入源码；
  identity SQLite 与 presets 使用 `/data` 外部路径，确认写入受 owner gate，observed alias
  只能作为 candidate。线上已运行
  `local/openclaw-amadeus:git-1ccd6f09c6f1-20260918103442`，SOUL/MEMORY 与 Git 哈希一致，四张
  身份表仍为空；外部 `identity-presets.json` 可在运行后安全刷新，等待用户填写。
- Amadeus typed `before_dispatch` hook 只把 OpenClaw 可信 `replyToSender` 短时传给同一
  session 的 Identity tools，`agent_end` 清理；没有 reply metadata 时仍 fail closed。mention
  仍要求 host 提供结构化 platform ID，不解析昵称或 prompt。Pinned Telegram bundle 和外部
  WhatsApp package 现已通过 source-controlled、版本锚定补丁传递真实 mention/sender ID；Telegram
  `@username` 只有在同一会话内由 trusted sender metadata 先建立对应关系时才可解析。
- VPS read-only 子目标已完成 live 部署阶段：五个 bounded native tools、VPS Skill、KiwiVM 三个固定
  read endpoints、SSH 固定 probe、traffic baseline/stale semantics、secret mounts 和 VPS
  report cron 已加入源码；最新 Amadeus 10 tests、build/typecheck、脚本检查和 diff check 通过。
  Gateway 自然语言 smoke 已实际调用五个 VPS tools；晚间 report 已真实到达 WhatsApp owner DM，
  重启后 cron、usage baseline 和十格进度条提示仍存在。只剩真实 WhatsApp 入站查询证据。

最新已部署 PUBG 版本：提交 `fdf331c`，镜像 `local/openclaw-amadeus:git-fdf331cbca89-20260919071937`，恢复点
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260919071937`；未发送未经请求的真实群聊测试消息。

美股指数通知子目标已完成部署：`amadeus_market_indices` 固定观测 `^NDX`/`^GSPC`，美东
09:35/16:05 工作日 cron 经 WhatsApp owner outbox 通知，休市返回 `market_closed`；版本
`1.2.0`、提交 `5117aa5`、checkpoint `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260919102358`。

下一步：

1. 在真实 Telegram/WhatsApp 私聊和群聊入口完成 sender binding、PUBG account/link、群 alias
   candidate/confirm 和重启持久化验收；不能用伪造 ID 或 provider trace 代替。
2. 记录真实 inbound/outbound 结果和数据库重启前后摘要；当前 live DB 只有 schema、四张表
   均为 0 行，安全地等待真实用户确认。
3. 继续保留 `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918122319` 作为最新恢复点，
   不恢复已退休的 LangBot/n8n/旧 Runtime；VPS secret、受限 SSH probe/key、早晚 cron、真实
   WhatsApp owner report 和重启持久化均已验收。等待用户从 WhatsApp 发送自然语言查询，记录
   inbound/tool trace/final reply 后再关闭 VPS 子目标。

约束：不恢复 LangBot/Mastra/n8n 业务链；不做灰度、shadow、双跑、兼容 fallback 或回滚
演练；不提交 secret/业务数据；不修改现有 Avalon media library；长期服务只部署在
OrbStack ubuntu CasaOS。
