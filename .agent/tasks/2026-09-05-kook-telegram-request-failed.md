# Telegram / KOOK `Request Failed` 修复任务

状态：**已完成（用户修正 key，运行时验证通过）**

## 已确认事实

- 目标是 OrbStack `ubuntu` 内 CasaOS 的 `langbot` / `langbot_plugin_runtime`，不是 macOS
  host Docker。
- KOOK 与 Telegram 都把请求交给同一条 LangBot `arthur-combo` pipeline；平台适配器仍能
  入站，且部分 `/whoami`、普通消息可以出站。
- 2026-09-05 23:13:57、23:14:31、23:14:47 的 KOOK 失败和 23:14:55、23:41:47、
  23:41:50 的 Telegram 失败，错误均为 HTTP 401：
  `API key required for remote API access`。
- LangBot SQLite 中 `9Router` provider 的 key 与 `/DATA/AppData/9router/data/db/data.sqlite`
  里当前 active key 不一致。只读验证：使用 LangBot key 访问 `/v1/models` 为 401，使用
  9router active key 为 200。
- `scripts/doctor.sh` 当前通过；这不是需要盲目重启的容器健康问题。

## 已完成结果

- 用户已在 LangBot 管理界面更新 `9Router` provider credential。
- 复核确认 LangBot provider key 与 9router 数据库 active key 完全一致，调用 `/v1/models`
  返回 HTTP 200。
- LangBot 随后成功处理 Telegram 私聊和群聊测试并完成流式回复；用户确认 KOOK/Telegram
  均已恢复。没有重建镜像，也没有必要重启容器。
- 独立的 Kiro `invalid_grant` / Codex Luna account lock 告警仍保留，后续另行处理。

## （历史）显式 apply 前的建议顺序

1. 在 Ubuntu 上备份 `/DATA/AppData/langbot/data/langbot.db`，备份文件留在仓库外。
2. 从 9router 管理界面/API 或其本地数据库获取当前 active API key；**绝不把 key 写入 Git、
   checkpoint 或聊天消息**。
3. 通过 LangBot 管理 API/UI 更新名称为 `9Router` 的 model provider credential，或使用可
   回滚的 SQLite 变更将 `api_keys` 替换为当前 active key；不要修改仓库里的脱敏模板。
4. 使用 canonical compose 执行 `orb -m ubuntu -u root bash -lc 'cd /var/lib/casaos/apps/langbot && docker compose up -d --no-build'`。
5. 验证：用 active key 请求 9router `/v1/models`、运行 `scripts/doctor.sh`，再分别用真实
   KOOK 和 Telegram 用户发送普通文本及 `/whoami`；检查 `monitoring_errors` 不再新增该 401。
6. 若 9router 的 Codex Luna 仍因上游 account lock 失败，确认 `arthur-combo` 至少存在可用
   fallback；Kiro `invalid_grant` 需要单独重新授权，不要把它与本次 LangBot key mismatch 混为一谈。

## 回滚

- 只恢复第 1 步生成的 LangBot DB 备份，再通过同一 CasaOS compose 以 `--no-build` 重启；
  不删除现有 `/DATA/AppData` 数据，不修改 Git library 文件。
- 修复完成后必须更新 `docs/CURRENT_TASK.md`、`docs/PROJECT_STATE.md`、`.agent/state.md`，
  写入新的 deployment checkpoint，并运行匹配的 secrets scan / smoke。
