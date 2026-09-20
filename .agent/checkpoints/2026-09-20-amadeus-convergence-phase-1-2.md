# Amadeus architecture convergence Phase 1-2 checkpoint

日期：2026-09-20（Asia/Shanghai）

## 已完成

- 已 `git fetch origin --prune`，发现远端新增 `docs/AMADEUS_ARCHITECTURE_CONVERGENCE_GOAL.md`，
  并将本地 14 个提交 clean rebase 到远端最新 `main`。
- Amadeus 保持单一 OpenClaw plugin；`plugins/amadeus/src/index.ts` 已收敛为 thin bootstrap。
- Identity、Product Radar、Media、NAS、HomeLab、KOOK、Market、Owner Notification、VPS
  registration 已拆到 capability modules；shared tool wrapper/lifecycle 保留原有边界。
- 删除了 Amadeus global `before_prompt_build` Identity/PUBG routing guidance。
- 新增 capability Skills，顶层 Amadeus Skill 只保留 overview；SOUL/workspace AGENTS 已移除
  capability-specific PUBG workflow；persona meme trigger 不再被“也就是说/我坐好了/单独 41 秒内”触发。

## 验证

- `pnpm test:amadeus`：Identity 10/10、Amadeus 16/16。
- `pnpm --filter @agent/pubg-plugin test`：9/9。
- `pnpm typecheck:amadeus`：通过。
- `git diff --check`：通过。
- SOUL/workspace capability token scan 和 source global business prompt injection scan：通过。

## 尚未完成

Presentation contracts/time normalization、owner notification hard renderer、architecture fitness
checks、全量测试/secret scan、版本发布、CasaOS deployment 和 live evidence commit。
