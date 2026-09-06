# PUBG 对局复盘 V1 implementation checkpoint

日期：2026-09-06（Asia/Shanghai）
Git：`fb6000a` (`feat: enrich PUBG match review v1`)
分支：`main`
状态：SOURCE COMPLETE；未执行 CasaOS/LangBot/n8n RELEASE。

## 目标

基于真实比赛 `d8c41c10-de9f-40b4-ac88-ede0ab554a31` 的 Match API 与 Telemetry，完善 PUBG 单局复盘报告，固化可迁移的 deterministic facts、事件组合和插件 presentation。

## 已完成

- `telemetry-parser-5` / `review-features-5`：增加电击枪结果、恢复/能量物品、死亡盒搜包、载具仓库存取、门窗/翻越、护甲破坏、载具攻击链等结构化 facts。
- Report presentation：中文地图名（`Neon_Main -> 荣都`）、战局主线/转折点、武器信息、逐人队友拳击与误伤、电击枪、恢复/能量、搜包/物资搬运、环境动作、趣味事件组合和下一局行动。
- 组合规则：双向互殴、误伤三件套、开团到收割、高伤害未收口；基础事件增加电击枪、护甲后续、载具一炮四轮。
- Match ID 直接复盘：planner、match selector、n8n data gateway 和 LangBot fallback 支持 `match_id`，避免默认今天 selector 隐藏指定对局。
- 配置队员缺少 Match API participant 时标记 `not_recorded`，不渲染为确定的零贡献。
- `pubg-stats` plugin source manifest/tool/command/listener 升级到 `3.3.0`。

## 真实目标局验证摘要

- #4，荣都，28:09；6 杀、2 助攻、8 倒地、0 救援、1,084.73 队伍伤害。
- 第 2 波 13:42–15:49：5 杀/4 倒地/537 伤害，付出 2 次被击杀。
- 第 5 波 22:10–22:16：1 杀/1 倒地/100 伤害，无我方被击杀。
- 第 6 波 27:00–27:34：213 伤害/2 倒地/0 杀，末战未收口。
- 可确认 supplemental facts：007→004 3 拳、004→007 2 拳、008→007 手雷误伤 1 次；007 电击枪开火 1 次但没有可确认命中；007 一发 Panzerfaust 关联 4 轮摧毁、载具伤害、人体伤害、倒地和载具摧毁；007 死亡盒拾取 21 次；恢复/能量和载具仓库存取均已结构化。

## 验证

- `pnpm test`：130 tests，129 pass，1 skip（外部 real telemetry fixture 缺失）。
- `PYTHONPATH=integrations/langbot/plugins/pubg-stats-v3 python3 -m unittest discover -s integrations/langbot/plugins/pubg-stats-v3/tests -p 'test_*.py'`：13 pass。
- `pnpm typecheck`、`pnpm build`、`./scripts/smoke-agent-runtime.sh`：通过。
- `pnpm test:workflow`、n8n data gateway direct Match ID test：通过。
- `./scripts/build_pubg_v3_plugin.sh`、`./scripts/deploy-langbot.sh --dry-run`：通过，package version `3.3.0`。
- `pnpm check:secrets`、`git diff --check`：通过。

## 未执行与回滚边界

- 未修改 CasaOS canonical compose、生产 runtime image、在线 n8n workflow、LangBot 安装状态或外部 credentials。
- `.lbpkg`、真实 Telemetry、API key 和运行时数据不入 Git。
- 后续上线步骤保存在 `.agent/tasks/pubg-review-v1-deployment.md`；必须用户显式要求 RELEASE 后执行。
