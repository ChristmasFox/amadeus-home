# OpenClaw PUBG refactor S1 checkpoint

日期：2026-09-17（Asia/Shanghai）

## 交付

- `packages/pubg-domain` 已成为独立 TypeScript domain package，只依赖 `zod` 和
  Node 标准库，不 import OpenClaw、Mastra、LangBot、Telegram 或旧 app。
- 已包含官方 PUBG API client、bounded retry/timeout/取消、SQLite repository、时间/查询/
  比较、Telemetry facts、证据引用、stale/partial coverage 和幂等 legacy importer。
- `pubg_get_review_facts` 的 `categories` 现在会限制 Telemetry detail groups；match/player
  summary 保留，空 detail group 不表示事实未发生。

## 本地证据

- `pnpm --filter @agent/pubg-domain typecheck`：PASS
- `pnpm --filter @agent/pubg-domain test`：9/9 PASS
- `pnpm --filter @agent/pubg-domain build`：PASS（包含在清理后的完整构建中）
- 迁移 smoke：dry-run `1151 -> 267` unique matches，`884` duplicates、`57` features；
  首次 apply `267` matches/`57` features，重复 apply 不新增。

## 边界

目标 SQLite、真实 API key、Telemetry 数据和迁移备份均位于仓库外；本 checkpoint 不包含业务
数据或 secret。
