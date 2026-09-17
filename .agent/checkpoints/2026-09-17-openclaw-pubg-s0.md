# OpenClaw PUBG refactor S0 checkpoint

日期：2026-09-17（Asia/Shanghai）

## 目标

按 `docs/OPENCLAW_PUBG_REFACTOR_GOAL.md` 实施一次性 OpenClaw 原生 PUBG plugin 迁移。此 checkpoint 只覆盖 S0 事实盘点，不表示已经切流。

## 已核对

- `git status --short --branch`：`main...origin/main`，无未提交工作树改动；基线 `97d5f5e`。
- 本机 OpenClaw：`2026.3.7`；下载检查的 npm `openclaw@2026.9.4` 提供 `openclaw/plugin-sdk/tool-plugin`，并要求 Node 24.16+（或 Node 26.1+）。
- OrbStack `ubuntu`：LangBot/插件 runtime、旧 PUBG runtime、n8n、9router、Product Radar 运行；`big-bear-openclaw` 仅有旧 compose，未运行。
- n8n `database.sqlite` 只读盘点：PUBG match Data Table 423 行/268 唯一 matchId；PUBG 相关 active workflow 为 Data Gateway v3、Query Gateway v2、Sync v2/v3、今日战绩。
- 旧 PUBG runtime 数据：`state.json` 103 个 matchId 引用/225 contexts/559 results，`features.json` 57 features，`selections.json` 562 selections；这些包含会话和旧边界状态，迁移时只取可验证 match/telemetry facts。
- 外部 secrets 仅确认存在和挂载位置，未读取或写入值；未停止服务、未修改 CasaOS、未发送消息。

## 可恢复输入

- `/DATA/AppData/n8n/database.sqlite`（迁移前需精确备份）
- `/DATA/AppData/pubg-query-engine-v3/data/state.json`
- `/DATA/AppData/pubg-query-engine-v3/data/features.json`
- `/DATA/AppData/pubg-query-engine-v3/data/selections.json`
- `/DATA/AppData/pubg-query-engine-v3/data/state.json.kurisu.sqlite`

## 下一步

抽取无 platform/Mastra/LangBot/OpenClaw 依赖的 Domain 类型、查询引擎、时间解析、Telemetry review facts；随后加入官方 API client、SQLite repository、幂等 importer 和六个 bounded native tools。
