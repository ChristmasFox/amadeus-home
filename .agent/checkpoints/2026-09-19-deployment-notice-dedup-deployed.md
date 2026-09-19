# 部署通知结尾去重 checkpoint

- 日期：2026-09-19（Asia/Shanghai）
- 版本：`1.1.7`
- 提交：`e85ff3c`（`fix(ops): keep deployment closing singular`）
- 线上镜像：`local/openclaw-amadeus:git-fdf331cbca89-20260919071937`（复用已验证镜像）
- 外部恢复点：`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260919072713`
- 目标：OrbStack `ubuntu` 内的 CasaOS OpenClaw

## 修复

- 部署脚本生成 owner 通知前，移除发布说明中独立的重复结尾行。
- 部署边界统一追加一次世界线收束语。
- 1.1.7 发布说明不引用该结尾语，避免正文描述和最终结尾产生重复视觉输出。

## 验证

- `bash -n scripts/deploy-openclaw.sh scripts/amadeus-version.sh scripts/test-amadeus-version.sh`：通过
- `AMADEUS_VERSION_TEST`、版本检查、secrets scan、diff check：通过
- 实际送达 owner smoke 通知：全文 `El Psy Kongroo.` 出现 1 次
- CasaOS deploy health、preflight、媒体网络、NAS 只读、owner WhatsApp outbox smoke：通过
- live OpenClaw：`running/healthy`
