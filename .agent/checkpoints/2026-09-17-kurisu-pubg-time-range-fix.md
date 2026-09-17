# Kurisu PUBG 时间范围兼容修复 checkpoint

日期：2026-09-17（Asia/Shanghai）

## 问题

真实 Telegram 私聊在 10:05–10:06 查询“昨天战绩/昨天的战绩”时，LangBot Native Agent 通过 `kurisu_gateway` 生成了旧式参数：

- `kurisu.pubg.query`：`{"date":"2026-09-16"}`
- `kurisu.pubg.list`：`{"selector":{"type":"relative_period","value":"yesterday"}}`
- 另一次 query 为空对象

Kurisu Runtime 的严格 schema 只接受 `operation/subject/timeRange/metrics`（query）或 `timeRange/subject/limit`（list），因此真实调用返回 `TOOL_INPUT_INVALID`。问题不在 Mac IP、域名、Runtime URL 或 gateway secret。

## 修复与发布

- `kurisu-gateway@0.1.4` 的 prompt 明确写出 PUBG 时间范围契约与“昨天”映射。
- 网关边界增加确定性的兼容转换：已知 `date`、`period`、旧 `relative_period selector` 和缺少 operation 的 PUBG query 转换为 canonical `timeRange/operation/subject`；Runtime schema 未放宽。
- 源码提交：`b8e93fb`，已 push 到 `origin/main`。
- LangBot API 安装 task：`35`，结果 `INSTALL_READY`。
- 实际安装 artifact SHA-256：`e5600e1886e43b0df71c1aca65edc323d4534b432eb3804045e37259733308e2`。

## 验证

- Kurisu plugin tests：`10/10`。
- 实际隔离插件进程，清除 `KURISU_RUNTIME_URL`、`KURISU_GATEWAY_SECRET`、`KURISU_GATEWAY_SECRET_FILE` 后：
  - legacy `selector=yesterday`：`status=ok`，5 场比赛。
  - legacy `date=2026-09-16`：`status=ok`，4 条汇总记录。
- `scripts/doctor.sh`：0 failure / 0 warning。
- `scripts/smoke-kurisu-http.sh`：通过。
- Python compile、`pnpm check:secrets`、`git diff --check`：通过。

## 遗留

上述是插件→Runtime 的实际结构化 smoke，不等同于 Telegram 最终送达。仍需用户在 0.1.4 部署后发送一次“昨天战绩怎么样”，再核对 Native Agent 的真实入站、工具成功记录和最终回复；同时保留 KOOK、引用、图片、按钮/审批等 P7 平台验收项为 pending。
