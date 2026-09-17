# OpenClaw Telegram open group checkpoint

日期：2026-09-17（Asia/Shanghai）

## 变更

- 按用户最新明确要求，将 Telegram 群内发送者策略改为
  `channels.telegram.groupPolicy = "open"`。
- 保持 `channels.telegram.groups["*"].requireMention = false`，因此所有群无需 @
  即可触发回复。
- 仓库模板已同步更新：`integrations/openclaw/openclaw.json.example`。

## 应用与恢复

- 应用前配置备份：
  `/DATA/AppData/openclaw/backups/openclaw-telegram-groups-open-20260917-104036/openclaw.json`。
- 应用后使用 `docker compose up -d --no-build --force-recreate openclaw` 重载配置。

## 验证

- OpenClaw config validate：通过。
- Telegram channel：`configured=true`、`connected=true`、`lifecycle=ready`、
  `mode=polling`、`lastError=null`。
- 运行态解析为 `groupPolicy=open`、`allowUnmentionedGroups=true`，容器 health 为
  `healthy`，端口仍为 `0.0.0.0:18789`。

## 安全提示

机器人加入的所有 Telegram 群中，任何成员都可以触发 Agent；这会扩大 prompt-injection
和工具调用风险。私聊 `allowFrom` 不受此次群聊策略改变影响。
