# Architecture

更新时间：2026-09-18（Asia/Shanghai）

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
                                 ├─ curated RSS/JSON + 9Router briefing
                                 └─ WhatsApp owner outbox/delivery
\`\`\`

OpenClaw 是唯一 Agent runtime。没有 LangBot/Mastra/n8n runtime、旧 facade、关键词路由、
第二个 planner 或业务 fallback。LLM 只在 OpenClaw planner/表达边界和 briefing summary
边界；统计、权限、预览确认、状态转换和排序保持 deterministic。

## 原生插件边界

### PUBG

\`plugins/pubg\` 注册：

- \`pubg_resolve_players\`
- \`pubg_search_matches\`
- \`pubg_query_stats\`
- \`pubg_compare_stats\`
- \`pubg_get_match\`
- \`pubg_get_review_facts\`

\`packages/pubg-domain\` 不导入 OpenClaw、Telegram、WhatsApp、LangBot 或旧 app。它接收
校验后的 platform-neutral selector，返回 status、coverage、asOf、metricVersion、
queryResolved 和 evidenceRefs。身份来自可信 tool context；渠道显示名、手机号和 JID
不能成为 PUBG 玩家名。

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
- \`amadeus_notify_owner\`：不接受 channel/recipient 参数，只能写入或经 OpenClaw 投递
  固定 WhatsApp owner。
- \`amadeus_briefing\`：读取 Git 内 curated source/config，做时间过滤、关键词主题评分、
  去重和 9Router 总结；早报/晚报只交给 owner notifier。

### Owner notification contract

Product Radar、Codex hook、媒体完成、HomeLab 和 briefing 都使用同一 v1 event：

\`\`\`json
{
  "version": 1,
  "eventKey": "stable-idempotency-key",
  "source": "business-source",
  "title": "human title",
  "message": "body",
  "occurredAt": "ISO-8601"
}
\`\`\`

事件不含 channel、recipient、bot token 或平台 ID。业务可以写
\`/DATA/AppData/openclaw/notifications/*.pending.json\`；OpenClaw worker 负责
WhatsApp owner 投递、长消息分段、sent marker 和幂等 retry。Telegram/KOOK 只作为聊天入口，
不作为 proactive target。

## 独立外部服务

- Product Radar 使用自己的 SQLite、changedetection 和 FashionSigLIP 配置，通过 HTTP 接收
  native plugin 的 structured request；不依赖 OpenClaw 进程回调。
- media-organizer-adapter 是独立 read-only container image，拥有明确的 downloads/media/
  backup mount；OpenClaw 不挂载媒体目录、不挂 Docker socket。
- NAS SSH key、Telegram/KOOK token、PUBG key/team、WhatsApp owner target 和 9Router
  credential 都在运行时 secret 文件或外部 env。
- briefing source/config 在 \`plugins/amadeus/briefing/config\`，不再读取 n8n Git 工作树
  或 LangBot API credential。

## CasaOS 发布

canonical runtime 是 OrbStack \`ubuntu\` 内的 CasaOS：

- OpenClaw Compose：\`/var/lib/casaos/apps/openclaw/docker-compose.yml\`
- Product Radar Compose：\`/var/lib/casaos/apps/product-radar/docker-compose.yml\`
- OpenClaw AppData：\`/DATA/AppData/openclaw\`
- 固定基础镜像：\`ghcr.io/openclaw/openclaw:2026.9.4\`，使用已核验 ARM64 digest
- provider：\`9router:20128/v1\`，默认 route \`nine_router/arthur-combo\`
- media adapter、Product Radar、changedetection 和 9Router 作为独立依赖保留

\`scripts/deploy-openclaw.sh --apply --build\` 的顺序是：

1. Git clean、全量 build/typecheck/test/secrets scan。
2. BuildKit 构建并加载 OpenClaw Amadeus 与 Product Radar ARM64 immutable images。
3. 在仓库外备份 compose、config、secret、OpenClaw SQLite 和旧 app 状态。
4. 只验证现有 OpenClaw 运行时 secret 文件和 owner/Telegram 配置；旧 LangBot DB、旧
   app/data 和旧凭据只留在仓库外 checkpoint 用于审计/人工恢复，不参与运行时 fallback。
5. 新 compose/config 预检，确认两个 plugin 和两个 Skill 都已加载。
6. 停止 LangBot、n8n、n8n-sandbox，移除其 canonical app/data 路径到 checkpoint。
7. 启动 Product Radar/OpenClaw，注册 09:30/23:00 Asia/Shanghai briefing cron。
8. 检查 health、media adapter、NAS read-only SSH、channel status 和真实 WhatsApp owner outbox。

旧数据仅用于备份/审计/恢复，不作为运行时 fallback；未执行旧架构回滚演练。
