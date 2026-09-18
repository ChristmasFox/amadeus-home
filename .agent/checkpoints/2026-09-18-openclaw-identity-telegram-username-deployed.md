# OpenClaw Identity Telegram username metadata（线上切换）

日期：2026-09-18（Asia/Shanghai）  
状态：DEPLOYED_LIVE_REAL_INPUT_PENDING

## 发布结果

- 提交 `c33684a` 已完成 Identity 定向测试、secrets scan、Docker image build 和 live apply。
- 新 OpenClaw image：
  `local/openclaw-amadeus:git-c33684a77a7a-20260918101625`；容器状态 `running`、health
  `healthy`。
- 外部恢复点：`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918101625`；compose 已以
  immutable image 和 `--no-build` 启动。

## 可信 mention 行为

- Telegram `text_mention` 直接使用 provider user ID。
- Telegram 普通 `@username` 只有在同一 account/conversation 中近期由 trusted inbound sender
  metadata 建立 `username -> platform user ID` 后才会传入 Identity；缓存 24 小时、冲突或过期
  均不解析，不写入 SQLite。
- WhatsApp 继续使用真实 `mentionedJid` 和稳定 sender JID；外部 package 重复 patch 返回
  `ALREADY_PATCHED`。

## 线上证据

- 最近真实 WhatsApp 群入站调用了 `identity_resolve(self)`，结果为
  `unbound / trusted_channel_identity_is_not_bound`；随后未调用 PUBG tool，符合 fail-closed。
- OpenClaw、Product Radar、media adapter network、NAS read-only smoke、owner WhatsApp outbox
  smoke 均通过；identity 四张表仍为 0 行，未伪造任何人物绑定。

## 验收边界

仍需用户在 Telegram/WhatsApp 真实入口确认 sender binding、昵称/群 alias、PUBG account link，并
在产生非空数据后重启 OpenClaw 验证持久化。生产 channel ID/JID 不写入 Git。
