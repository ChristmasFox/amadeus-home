# Project State

更新时间：2026-09-18（Asia/Shanghai）

## 当前目标

唯一执行目标是 OPENCLAW_PUBG_REFACTOR_GOAL.md：Telegram/WhatsApp 聊天 → 唯一 OpenClaw/Kurisu
→ 当前 9Router → 原生 PUBG plugin 及渠道适配层 → 独立 PUBG Domain → 官方 PUBG API/SQLite。旧多领域
实现和历史状态文档不再是可执行依据。

## 当前阶段

S0、S1、S2、S3 已完成；S4 的所有可执行项已完成。唯一未闭环项是 Telegram 自然入站
私聊验收：原生 channel 已连接，但没有测试账号或自然入站，不能伪造送达。

## 已固定的实现

- OpenClaw：官方 ghcr.io/openclaw/openclaw:2026.9.4，插件加载目录 /app/extensions/pubg。
- Gateway UI：CasaOS 端口 `18789` 当前绑定 `0.0.0.0`，局域网入口为
  `http://192.168.5.3:18789/`；Control UI 仍需使用外部保存的 gateway token 完成认证。
  公开入口 `https://claw.nyannyan.top/` 由 Cloudflare 代理，经 VPS Caddy HTTPS 和 FRP
  `openclaw-tcp` 回源到该端口；Control UI WebSocket 来源已加入 `allowedOrigins`。
- provider：现有 9Router，模型 route nine_router/arthur-combo，不换模型绕过验收。
- Telegram：OpenClaw native channel；私聊 numeric allowlist 来自外部配置；群聊已启用，
  所有群默认 `requireMention=false`，`groupPolicy=open`，所有群成员均可触发回复。
- WhatsApp：OpenClaw WhatsApp Web 的 `secondary` 账号已完成配对并在线，作为默认账号；私聊
  默认 `dmPolicy=pairing`，群聊 `groupPolicy=open` 且通配配置 `requireMention=false`，所有
  群成员可直接触发 PUBG 回复。旧默认账号配对目录已移入仓库外备份。
- Plugin adapter：`plugins/pubg/src/adapters/` 只归一化 OpenClaw 渠道/session context；
  Domain 不依赖 Telegram、WhatsApp 或其他平台，后续接入只新增 adapter/渠道配置。
- 群聊身份边界：sender display/profile/push name、手机号和 JID 只属于渠道元数据，不能作为
  PUBG `playerNames`；“昨天战绩/我的战绩”等未指定玩家的请求使用外部配置团队，不从群成员
  名称推断玩家。该约束已进入 workspace AGENTS、bundled Skill 和工具 schema 描述。
- Plugin：pubg_resolve_players、pubg_search_matches、pubg_query_stats、
  pubg_compare_stats、pubg_get_match、pubg_get_review_facts。
- Domain：packages/pubg-domain 只接收结构化 selector，确定性返回 status/coverage/
  asOf/metricVersion/queryResolved/evidenceRefs；SQLite 位于 OpenClaw data volume。
- Product Radar：仍是独立应用，默认 notification owner 为 disabled；不会调用已退休
  PUBG/通知端点。

## 迁移与退休清单

- 迁移输入：旧 n8n SQLite、旧 state/features；目标 /DATA/AppData/openclaw/data/pubg.sqlite。
- 迁移器默认 dry-run，--apply 才写入，matchId/feature 幂等。
- 需在 live apply 中停用：LangBot Telegram bot、PUBG plugin settings、PUBG n8n
  gateway/sync/daily workflow，以及旧日报 producer。
- 需保留运行但不参与 PUBG 的服务：9Router；LangBot、n8n、Product Radar 是否运行由其
  各自独立业务决定，不能反向成为 PUBG 依赖。
- 旧 Runtime/插件/工作流/facade/generator 已从 Git 当前树删除；历史不复制到新 legacy 目录。

## 附属 VPS 运维状态

- `amadeus-gateway` 当前以 systemd 运行官方 Xray 26.3.27，个人 VLESS + Reality + Vision
  服务监听 TCP `2053`；另运行官方 Hysteria 2 v2.12.3 的 `hysteria-server.service`，
  监听 UDP `2053`。官方 Caddy 2.11.4/systemd 接管 TCP `443` 提供 HTTPS 站点，并在 `sub`
  提供 QX、Clash/Mihomo、Shadowrocket 三种格式订阅（同时兼容 `8443`）。另运行与 HomeLab
  frpc 匹配的官方 frps 0.69.0/systemd，控制端口为 TCP `7000`，现有服务映射已恢复；
  `emby.nyannyan.top` 的 Let’s Encrypt 证书和 HTTPS 回源已验证。Caddy 证书供 HY2 读取，
  Caddy 不参与 Xray/HY2 代理流量；本次未修改 SSH 登录方式或防火墙，未启用 Docker/Nginx，
  未重启 VPS。
- VPS 架构、安装/升级/卸载方法、systemd 模板和无凭据配置模板位于 `infra/vps/`；公网地址、
  UUID、Reality private key 和其他真实 secret 均在仓库外。
- QX 订阅节点端口已从 443 更新为 2053；Clash/Mihomo 与 Shadowrocket 通过独立格式入口
  使用 HY2 UDP `2053`，QX 继续使用 VLESS Reality。服务端配置测试、systemd、TCP/UDP 监听、
  外部 Xray/HY2 smoke、Caddy ACME 和 Emby HTTPS smoke 已通过。
- 2026-09-18 新增 OpenClaw 公开入口：Cloudflare `claw.nyannyan.top` 解析/代理已生效，VPS
  Caddy 为该域名签发有效 Let's Encrypt 证书并反代到 `127.0.0.1:18789`；HomeLab frpc
  新增 `openclaw-tcp`（本地 `127.0.0.1:18789` → VPS `18789`），frps `maxPortsPerClient`
  提升为 10 以保留原有 qBittorrent 映射。真实配置备份见对应 checkpoint。

## 已有证据

- Domain 9 tests、plugin 3 tests、Product Radar 51 tests；OpenClaw native config/plugin
  inspect、bundled Skill preflight 已通过。
- 真实旧数据迁移：1151 输入、267 唯一比赛、57 初始 Telemetry feature；重复 apply
  不新增比赛，目标 SQLite migration_runs 一条；运行态按需新增到 58 features。
- 最终 CasaOS checkpoint：`/DATA/AppData/openclaw/backups/openclaw-pubg-20260917-091502`；
  镜像、Telegram probe、OpenClaw/9Router agent loop 和旧链停用证据见
  `docs/reports/OPENCLAW_PUBG_ACCEPTANCE.md`。

## 恢复与安全

生产 secrets 和业务数据不入库。切换脚本在 /DATA/AppData/openclaw/backups/<id> 保留
旧 compose、数据库、state/features、外部配置和新 SQLite 切换前副本。只记录恢复路径，
不执行旧架构回滚演练。canonical CasaOS target 是 OrbStack ubuntu，Compose 为
/var/lib/casaos/apps/openclaw/docker-compose.yml，正常启动使用 docker compose up -d --no-build。
