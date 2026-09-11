# PUBG 复盘五块模板收敛 checkpoint

- 日期：2026-09-11
- 状态：IMPLEMENTED / DEPLOYED / VERIFIED
- 范围：`apps/agent-runtime/src/review/presentation.ts` 及对应复盘回归测试

## 本阶段结果

- 默认完整复盘的展示类型收敛为 `overview / players / interactions / loot / closing` 五类。
- 队员点评仍按队员独立成卡，保留武器、开火、道具、恢复、载具、环境和队友误伤等战斗事实，并继续执行移动端 28 字符换行。
- 队内伤害账本和近战账本未改变，完整的攻击方向、拳脚类别和对账信息继续保留。
- 垃圾佬榜改为简版拾取、丢弃、车厢和显式外观计数。
- 环境动作、奖项、重点亮点、正负点评和下一局行动合并至收尾总结；显式专用 profile 保留原专用章节。

## 已完成验证

- 复盘定向测试：38 pass。
- agent-runtime 全量测试：130 pass / 1 skip。
- typecheck、secret scan、`git diff --check`：通过。
- `/healthz`：`status=ok`；`/homehub/health`：`status=healthy`；`scripts/doctor.sh`：0 failure / 0 warning。
- 指定比赛 `c2aea5a9-a86a-4f7b-b0a5-3d032541922d` 只读 smoke：`status=OK`；唯一 section type 为 `overview / players / interactions / loot / closing`，四名队员对应 8 个实际 section；近战对账 `13/13` 且标记数据齐全；环境破坏和简版垃圾佬榜存在；`SG_LabmemNo008` 为 `-`；点评单行最长 28 字符；武器信息和恢复物品没有单独 section。
- 未发送真实 Telegram/KOOK 消息；指定比赛只做本地/线上只读查询 smoke。

## 发布后补充

- source commit：`7f6cb63 fix(pubg): compact replay report template`，已 push 到 `origin/main`。
- 已使用 `./scripts/deploy-agent-runtime.sh --apply --build --no-proxy` 构建并部署 CasaOS `ubuntu`。
- immutable image：`local/pubg-query-engine-v3:git-7f6cb631d9c0`。
- compose 回滚备份：`/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260911-141448`。
