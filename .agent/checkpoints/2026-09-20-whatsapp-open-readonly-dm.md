# WhatsApp 全量私聊与非 owner 工具隔离 checkpoint

日期：2026-09-20（Asia/Shanghai）

## 范围

- WhatsApp DM 对所有发送者开放；Telegram DM 保持原 allowlist。
- owner 保留完整 OpenClaw 工具面；非 owner 只允许 `web_search`、`web_fetch`。
- Product Radar 的写操作必须由 `senderIsOwner=true` 执行。

## 恢复点

- 配置变更前：`/DATA/AppData/openclaw/backups/whatsapp-dm-open-20260920T152658Z`
- 本次发布：`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260920153810`
- 发布前镜像：`local/openclaw-amadeus:git-af54e7de2c30-20260920111423`、
  `local/product-radar:git-af54e7de2c30-20260920111423`

## Live evidence

- OpenClaw：`local/openclaw-amadeus:git-4d11f3e02074-20260920153810`，healthy。
- Product Radar：`local/product-radar:git-4d11f3e02074-20260920153810`，healthy。
- WhatsApp `secondary`：running/connected，`dmPolicy=open`，`allowFrom=["*"]`，
  `configWrites=false`；gateway config reload 为 active。
- Telegram：`dmPolicy=allowlist`，未改为 open。
- sender policy：wildcard 为 `web_search`/`web_fetch`，owner e164 policy 为 `*`。
- 编译后的 Amadeus bundle 已包含 `Product Radar mutation requires owner identity`。
- 发布脚本 exit 0；health、preflight、media network、NAS read-only、owner outbox smoke、
  全量验证和 secrets scan 均通过。

## Source

最终源码提交：`4d11f3e`。未 push；运行时和声明式模板均已进入 Git，后续部署会重建相同边界。
