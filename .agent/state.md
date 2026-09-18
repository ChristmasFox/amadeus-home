# Agent State

更新时间：2026-09-18（Asia/Shanghai）

当前 Goal：按 docs/OPENCLAW_PUBG_REFACTOR_GOAL.md 完成最终 OpenClaw PUBG 重构、测试、
一次性迁移、清理、提交和 push。

当前状态：S0/S1/S2/S3 PASS；S4 所有可执行项 PASS。Telegram 自然入站闭环 BLOCKED，因
验收窗口没有自然入站消息或独立测试账号。

已落地：

- 独立 packages/pubg-domain：官方 API、SQLite、查询/比较、Telemetry facts、幂等迁移；
- 原生 plugins/pubg：六个 bounded tools、bundled Skill、OpenClaw conversation adapter，
  Telegram/WhatsApp 使用同一 Domain 入口，外部 team/API key/identity；
- OpenClaw 2026.9.4 ARM64 构建模板和 9router:20128/v1 配置；
- Product Radar 默认停用旧中央通知 owner；旧 PUBG Runtime、LangBot PUBG plugin、PUBG
  n8n workflow、旧 facade/generator/通知桥和无效 Mac host executor 已从当前树删除；
- 真实旧数据临时迁移证据：1151→267 matches、57 features，重复 apply 不复制。

附属 VPS 运维状态：`amadeus-gateway` 当前以 systemd 运行官方 Xray 26.3.27，个人 VLESS +
Reality + Vision 监听 TCP `2053`；官方 Hysteria 2 v2.12.3 运行于
`hysteria-server.service`，监听 UDP `2053`。官方 Caddy 2.11.4 接管 TCP `443` 提供 HTTPS
站点，并在 `sub.nyannyan.top` 提供 QX、Clash/Mihomo、Shadowrocket 三种订阅格式（同时兼容
`8443`）。官方 frps 0.69.0 运行于 `frps.service`，控制端口 TCP `7000`，现有 HomeLab frpc
映射已恢复；SSH 和防火墙未改，VPS 未重启。真实运行 secret 只保留在 VPS。

OpenClaw 公开入口已完成：Cloudflare 代理 `claw.nyannyan.top` → VPS Caddy HTTPS →
frps `18789` → HomeLab `127.0.0.1:18789`，公网 `/healthz` 返回 200，OpenClaw
`allowedOrigins` 已允许该 HTTPS 来源；FRP 现有 10 个映射均在线。

下一步：在 WhatsApp `secondary` 账号补一条实际群聊查询和一条连续追问，并在有真实 Telegram
入站时更新双渠道闭环证据；在此之前不将 gateway/webchat 回合冒充平台验收。完整场景记录见
`docs/reports/OPENCLAW_PUBG_ACCEPTANCE.md`，最终运行 checkpoint 在
`/DATA/AppData/openclaw/backups/openclaw-pubg-20260917-091502`。

约束：不恢复 LangBot/Mastra/n8n/旧 Runtime PUBG 链，不做灰度、shadow、双跑、兼容 fallback
或回滚演练；保留外部备份和恢复说明；不提交 secrets/业务数据；不默认在 macOS host Docker
部署。下一次会话仍先读 README、ARCHITECTURE、PROJECT_STATE、CURRENT_TASK、此文件，再读 Git 状态。
