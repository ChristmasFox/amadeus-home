# KOOK / Telegram `Request Failed` 诊断 checkpoint

- 日期：2026-09-05（Asia/Shanghai）
- 阶段：只读运行时诊断完成；未执行 credential 重绑、重启或部署
- canonical target：OrbStack `ubuntu` 内 CasaOS

## 观测结果

- `langbot` 与 `langbot_plugin_runtime` 运行中；`pubg-query-engine-v3` healthy；9router 运行中。
- `scripts/doctor.sh`：0 failure、0 warning。
- KOOK 失败：23:13:57、23:14:31、23:14:47。
- Telegram 失败：23:14:55、23:41:47、23:41:50。
- 所有上述失败都落在 LangBot `arthur-combo` 的模型请求阶段，错误为 HTTP 401
  `API key required for remote API access`；不是 Telegram/KOOK 发送 API 的 HTTP 失败。
- LangBot `9Router` provider 的 key 长度为 3；9router 数据库 active key 长度为 35。
  `/v1/models`：LangBot key -> 401；9router active key -> 200。
- 9router 还有 Kiro OAuth `invalid_grant` 和 Codex Luna 短时 account lock 告警，记录为次要
  上游问题。

## 未执行项

- 未读取或提交任何 secret 值。
- 未修改运行中的 LangBot 数据库、compose、容器或镜像。
- 待用户显式 `--apply` 后，先备份 LangBot DB，再重绑 provider credential、`--no-build`
  重启并做 KOOK/Telegram 真实入站回归。
