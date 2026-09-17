# OpenClaw Telegram group access checkpoint

日期：2026-09-17（Asia/Shanghai）

## 变更

- 按用户明确要求启用 Telegram 群聊，并关闭强制 @：
  `channels.telegram.groups["*"] = { "requireMention": false }`。
- 群内发送者策略保留为 `groupPolicy: "allowlist"`；未设置独立
  `groupAllowFrom`，因此继续沿用外部配置中的 `allowFrom` 私聊白名单。
- 仓库模板已同步更新：`integrations/openclaw/openclaw.json.example`。

## 应用与验证

- 变更前配置已备份至：
  `/DATA/AppData/openclaw/backups/openclaw-telegram-groups-20260917-103937/openclaw.json`。
- 应用后重启 `openclaw`，配置验证和 Telegram channel probe 通过。
- 当前预期：所有群可进入群聊处理；无需 @；只有当前白名单用户可触发回复。

## 安全边界

未将群内发送者策略改为 `open`，也未把 token、用户 ID 或群 ID 写入 Git。
