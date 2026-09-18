# OpenClaw Amadeus Migration Goal

更新时间：2026-09-18（Asia/Shanghai）

## 目标

将仍有价值的 Amadeus 能力从 LangBot、n8n 和旧插件/运行时迁移到唯一的
OpenClaw/Kurisu 入口：

```text
Telegram / WhatsApp / future channels
        → one OpenClaw/Kurisu
        → Skills + native Amadeus/PUBG plugins
        → deterministic Domain or direct external service
```

OpenClaw 是唯一 Agent runtime。不得新增 orchestrator、runtime、意图路由、关键词路由、
shadow/double-run 或兼容 fallback。

## 保留并迁移的能力

- Product Radar：结构化 watch CRUD、手动 run、统计/usage/context，以及变更事件；业务只
  写 channel-free owner outbox。
- Emby 媒体整理：继续使用独立 media-organizer-adapter；OpenClaw 原生工具强制
  `scan → preview → 同一会话显式确认 → execute`，一次只处理用户明确指定的一项。
- Mac/NAS：status、disk、owner-only sleep；SSH key 只在运行时 secret。
- HomeLab Status：Glances、uptime 和固定服务探针；读取为主，通知为显式 owner action，
  不负责重启。
- VPS Read-only Capability：通过固定 KiwiVM API 读取 service info、live status 和 raw usage，
  通过固定只读 SSH probe 读取 uptime/load/memory/root filesystem 与 Caddy、Xray、Hysteria2、
  frps 状态；只持久化 \`lastSuccessfulCounter\`/\`lastSuccessfulAt\`，不接受任意 shell 或 VPS
  控制操作。VPS 晨间/晚间报告在 09:30/23:00 Asia/Shanghai 只发送 WhatsApp owner DM。
- KOOK group members：仅在 KOOK 当前会话内交互查询，不保留主动推送。
- Codex completion/failure/cancel、Product Radar、媒体完成、HomeLab 状态和未来业务告警：
  统一为 channel-free owner event，由 OpenClaw 唯一决定 WhatsApp owner 投递。

Telegram/KOOK 可以继续作为聊天入口（当前已连接的渠道按实际配置），但不得成为主动通知
目标；未来渠道只新增 OpenClaw channel adapter，不修改 Domain。

## 删除的旧路径

完成真实切换后，从 Git 和 CasaOS canonical app 定义中删除/退休：LangBot agent/plugin
runtime、PUBG/业务 LangBot plugins、n8n Amadeus workflows、n8n sandbox、旧通知 webhook、
Telegram/KOOK proactive notification、watchdog、旧 facade/adapter/generator 和仅服务于
这些路径的配置/脚本。备份留在仓库外 dated checkpoint，不作为运行时 fallback。

## 验收边界

1. Git 可从源码构建 OpenClaw Amadeus image、PUBG plugin/domain 和 Product Radar。
2. OpenClaw config/plugin inspect 显示 PUBG 六工具与 Amadeus 原生工具，且无旧业务插件。
3. Product Radar、media adapter、NAS、HomeLab、KOOK lookup、VPS read-only capability 的定向测试或真实
   smoke 有可检查结果。
4. Codex/业务事件进入 channel-free outbox，并由 OpenClaw worker 以幂等方式经 WhatsApp
   owner DM 送达；outbox 不包含 channel/recipient 字段。
5. CasaOS 中唯一 Agent runtime 为 OpenClaw；LangBot、n8n、sandbox 和旧 watchdog 不再
   运行，9Router、Product Radar、changedetection、media adapter 等独立依赖仍按需要运行。
6. 真实切换前存在包含 compose、数据库、配置和 secret 恢复位置的外部 checkpoint；不把
   token、API key、数据库或业务数据提交到 Git。
7. 自然语言 VPS 查询由 OpenClaw 自主选择一个或多个只读工具；流量计算、stale/error 语义、
   十格进度条和 09:30/23:00 WhatsApp owner DM 报告均有本地测试与真实运行证据。
