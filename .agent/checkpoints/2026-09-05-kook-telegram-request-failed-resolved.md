# KOOK / Telegram `Request Failed` 修复 checkpoint

- 日期：2026-09-05（Asia/Shanghai）
- 阶段：用户修正 credential，修复验证完成
- canonical target：OrbStack `ubuntu` 内 CasaOS

## 验证结果

- LangBot `9Router` provider key 与 9router 数据库当前 active key 完全一致。
- 使用 LangBot provider key 请求 9router `/v1/models`：HTTP 200。
- LangBot provider 更新 API 返回 HTTP 200。
- 修复后 Telegram 私聊和群聊测试均成功完成模型流式回复，各 2 chunks。
- `scripts/doctor.sh`：0 failure、0 warning。
- 用户确认 KOOK 与 Telegram 均已恢复。

## 运行时变更边界

- credential 由用户在 LangBot 管理界面修正；本次没有由 Codex 输出或提交 secret。
- 没有重建镜像、修改 CasaOS compose 或重启容器；当前运行中的镜像保持不变。
- Kiro OAuth `invalid_grant` 和 Codex Luna account lock 属于独立上游告警，未作为本次修复的一部分处理。

## Git 记录

- 诊断记录：`dea55b5 docs: record kook telegram request failure diagnosis`
- 本 checkpoint 与状态更新提交到本地 Git，不推送公网。
