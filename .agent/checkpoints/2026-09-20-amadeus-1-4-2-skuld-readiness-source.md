# Operation Skuld readiness source checkpoint

日期：2026-09-20（Asia/Shanghai）

## Prepared controls

- `docs/OPERATION_SKULD_MIGRATION_MANIFEST.json` 记录 critical SQLite、owner outbox、workspace、logical secrets、runtime infrastructure、FashionSigLIP native worker/cache 和 host profile；不记录 secret value。
- `docs/OPERATION_SKULD_MAC_MINI_MIGRATION_RUNBOOK.md` 仅定义 backup/checksum、SQLite integrity、temporary restore rehearsal、rebuild 和 rollback；没有执行迁移或 Mac mini cutover。
- `scripts/migration-readiness.sh` 为 read-only/temp-copy 检查，覆盖 Git/version/source、OrbStack/CasaOS containers、health/network/data/secrets/SQLite/outbox/cron/FashionSigLIP/backup manifest。
- `scripts/test-migration-readiness.sh` 覆盖必需 secret 缺失和坏 SQLite 的阻断负例，且确认脚本没有生产 mutation。

## Current evidence

- Host profile 默认 `ubuntu`，Amadeus network 和 FashionSigLIP port 均可配置。
- readiness harness：通过；live readiness 仍待 1.4.2 deployment checkpoint 生成后运行。
- FashionSigLIP native worker 的 health、LaunchAgent、MPS/model/cache inventory 已纳入 manifest 和 doctor/readiness path；cache 被定义为可重建、可重新下载。

## Boundary

- 不迁移到新 Mac mini，不修改 DNS，不恢复 LangBot/n8n/旧 Runtime，不发送未经请求的真实群聊消息。
- 下一阶段必须先提交/push reviewed source，再在当前 OrbStack `ubuntu` CasaOS 主机执行 apply，并将实际 image/checkpoint/health/smoke/readiness 证据写回 Git。
