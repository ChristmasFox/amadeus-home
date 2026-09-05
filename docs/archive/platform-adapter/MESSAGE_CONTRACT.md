# NormalizedBotMessage Contract

实现位置：`pubg-query-engine-v3/src/platform/core/contracts.ts`。

LangBot Python 对应契约位于 `pubg-langbot-plugin-v3/components/platform/contracts.py`；命令/Tool 会话入口由 `pubg-langbot-plugin-v3/components/platform/registry.py` 统一处理。

版本固定为 `1`，平台标识只允许：`kook`、`telegram`、`wechat`。

```json
{
  "version": 1,
  "platform": "kook",
  "botId": "kook-bot",
  "user": {
    "platform": "kook",
    "platformUserId": "user-id",
    "internalUserId": null,
    "displayName": null
  },
  "chat": {
    "type": "group",
    "id": "chat-id",
    "name": null
  },
  "message": {
    "id": "message-id",
    "text": "昨日战绩",
    "replyToMessageId": null
  },
  "mentions": [],
  "attachments": [],
  "timestamp": "2026-09-02T12:00:00.000Z"
}
```

## Rules

- `platform`、`chat.type`、`user.platformUserId` 是规范化字段，不携带 `guild`、`channel`、Telegram update 或微信原始对象。
- `chat.type` 只允许 `private`、`group`。
- `raw` 只可作为 adapter/诊断内部字段；Runtime 在进入领域处理前会移除它。
- `attachments` 已预留，当前只处理 text response。
- `displayName` 只用于展示，不能用于权限判断。
- 当前 LangBot `Session` 没有强制平台字段；缺省按既有 KOOK transport 兼容处理。未来 transport 可提供 `platform`、`chat_type`、`chat_id` 和 `platform_user_id`，无需修改 PUBG 业务层。

## Legacy Compatibility

`RuntimeRequest` 暂时保留 `platform`、`launcherType`、`launcherId`、`senderId` 以兼容旧 HTTP 调用。它们只在 `legacyRequestToMessage()` 中转换，领域查询使用 `NormalizedBotMessage`。

## Response Contract

```json
{
  "messages": [
    { "type": "text", "text": "..." }
  ],
  "replyTo": "message-id",
  "metadata": {
    "queryId": "q_xxx",
    "domain": "pubg",
    "status": "OK"
  }
}
```

Runtime 同时返回 `normalizedMessage`、`presentation`、`query`、`resolvedQuery`、`resultSetId`、`coverage`、`source`、`evidence` 和 `trace`，不会再只保留回答字符串。
