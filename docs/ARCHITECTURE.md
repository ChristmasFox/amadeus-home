# Architecture

更新时间：2026-09-20（Amadeus 1.4.2 implementation in progress）

## Worldline notification boundary

主动通知统一经过：业务事实 → capability adapter →
`WorldlineNotificationIntent` → deterministic theme policy → validated
`OwnerNotificationPresentation` → owner outbox / delivery policy。Domain 和
Product Radar generic core 不持有 Steins;Gate 词汇、transport destination 或
WhatsApp 语义；severity 与 significance 是两个独立字段。生产者清单见
`docs/PROACTIVE_NOTIFICATION_PRODUCERS.md`，正式词汇与映射见
`packages/presentation/src/worldline/`。

当前持久化运行目标仍是 OrbStack `ubuntu` 内的 CasaOS。OpenClaw 与 Product
Radar 使用可配置的 `amadeus_network`，主机、Mac control user、FashionSigLIP
端口和 Codex hook 路径由 `scripts/host-profile.sh` 统一解析；真实值在本机
`infra/host-profile.env`，不进入 Git。Operation Skuld 只做 readiness 和临时
恢复演练，本目标不执行 Mac mini cutover。

## 单一 Agent 主链

\`\`\`text
Telegram / WhatsApp / future OpenClaw channel
       │ native channel transport and delivery
       ▼
OpenClaw 2026.9.4 / Kurisu workspace / current 9Router
       │ model-owned planning, session, memory, cron and final response
       ├──────────────────────────────┐
       ▼                              ▼
plugins/pubg                    plugins/amadeus
       │                              │
       ▼                              ├─ Product Radar HTTP service
packages/pubg-domain             ├─ media-organizer-adapter
       │                         ├─ Mac NAS fixed SSH commands
       ▼                         ├─ Glances / HomeLab probes
official PUBG API + SQLite       ├─ KOOK API, current-session only
                                 ├─ KiwiVM + bounded read-only VPS SSH probes
                                 ├─ deterministic NASDAQ-100/S&P 500 market observer
                                 └─ WhatsApp owner outbox/delivery
\`\`\`

Identity 是共享的 native capability：`plugins/amadeus` 暴露工具，platform-neutral
`packages/identity` 持久化 canonical Person、可信 channel binding、群/全局 alias 和
provider-neutral external account。OpenClaw 只提供可信 channel/account/sender metadata；
`plugins/pubg` 在边界将 `provider=pubg` account 转换成 Domain 可理解的 player id/name，
`packages/pubg-domain` 不接触 Telegram/WhatsApp、昵称、手机号或 JID。

OpenClaw 是唯一 Agent runtime。没有 LangBot/Mastra/n8n runtime、旧 facade、关键词路由、
第二个 planner 或业务 fallback。LLM 只在 OpenClaw planner/表达边界；统计、权限、预览确认、
状态转换和排序保持 deterministic。

## Presentation contract 与时间语义

`packages/presentation` 是跨能力的结构化用户输出边界，当前提供
`PubgMatchReview`、`PubgPeriodReview` 和 `OwnerNotification` 三类合同。合同先做运行时校验，
再交给 deterministic renderer；数字的 `null` 仍表示未知，事实段通过 `evidenceRefs` 追溯，
不得由 renderer 补成零或猜测成功。

时间分三层处理：输入瞬间保留 ISO instant，PUBG Domain 负责查询周期（默认北京时间 06:00 起始），
renderer 负责用户显示时间。默认同一显示日只显示 `HH:mm`，跨显示日显示
`YYYY-MM-DD HH:mm`；默认正文不泄漏实现时区名、`UTC+08`、`自然日` 或 `业务日` 等内部标签。
市场和 Telemetry 的统计周期可以保持各自的机器证据，但必须在 capability contract 中明确，不能
由全局人格或 workspace 规则解释。

`plugins/amadeus/src/index.ts` 只负责单一 plugin 的 bootstrap；每个 capability 在
`src/capabilities/<name>/register.ts` 注册，公共 lifecycle/工具包装在 `src/shared/`，业务实现
仍留在同一个 plugin 内，不拆成第二个 runtime 或 sender。

## 原生插件边界

### PUBG

\`plugins/pubg\` 注册：

- \`pubg_resolve_players\`
- \`pubg_search_matches\`
- \`pubg_query_stats\`
- \`pubg_compare_stats\`
- \`pubg_get_match\`
- \`pubg_get_review_facts\`
- \`pubg_query_team_damage\`
- \`pubg_prefetch_telemetry\`
- \`pubg_telemetry_sync_report\`

`pubg_query_team_damage` 是周期队友动作/误伤的唯一批量 Telemetry use case：省略方向时返回
所有 `actor → victim`，指定 actor/victim 时返回单一方向；`source=MELEE` 和
`meleeKind=KICK|PUNCH` 由 Domain 确定性筛选。它自己刷新比赛并逐局确保 Telemetry，不能把
`pubg_search_matches` 的 Match API coverage 当作 Telemetry coverage；不可用对局返回
`partial` 和 `null`，不静默归零。

\`packages/pubg-domain\` 不导入 OpenClaw、Telegram、WhatsApp、LangBot 或旧 app。它接收
校验后的 platform-neutral selector，返回 status、coverage、asOf、metricVersion、
queryResolved 和 evidenceRefs。未绑定 sender 或缺少 PUBG account 时，plugin 返回明确
identity error，不静默使用默认队伍。

PUBG 的 `pubg_prefetch_telemetry` 是唯一的定时预取入口：每小时刷新玩家列表，增量获取 Match
详情，再对新对局/到期重试对局获取 Telemetry。持久化账本区分 cache hit、成功 fetch 和不可用，
因此 `cacheStatus=FETCHED` 才表示一次成功的官方抓取，底层 `cacheLookup=MISS` 只是说明抓取前
没有缓存，不等价于数据缺失；真正不可用才是 `UNAVAILABLE`。PUBG 工具输出同时提供
`dataUpdatedAt`。LLM 负责把“今天/昨天/复盘”等自然语言识别为结构化意图，Domain 接收
`relative_period` 后按 `Asia/Shanghai` 的 `06:00` 业务日确定性解析；Telemetry 复盘必须携带
当前新鲜 `pubg_search_matches` 的 `resultSetId`，旧结果不会被复用。每日 00:00 的
`pubg_telemetry_sync_report` 只汇总上一自然日并生成 owner outbox 的 D-mail payload；交互查询
仍使用 `06:00` 业务日。官方限流和端点规则以
[PUBG API Rate Limits](https://documentation.pubg.com/en/rate-limits.html) 为准。

### Amadeus

\`plugins/amadeus\` 是唯一多领域业务入口：

- \`amadeus_product_radar\`：显式结构化 watch lifecycle 和 statistics/context。
- \`amadeus_media_organize\`：只调用独立 adapter；同一会话保存 preview，execute 需要
  owner、previewId 和 \`confirm=true\`。
- \`amadeus_nas\`：固定命令 \`nas.status\`、\`nas.disk\`、owner-only \`nas.sleep\`；
  不接受任意 shell。
- \`amadeus_homelab_status\`：Glances、uptime 和固定探针；读取为主，显式 owner/cron
  才能通知，不负责重启。
- \`amadeus_kook_group_members\`：只能读取当前 KOOK channel/guild，不主动推送。
- \`amadeus_notify_owner\`：不接受 channel/recipient 参数，接受已校验的
  \`owner_notification\` presentation 或 \`WorldlineNotificationIntent\`。Intent 的 theme 由
  deterministic policy 选择，severity 与 significance 分离；两者都只能写入 owner outbox，
  当前 delivery policy 才固定 WhatsApp owner。
- \`amadeus_vps_service_info\`、\`amadeus_vps_live_status\`、\`amadeus_vps_usage\`、
  \`amadeus_vps_system_status\`、\`amadeus_vps_services\`：只读 KiwiVM/API 与固定 SSH probe；
  不接受 endpoint、unit、shell、VPS 控制动作或通知目标。traffic state 保存在 \`/data\` 外部
  文件，失败返回 stale/error，不能把未知值归零。
- Identity tools：\`identity_resolve\`、\`identity_get_person\`、
  \`identity_bind_channel\`、\`identity_add_alias\`、\`identity_link_account\`、
  \`identity_list_candidates\`、\`identity_confirm_candidate\`。observed alias 只作为候选，
  必须经 Arthur 确认后才成为 authoritative binding。
- `amadeus_market_overview`、`amadeus_market_quote`、`amadeus_market_intraday`、
  `amadeus_market_session`、`amadeus_market_movers`：通过 Longbridge OpenAPI OAuth 2
  读取 `.IXIC.US`、`.NDX.US`、`.SPX.US`、`.DJI.US` 和显式 US equity 的公共行情；前收、涨跌、
  百分比、区间、方向和显示格式由确定性 domain/presentation 计算。 Longbridge trading-day/session
  是开收盘有效性的唯一依据；不可用时返回结构化失败，不发送旧值或假值。 OpenClaw cron 只触发
  检查，固定时钟不取代交易日事实，并只把有效结构化通知交给 owner outbox。

### Owner notification contract

Product Radar、Codex hook、媒体完成、HomeLab、市场和 PUBG 同步都使用同一 v1 event；新生产者
先提交 \`WorldlineNotificationIntent\`，再由确定性 policy 生成 presentation：

\`\`\`json
{
  "version": 1,
  "type": "owner_notification",
  "eventType": "business_event",
  "severity": "info",
  "significance": "notable",
  "theme": "worldline_observation",
  "eventKey": "stable-idempotency-key",
  "source": "business-source",
  "headline": "human headline",
  "facts": [
    { "label": "fact", "value": "value", "evidenceRefs": [] }
  ],
  "summary": "body",
  "occurredAt": "ISO-8601",
  "worldLineClosing": true
}
\`\`\`

事件不含 channel、recipient、bot token 或平台 ID。旧 outbox 中的 `title/message` 仅在读取重试时
做一次性内存兼容转换，新写入统一为上述合同。业务可以写
\`/DATA/AppData/openclaw/notifications/*.pending.json\`；OpenClaw worker 负责
WhatsApp owner 投递、合同渲染、长消息分段、sent marker 和幂等 retry。Telegram/KOOK 只作为聊天入口，
不作为 proactive target。

## 独立外部服务

- Product Radar 使用自己的 SQLite、changedetection 和 FashionSigLIP 配置，通过 HTTP 接收
  native plugin 的 structured request；不依赖 OpenClaw 进程回调。
- media-organizer-adapter 是独立 read-only container image，拥有明确的 downloads/media/
  backup mount；OpenClaw 不挂载媒体目录、不挂 Docker socket。
- NAS SSH key、Telegram/KOOK token、PUBG key/team、WhatsApp owner target 和 9Router
  credential 都在运行时 secret 文件或外部 env。
- KiwiVM VEID/API key、VPS read-only SSH key 和 known-hosts 文件都在运行时 secret；VPS
  SSH user 应使用受限 forced-command key，OpenClaw 容器不挂载通用 root SSH key。

## CasaOS 发布

canonical runtime 是 OrbStack \`ubuntu\` 内的 CasaOS：

- OpenClaw Compose：\`/var/lib/casaos/apps/openclaw/docker-compose.yml\`
- Product Radar Compose：\`/var/lib/casaos/apps/product-radar/docker-compose.yml\`
- OpenClaw AppData：\`/DATA/AppData/openclaw\`
- Identity SQLite：\`/DATA/AppData/openclaw/data/identity.sqlite\`；可选外部预设文件为
  \`/DATA/AppData/openclaw/data/identity-presets.json\`，生产 channel ID/JID 只留运行时数据。
- VPS traffic state：\`/DATA/AppData/openclaw/data/vps-usage-state.json\`；KiwiVM credentials、
  read-only SSH key 和 known-hosts 文件位于 \`/DATA/AppData/openclaw/secrets/\`，不进入 Git。
- 固定基础镜像：\`ghcr.io/openclaw/openclaw:2026.9.4\`，使用已核验 ARM64 digest
- provider：\`9router:20128/v1\`，默认 route \`nine_router/arthur-combo\`
- media adapter、Product Radar、changedetection 和 9Router 作为独立依赖保留

部署脚本的镜像策略是：

- \`--apply --build-auto\` 读取 CasaOS 当前容器的 immutable Git image tag，只构建受影响的
  OpenClaw 或 Product Radar 镜像；workspace、SOUL/AGENTS、config、Compose 和脚本改动不
  会触发镜像构建。
- \`--apply --no-build\` 复用现有两个镜像，并对镜像 source commit 做 stale check；若业务
  source 已经超出镜像，脚本 fail closed，要求改用选择性的 build 选项。
- \`--apply --build-openclaw\`、\`--apply --build-radar\` 是单镜像构建入口；\`--apply --build\`
  是保留的全量双镜像 release 入口，并执行完整验证。

无论是否构建，apply 的切换/验收顺序是：

1. Git clean、按受影响镜像执行定向验证和 secrets scan；全量 \`--build\` 额外执行完整
   build/typecheck/test。
2. 只构建并加载需要更新的 ARM64 immutable image，其他服务复用已加载 image。
3. 在仓库外备份 compose、config、secret、OpenClaw SQLite 和旧 app 状态。
4. 只验证现有 OpenClaw 运行时 secret 文件和 owner/Telegram 配置；旧 LangBot DB、旧
   app/data 和旧凭据只留在仓库外 checkpoint 用于审计/人工恢复，不参与运行时 fallback。
5. 新 compose/config 预检，确认两个 plugin 和两个 Skill 都已加载。
6. 停止 LangBot、n8n、n8n-sandbox，移除其 canonical app/data 路径到 checkpoint。
7. 启动 Product Radar/OpenClaw，注册 09:30/23:00 Asia/Shanghai VPS report cron；VPS cron
   只 allow-list 四个 VPS read tools 与 \`amadeus_notify_owner\`。
8. 检查 health、media adapter、NAS read-only SSH、channel status 和真实 WhatsApp owner outbox。

旧数据仅用于备份/审计/恢复，不作为运行时 fallback；未执行旧架构回滚演练。

## Voice I/O boundary (1.5.3 candidate; not yet live)

WhatsApp stays transport-only. Pinned OpenClaw/Kurisu owns the existing session, transcription lifecycle, tools and `tts.auto=inbound` response modality. 9Router remains the sole speech route/control plane via logical `amadeus-asr` and `amadeus-tts` aliases; the existing Chat Combo does **not** satisfy STT. A native M204 user-session Qwen3-TTS service at port 18792 only synthesizes authenticated bounded text with the operator-owned `kurisu-v1` profile; it has no conversation, planner, channel or notification logic. The example config is not deployed until direct STT/TTS and WhatsApp acceptance prove this chain and text fallback. No Telegram-specific speech path is part of this release.
