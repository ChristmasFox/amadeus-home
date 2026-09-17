# PUBG Domain

PUBG 的平台无关 Domain：官方 PUBG API client、SQLite match/Telemetry store、确定性查询/比较、时间边界、review facts、证据引用和一次性迁移所需的数据结构。OpenClaw plugin 只调用这里的显式 service；本包不依赖 OpenClaw、LangBot、Mastra、Telegram、n8n 或任何 HTTP gateway。

config/default-team.json 仅是测试/开发 fixture。生产通过 PUBG_TEAM_CONFIG_FILE 从仓库外加载账号和 alias；API key、Telegram token、9router 凭据和业务数据永不进入仓库。

历史 Python V2 和旧 runtime 由 Git 历史保存，不在本包继续维护第二套实现。
