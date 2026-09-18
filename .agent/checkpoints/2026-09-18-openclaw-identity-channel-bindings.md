# OpenClaw WhatsApp identity bindings applied

时间：2026-09-18（Asia/Shanghai）

## 结果

- 按用户明确授权，通过现有 `identity_bind_channel` 逻辑将 4 个 canonical Person 绑定到当前
  `secondary` WhatsApp 群账号。
- 每个人同时写入 provider-native LID 与对应手机号标识，共 8 条 `source=confirmed` channel
  binding；没有写入 Git，也没有向群聊发送测试消息。
- 运行时校验：`persons=4`、`aliases=8`、`external_accounts=4`、`channel_identities=8`。
- 对每个人分别验证 `identity_resolve(self)` 和昵称 alias resolve，均返回 `resolved`；self
  路径为 `owner-confirmed-binding`，alias 路径为 `global-alias`。

## 恢复

- 绑定前备份：`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918203921-identity-bind`。
- 本次没有重启 OpenClaw；IdentityStore 后续查询会直接看到持久化 SQLite 记录。
- 如需撤销或纠正某条绑定，应通过 owner-confirmed identity workflow 定位具体 channel/account/
  platformUserId 后再做定向修改，不要删除整张身份表。
