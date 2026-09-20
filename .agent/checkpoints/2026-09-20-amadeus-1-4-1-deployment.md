# Amadeus 1.4.1 deployment checkpoint

日期：2026-09-20（Asia/Shanghai）

## Release

- `VERSION=1.4.1`，`bash scripts/amadeus-version.sh check` 通过。
- implementation commit：`032e314`（`feat: harden Amadeus PUBG presentation`），已 push 到 `origin/main`。
- release preparation、build、typecheck、full tests、architecture、workflow、secrets scan 和
  `git diff --check` 已通过。

## CasaOS apply

- dry-run：`./scripts/deploy-openclaw.sh --dry-run` 通过。
- apply：`./scripts/deploy-openclaw.sh --apply --build-auto` 退出码 0。
- OpenClaw image：`local/openclaw-amadeus:git-032e31477b45-20260920065322`。
- Product Radar image：`local/product-radar:git-7d85bc10f15d-20260920041059`（复用既有 immutable image）。
- 外部 rollback checkpoint：`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260920065322`。
- 部署日志确认 `OPENCLAW_PREFLIGHT=passed`、`OWNER_TOOL_POLICY=full`、
  `OPENCLAW_HEALTH=passed`、`PRODUCT_RADAR_HEALTH=passed`、`MEDIA_ADAPTER_NETWORK=passed`、
  `NAS_SSH_READONLY_SMOKE=passed`、`OWNER_WHATSAPP_OUTBOX_SMOKE=passed` 和
  `LEGACY_RUNTIME=retired`。
- 退休路径对已经不存在的旧 LangBot/n8n 容器输出了 `No such object` 提示，但部署流程继续完成并
  成功退出；没有恢复这些 runtime。

## Independent live verification

- `docker inspect`：OpenClaw 和 Product Radar 均 `running/healthy`，镜像与上方 immutable tags 一致。
- `http://127.0.0.1:18789/healthz`：`{"ok":true,"status":"live"}`。
- `http://127.0.0.1:5315/health`：`status=ok`。
- live plugin/Skill preflight 文件存在于 checkpoint，PUBG/Amadeus native tools、`pubg_get_period_review`
  和 `pubg` Skill 均已核对；live manifest tool count 为 10。
- `./scripts/doctor.sh`：`Doctor result: 0 failure(s), 0 warning(s).`

## Acceptance boundary

没有发送未经请求的真实 Telegram/WhatsApp 群聊测试消息。真实自然语言 inbound、工具轨迹和最终
用户回复需要用户本人触发，因此不把 health、preflight、mock 或 owner outbox smoke 伪装成该项
验收；该边界仍记录为 pending。
