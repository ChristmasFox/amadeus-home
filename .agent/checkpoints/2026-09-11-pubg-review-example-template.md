# PUBG 对局复盘示例模板对齐 checkpoint

- 时间：2026-09-11（Asia/Shanghai）
- 阶段：IMPLEMENTED / READY TO DEPLOY
- 范围：`apps/agent-runtime/src/review/presentation.ts`、review presentation regression tests

## 已完成

- 默认报告改为用户确认的模板顺序：概览、本场主线、逐人点评、队内伤害账本、简版垃圾佬榜、环境与载具、本局结论。
- 默认 unique section type 固定为 `overview / players / interactions / loot / environment / conclusion`；旧 extended profile 保持原路径。
- 逐人点评整合开火/武器、道具、护甲、载具和末战事实，保留中二但有数据支撑的批评与奖项；长段落按 28 字符边界断行。
- 队内近战账本保留原始事件计数、方向、脚/拳分类、伤害合计和 `meleeLedgerComplete`；缺席队员输出 `-`。
- 垃圾佬榜简化为拾取/丢弃/死亡盒/车厢转运和可靠皮肤衣服声明；环境与载具保留破坏、翻越、乘车、轮胎和明确地形动作。
- 缓存压缩后无 normalized event stream 时，团战主线从派生 `keyPlayers` 回填主线人物，避免 live follow-up 丢失关键人名。

## 本地证据

- `pnpm --filter @agent/agent-runtime exec tsx --test tests/review-supplemental.test.ts`：3/3 pass。
- `pnpm --filter @agent/agent-runtime exec tsx --test tests/review-v3-3.test.ts tests/review-supplemental.test.ts`：18/18 pass。
- `pnpm --filter @agent/agent-runtime typecheck`：pass。
- `pnpm workflow:plan`：RUNTIME；Docker/Compose/deploy 仅因用户此前明确授权而安排在下一阶段。
- 尚未部署；待完成 secrets scan、source commit/push、镜像构建、CasaOS 激活、指定比赛只读 smoke 与 health/doctor。

## 回滚

部署前沿用当前生产 compose；部署脚本应生成新的时间戳 rollback compose，完成 live smoke 后把路径补回本 checkpoint。
