# Amadeus 1.4.2 Worldline source checkpoint

日期：2026-09-20（Asia/Shanghai）

## Scope

- 完成 `WorldlineNotificationIntent`、正式主题词汇、severity/significance 分离、确定性 policy、validated adapter/renderer，以及统一的 owner outbox producer boundary。
- Product Radar generic core 保持 transport/theme 中立；Product Radar、market、PUBG sync、media、HomeLab、VPS、Codex/release 均提交结构化事实。
- 删除活跃源中的旧 LangBot/n8n/runtime/旧 host username 假设；新增 host profile、可配置 Amadeus network、FashionSigLIP inventory 和 Operation Skuld manifest/runbook/readiness source。

## Validation

- `pnpm test`：通过（全仓定向套件全部通过）。
- `pnpm typecheck`：通过。
- `pnpm build`：通过。
- `pnpm check:secrets`：通过。
- `pnpm check:architecture`、`pnpm test:architecture`：通过。
- `bash scripts/test-migration-readiness.sh`：通过，含 secret metadata、SQLite integrity、temp restore positive/negative cases。
- `bash -n`：部署、host profile、readiness 相关脚本通过。
- Product Radar production image build：通过，根 workspace context、presentation build、legacy deploy 完成。
- OpenClaw production image build：通过。

## Release state

- `VERSION=1.4.2`，`RELEASE_NOTES.md` 只保留当前 release，version check 通过。
- 本 checkpoint 建立时仍未提交/push，未执行 CasaOS apply；live image、checkpoint 和 deployment evidence 待下一阶段生成。
- Operation Skuld 只完成执行清单准备，不执行 Mac mini cutover、DNS 切换或真实平台消息。
