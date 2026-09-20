# Amadeus 1.4.1 PUBG presentation hardening — source checkpoint

日期：2026-09-20（Asia/Shanghai）

## Source 阶段

- `packages/presentation` 已覆盖 stats、search/list、compare、match detail、single review、period review、team damage、status/error；每个合同包含 `status`、`dataUpdatedAt`、可选来源范围和 evidence references，并通过 runtime validation。
- PUBG plugin 的 10 个 native tools 已接入唯一 `PUBG_PRESENTATION_REGISTRY`；每个结果保留原始 envelope/evidence，同时返回 validated `presentation` 和 deterministic `displayText`。所有 renderer 都输出 `数据更新时间`，来源范围按北京时间友好格式渲染，过滤内部时区/日界线术语。
- `pubg_get_period_review` 已由 Domain 消费当前 session 的新鲜 `resultSetId`，按 search result order 逐局获取 review facts，并保留 partial/no-match 语义；没有新增关键词路由或第二 runtime。
- Owner outbox 新写入路径只接受结构化 owner notification；旧 `title/message` 只在 pending 文件 drain 时读取兼容。长通知分片保留 facts、`dataUpdatedAt`、closing 和稳定 part event key。
- SOUL 已回到 persona-only；architecture check 递归扫描完整 `plugins/amadeus/src/**`，并通过 PUBG registry coverage fixture。
- 版本脚本只允许 `bump patch`，patch `0..9`、minor `0..99`；fixtures 覆盖 `0.9.9 -> 0.10.0`、`0.99.9 -> 1.0.0`、`1.4.0 -> 1.4.1`、`1.99.9 -> 2.0.0`。

## 验证

- `pnpm --filter @agent/presentation typecheck`：PASS
- `pnpm --filter @agent/presentation test`：6/6 PASS
- `pnpm typecheck:pubg`：PASS
- `pnpm test:pubg`：identity 10/10、presentation 6/6、Domain 23/23、plugin 9/9 PASS
- `pnpm typecheck:amadeus`：PASS
- `pnpm test:amadeus`：identity 10/10、presentation 6/6、Amadeus 18/18 PASS
- `pnpm check:architecture`、`pnpm test:architecture`、`bash scripts/test-amadeus-version.sh`：PASS
- `./scripts/developer-workflow.sh --run --check-secrets`：PASS；secrets scan 通过
- `git diff --check`：PASS

## 尚未执行

当前根 `VERSION` 仍为 `1.4.0`，尚未 bump 1.4.1、commit/push、CasaOS deploy 或 live 验收。下一阶段必须先替换单次 `RELEASE_NOTES.md`，再执行 release build、`deploy-openclaw.sh --dry-run`、`--apply --build-auto`、doctor/health/preflight/smoke，并提交部署 evidence。
