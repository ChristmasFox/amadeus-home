# Decisions

更新时间：2026-09-24（Asia/Shanghai）

## OpenClaw 是唯一 Agent 宿主

采用 OpenClaw 2026.9.4 原生 plugin 机制，当前 9Router route 保持不变。OpenClaw 负责
自然语言、会话和最终回复；plugin 只注册结构化工具，不恢复旧 Runtime、LangBot/n8n
orchestrator、关键词路由或第二个 Agent。

## Domain 与平台解耦

PUBG Domain 位于 `packages/pubg-domain`，只接收结构化输入并输出确定性事实、coverage、
版本和 evidenceRefs。Telegram、KOOK、WhatsApp 和 OpenClaw SDK 停留在 plugin/config 边界。

## 能力迁移与退休

Product Radar、媒体整理、NAS、HomeLab、VPS、KOOK 群成员和 Codex 通知进入
`plugins/amadeus`；Product Radar 保持独立服务。旧 LangBot plugin、n8n workflow、旧
通知 sender、watchdog 和 Runtime 已删除，不保留双实现或 fallback。

## Owner 通知

事件生产者只写 channel-free、幂等的 outbox event。OpenClaw worker 只向 WhatsApp owner DM
投递；Telegram/KOOK 可以保留聊天入口，但不再作为 proactive notification channel。发送
失败保留 pending 文件并重试，不能把入队当作已送达。

## Presentation 与时间 ownership

跨能力用户输出统一经过 `packages/presentation` 的 runtime-validated contract 和
deterministic renderer。PUBG 单局/周期复盘和 owner notification 的结构由 contract 约束；
PUBG 复盘工具返回结构化 presentation，OwnerNotifier 在固定发送边界再次校验并渲染，未通过
校验的事件不会作为成功通知发送。

Instant 以 ISO 保存，PUBG relative query 的 06:00 日界线只由 Domain resolver 拥有，Telemetry
daily report 由独立 use case 按 calendar day 汇总；display time 只由 presentation formatter
负责。默认同日只显示 `HH:mm`，跨日显示 `YYYY-MM-DD HH:mm`，不把实现时区或 resolver metadata
写进默认用户正文。

## 一次性切换

迁移脚本默认 dry-run；`--apply --build-auto` 按 live immutable image 的 Git commit 只
构建受影响的 OpenClaw/Product Radar 镜像，`--apply --no-build` 复用未过期镜像；只有
`--apply --build` 才强制全量双镜像构建和完整验证。所有 apply 仍会备份、启动/更新
OpenClaw 与 Product Radar、注册 VPS 报告 cron，并以真实 owner WhatsApp smoke 作为交付
验收。所有旧数据先进入仓库外 checkpoint；不做 shadow、双写、灰度或回滚演练。

## Secrets 与部署

生产 secret、owner identity、队伍配置、API key 和数据库只存在 OrbStack `ubuntu` 的外部
路径。CasaOS compose 位于 `/var/lib/casaos/apps`，服务使用 `docker compose up -d
--no-build`；需要构建时先由 host BuildKit 生成固定 image，再显式 apply。

## 1.4.9 Longbridge 市场与 M204 HostAgent

Longbridge OpenAPI OAuth 2 是唯一公共市场数值来源；没有 provider fallback、账户/余额/持仓、
订单或交易工具。`amadeus_market_overview`、`amadeus_market_quote`、`amadeus_market_intraday`、
`amadeus_market_session`、`amadeus_market_movers` 只暴露 bounded public read surface，symbol
normalization、前收/百分比、session/calendar、数值精度和方向 glyph 由确定性代码拥有。OpenClaw
cron 仍使用 `America/New_York` 触发检查，但 Longbridge trading-day/session 决定事件是否有效；
成功通知沿用 `market-indices:<date>:<open|close>` 幂等 key 和既有 owner outbox。

M204 host telemetry 由 launchd-managed MacHostAgent 提供固定 bearer-authenticated read-only
routes；OpenClaw 只注册 status/process 两个 owner/private tools，不提供 arbitrary exec 或 broad sudo。
`powermetrics` 权限不足只把 power telemetry 标为 degraded，不影响其他 host facts。
