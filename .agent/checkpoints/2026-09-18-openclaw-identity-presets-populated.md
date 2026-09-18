# OpenClaw identity presets populated

时间：2026-09-18（Asia/Shanghai）

## 结果

- 用户提供的 4 个 WhatsApp 人员昵称、别名和 PUBG 外部账号已写入运行时文件：
  `/DATA/AppData/openclaw/data/identity-presets.json`。
- 文件留在 CasaOS 外部数据目录，不进入 Git；权限校验为 `0600`，运行时用户可读。
- OpenClaw IdentityStore 已按外部文件指纹刷新并读取：`persons=4`、`aliases=8`、
  `external_accounts=4`、`channel_identities=0`。

## 边界

- WhatsApp 手机号/LID 是平台可信身份数据，不写入 preset 或 Git。
- `channel_identities=0` 保持 fail-closed 设计；下一步必须在真实 WhatsApp sender、mention 或
  reply metadata 上由 owner-confirmed `identity_bind_channel` 完成绑定。
- 没有向群聊发送测试消息，也没有修改用户已有的本地工作树改动。

## 恢复

- 本次写入前目标文件不存在，因此没有覆盖旧 preset，也没有产生备份文件。
- 如需改名或更换 PUBG 账号，直接更新同一外部文件后，下一次 Identity/PUBG tool 调用会按
  文件指纹刷新；已确认的 channel binding 不会被 preset 覆盖。
