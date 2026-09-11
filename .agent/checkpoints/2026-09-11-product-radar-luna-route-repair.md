# Product Radar Luna semantic route repair

日期：2026-09-11（Asia/Shanghai）

## 现象

Telegram 图片 + “帮我长期留意这件，有类似的就通知我” 没有创建 Watch，通用聊天回答无法后台监控。

## 根因

Product Radar `intent_planner` 的 `gpt-5.6-luna` UUID 仍绑定 LangBot Cloud
`space-chat-completions` provider。Ubuntu 请求该入口返回 Cloudflare HTTP 1010，
plugin runtime 记录 `ActionCallError` 并返回 `None`，所以 listener 未阻止普通聊天流程。

## 修复

- 备份 LangBot 数据库：`/DATA/AppData/langbot/backups/langbot.db.codex-product-radar-luna-20260911-224005`。
- 将 workspace 模型 `gpt-5.6-luna` 改绑现有 9Router provider（`openai-chat-completions`）。
- 重启 `langbot` 与 `langbot_plugin_runtime`，使 provider/model cache 重新加载。
- 默认聊天模型 `arthur-combo` 未修改；Product Radar 仍通过模型名 `gpt-5.6-luna` 解析。

## 验证

- 9Router 文本模型 smoke：成功，返回 1 choice。
- 9Router 多模态模型 smoke：成功，返回 1 choice 且有内容。
- Product Radar `/health`：`status=ok`。
- Product Radar `/api/watches`：0 条；未创建测试 Watch。
- 运行中的 `langbot` 与 `langbot_plugin_runtime`：正常启动。

## 回滚

停止 LangBot 后，将数据库备份恢复为 `/DATA/AppData/langbot/data/langbot.db`，再启动
`langbot` 与 `langbot_plugin_runtime`；不要修改 Product Radar 或 changedetection 数据。
