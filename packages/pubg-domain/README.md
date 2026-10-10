# PUBG Domain

PUBG 的平台无关 Domain：官方 PUBG API client、SQLite match/Telemetry store、确定性查询/比较、时间边界、review facts、证据引用和一次性迁移所需的数据结构。OpenClaw plugin 只调用这里的显式 service；本包不依赖 OpenClaw、LangBot、Mastra、Telegram、n8n 或任何 HTTP gateway。

`config/default-team.json` 是**完全虚构、不具备真实查询能力的 fixture**，不再包含真实 PUBG Account ID。生产插件要求显式的 `PUBG_TEAM_CONFIG_FILE`，从仓库外加载队伍配置；未配置将 fail closed。

初始化自己的小队（根据官方昵称解析官方 PUBG Account ID，默认仅写入 Git 忽略的 `.local/`）：

```sh
node scripts/init-pubg-team.mjs --players PlayerOne,PlayerTwo --platform steam --api-key-file .local/pubg-api-key
node --test scripts/test-init-pubg-team.mjs
```

详见 [Community PUBG Setup](../../docs/COMMUNITY_PUBG_SETUP.md)。API key、WhatsApp pairing 数据、真实队伍 ID 和其他凭据不得进入 Git。旧 Python V2 和 Runtime 只在 Git 历史中保留，不继续维护第二套实现。
