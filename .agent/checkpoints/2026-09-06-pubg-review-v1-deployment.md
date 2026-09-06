# PUBG 对局复盘 V1 deployment checkpoint

日期：2026-09-06（Asia/Shanghai）
Git source：`acdfc65`（含实现 commits `fb6000a`、`2f6a63b`）
分支：`main`
状态：DEPLOYED / VERIFIED；未执行公网 push。

## Deployment targets

- canonical target：OrbStack Linux machine `ubuntu` 内 CasaOS。
- runtime image：`local/pubg-query-engine-v3:git-2f6a63b013ff`。
- runtime compose：`/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml`。
- runtime image rollback compose：`/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260906-231814`。
- parser/feature env rollback compose：`/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260906-232046`。
- active runtime env：`PUBG_TELEMETRY_PARSER_VERSION=telemetry-parser-5`、`PUBG_REVIEW_FEATURE_VERSION=review-features-5`。

## n8n / LangBot

- n8n workflow：`PUBG Data Gateway v3` / `pubg-data-gateway-v3-20260902`，已从 Git source 导入、重启并经 SQLite active/source marker 验证。
- n8n external rollback：`/home/node/.n8n/workflow-backups/codex-pubg-data-gateway-v3-20260902-before-20260906-231837.json`。
- LangBot plugin：`local/pubg-stats` `3.3.0`，API install task `14`，状态 `INSTALL_READY`。
- LangBot deployment backup：`.backups/langbot/20260906-231910`。
- API key 来自仓库外 `/Users/blacksidev/.config/agent-monorepo/secrets/langbot-api-key`，值未打印、未写 Git。

## Verification evidence

- runtime container：`pubg-query-engine-v3` running/healthy，image tag 正确。
- `/healthz`：HTTP 200；`/homehub/health`：healthy；n8n `/healthz`：HTTP 200。
- `scripts/doctor.sh`：0 failure、0 warning。
- `scripts/smoke-homehub-docker.sh`：read-only Docker socket、10 allowlisted services、真实 macOS metrics 通过。
- 真实 query：Match ID `d8c41c10-de9f-40b4-ac88-ede0ab554a31` 返回 `OK`；presentation sections 含 overview、turning_points、weapons、interactions、recovery、loot、environment、fun、key_fights、conclusion；telemetry `telemetry-parser-5` / `review-features-5`，新 feature cache 创建时间 `2026-09-06T15:21:25.459Z`。
- 真实报告 marker：荣都、武器信息、队友互动与误伤、恢复物品与能量、搜包与物资搬运、环境动作、一炮四轮、误伤三件套均存在。
- build/test：runtime 130 tests（129 pass、1 skip）、PUBG plugin 13 pass、typecheck、build、workflow test、secret scan、diff check 通过。

## Remaining

- Codex 未代发真实 Telegram 用户消息，避免用 bot 自发消息伪造 inbound 验证；用户可手动发送目标复盘句子完成最后的真实入站确认。
- 未执行公网 push；不修改外部 credentials。

## Rollback

1. runtime 若需回滚，恢复 image compose `docker-compose.yml.codex-backup.20260906-231814` 对应 image 并执行 CasaOS `docker compose up -d --no-build`。
2. parser/feature env 若需回滚，恢复 `docker-compose.yml.codex-backup.20260906-232046` 并执行 `docker compose up -d --no-build`。
3. n8n 使用 external backup 导入并重新激活原 workflow。
4. LangBot 使用 API/plugin management 恢复旧 `pubg-stats` package，保留当前 active plugin runtime 可回退。
