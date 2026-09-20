# Amadeus 1.4.2 deployment checkpoint

日期：2026-09-20（Asia/Shanghai）

- implementation commit `af54e7d` 已 push；版本为 `1.4.2`。
- 当前 canonical CasaOS host 为 OrbStack `ubuntu`。
- OpenClaw：`local/openclaw-amadeus:git-af54e7de2c30-20260920111423`。
- Product Radar：`local/product-radar:git-af54e7de2c30-20260920111423`。
- 外部恢复 checkpoint：`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260920111423`。
- `deploy-openclaw.sh --apply --build-auto`、health、preflight、media network、NAS read-only 和 structured owner outbox smoke：通过。
- 独立 `doctor.sh`：0 failure / 0 warning。
- 独立 `migration-readiness.sh`：`OPERATION_SKULD=READY`，0 failure / 0 warning。
- FashionSigLIP LaunchAgent、MPS worker、health、cache：通过。
- 未执行 Mac mini cutover、DNS 切换、Operation Skuld restore，也未发送未经请求的真实群聊消息。
- 完成后应保持 Git clean，并把本 checkpoint 与 `docs/reports/AMADEUS_1_4_2_DEPLOYMENT.md` 一并提交/push。
