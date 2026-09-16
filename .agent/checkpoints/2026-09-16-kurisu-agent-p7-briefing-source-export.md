# Kurisu P7：简报生产者发现与源码导出

- 日期：2026-09-16（Asia/Shanghai）
- live n8n workflow：`Daily Tech & Market Digest`，ID `681f9db4-6666-4e58-aa6a-7ecc86316182`，active。
- 真实职责：09:30/23:00 Asia/Shanghai 调度；运行去重；RSS/API 采集；AI 分析、合并和报告；`digest_events`/`digest_runs` 持久化；当前经 LangBot 直发 KOOK。
- Git source：`integrations/n8n/workflows/daily-tech-market-digest.workflow.json`，由 `scripts/export-n8n-workflow-source.mjs` 导出。source 排除 `pinData`、执行数据和实例 metadata；credential 仅保留引用，目标实例必须重绑。
- 配置修正：workflow sender 使用 Docker 内部 `http://langbot:5300`，不再固化当前局域网 IP；尚未导入该修正，线上定义仍是本次变更前的版本。
- 下一门槛：为 n8n → Runtime event ingress 建立外部 secret/credential 边界，切换前备份 live workflow，停用 n8n 直接 sender，核验 Runtime outbox 送达与 pending/rollback。
- 未宣称：本 checkpoint 不证明 Runtime notification handoff、实际平台送达或 `PRODUCT_COMPLETE`。
