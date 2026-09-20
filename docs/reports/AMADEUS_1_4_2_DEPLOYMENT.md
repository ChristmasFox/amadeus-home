# Amadeus 1.4.2 deployment evidence

日期：2026-09-20（Asia/Shanghai）

## Release

- 版本：`1.4.2`
- implementation commit：`af54e7d` (`feat: unify Amadeus worldline notifications`)，已 push 到 `origin/main`。
- canonical host：OrbStack machine `ubuntu` 内的 CasaOS。
- OpenClaw image：`local/openclaw-amadeus:git-af54e7de2c30-20260920111423`
- Product Radar image：`local/product-radar:git-af54e7de2c30-20260920111423`
- deployment checkpoint：`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260920111423`
- active network：`amadeus_network`；OpenClaw、Product Radar、media-organizer-adapter 均已接入。

## Deployment evidence

`./scripts/deploy-openclaw.sh --apply --build-auto` 已完成：

- OpenClaw 和 Product Radar 镜像构建、传输、Compose `--no-build` 重建：通过。
- OpenClaw config validation、PUBG/Amadeus plugin preflight、Skill preflight：通过。
- OpenClaw `/healthz`、Product Radar `/health`、media adapter health：通过。
- NAS SSH read-only smoke：通过。
- owner outbox structured smoke：通过；事件为 `owner_notification`、`worldline_convergence`、`major`、`worldLineClosing=true`，未发送真实群聊消息。
- 原生 cron 保留并核验：`amadeus-vps-morning`、`amadeus-vps-evening`、`amadeus-pubg-telemetry-hourly`、`amadeus-pubg-sync-daily`、`amadeus-market-open`、`amadeus-market-close`。
- 旧 LangBot/n8n 容器不在 active containers；changedetection、media adapter、FashionSigLIP 按 infrastructure classification 保留。

## Independent verification

- `bash scripts/migration-readiness.sh`：`OPERATION_SKULD=READY`，0 failure、0 warning。
- `bash scripts/doctor.sh`：0 failure、0 warning；OpenClaw、Product Radar、media adapter、9Router 和 FashionSigLIP worker health 通过。
- FashionSigLIP：LaunchAgent、`:18400/health`、Apple MPS 和模型 cache 通过。
- checkpoint `backup-manifest.json`：13 items，8 个非 secret 文件有 SHA-256，3 个 sensitive item 只保留 metadata；secret 内容未打印/未 checksum。
- temp restore rehearsal、SQLite integrity、owner outbox contract：通过。
- live Product Radar container runtime import：`@agent/presentation` / 11 formal Worldline themes：通过。

## Boundaries

- 本次只部署当前 canonical CasaOS host；没有迁移到 Mac mini、没有 DNS cutover、没有执行 Operation Skuld cutover/restore。
- 没有恢复 LangBot、n8n、旧 Runtime 或第二套 sender/planner。
- 真实 Telegram/WhatsApp 自然语言 inbound/final-reply 仍未用未经请求的真实群聊消息伪造验收；仅验证了工具、outbox、health、preflight 和无 spam smoke。
