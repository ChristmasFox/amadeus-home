# PUBG 对局复盘示例模板对齐 checkpoint

- 时间：2026-09-11（Asia/Shanghai）
- 阶段：DEPLOYED / VERIFIED
- 范围：`apps/agent-runtime/src/review/presentation.ts`、review presentation regression tests

## 已完成

- 默认报告改为用户确认的模板顺序：概览、本场主线、逐人点评、队内伤害账本、简版垃圾佬榜、环境与载具、本局结论。
- 默认 unique section type 固定为 `overview / players / interactions / loot / environment / conclusion`；旧 extended profile 保持原路径。
- 逐人点评整合开火/武器、道具、护甲、载具和末战事实，保留中二但有数据支撑的批评与奖项；长段落按 28 字符边界断行。
- 队内近战账本保留原始事件计数、方向、脚/拳分类、伤害合计和 `meleeLedgerComplete`；缺席队员输出 `-`。
- 垃圾佬榜简化为拾取/丢弃/死亡盒/车厢转运和可靠皮肤衣服声明；环境与载具默认只展示破坏、乘车、轮胎和明确地形动作，开门/翻越仍保留在结构化 facts。
- 缓存压缩后无 normalized event stream 时，团战主线从派生 `keyPlayers` 回填主线人物，避免 live follow-up 丢失关键人名。

## 本地证据

- `pnpm --filter @agent/agent-runtime exec tsx --test tests/review-supplemental.test.ts`：3/3 pass。
- `pnpm --filter @agent/agent-runtime exec tsx --test tests/review-v3-3.test.ts tests/review-supplemental.test.ts`：18/18 pass。
- `pnpm --filter @agent/agent-runtime typecheck`：pass。
- `pnpm check:secrets`、`git diff --check`：pass。
- 根 `pnpm test` 在既有 `review-v3-2.test.ts` runner 阶段长时间无新输出，本次主动停止；未把中断的全量 runner 计为通过。该卡点另记 follow-up，定向回归和运行时验收均已完成。

## 部署与 live 证据

- source commit：`7780418`，已 push 到 `origin/main`。
- CasaOS `ubuntu` image：`local/pubg-query-engine-v3:git-778041855cc3`。
- image id：`sha256:c9b765cfbc71d108645a1a3ce53f5e68ea8117b3a8069c671bcb9c9354eaf664`。
- rollback compose：`/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260911-151652`。
- `/healthz`：`status=ok`；`/homehub/health`：`status=healthy`；`scripts/doctor.sh`：0 failure / 0 warning。
- 指定比赛 `c2aea5a9-a86a-4f7b-b0a5-3d032541922d` 只读 smoke：`status=OK`；section type 唯一值为 `overview / players / interactions / loot / environment / conclusion`；近战账本 `13/13`、`202.05` 友伤、`meleeLedgerComplete=true`；红点映射、原始 attachment ID 隐藏、缺席玩家 `SG_LabmemNo008` 的 `-`、环境不显示开门/翻越、点评最长 28 字符均通过。
- 未发送真实 Telegram/KOOK 消息。

## 回滚

如需回滚，将 compose image 恢复为该 backup 中的上一版本，并执行 `docker compose up -d --no-build`；本轮没有删除旧镜像或旧回滚文件。
