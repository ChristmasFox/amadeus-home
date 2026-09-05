# HomeHub `/whoami` deployment checkpoint

日期：2026-09-05（Asia/Shanghai）

## Git release

- `main` 已推送到 `origin/main`。
- release commit：`ddfee46`（fix: package workspace domain for production runtime）。
- 之前的 `/whoami` 实现和状态提交：`b3f2406`、`c127527`、`1fcefd7`、`7626cde`。
- 部署前 `pnpm check:secrets`、`git diff --check`、TypeScript tests/build、Python tests 和 plugin dry-run 均通过。

## Runtime deployment

- canonical target：OrbStack machine `ubuntu` 内的 CasaOS。
- app compose：`/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml`。
- active image：`local/pubg-query-engine-v3:3.3.3-whoami-ddfee46`。
- image id：`sha256:4e902c2b578777be6c42733d180da5dc8e72e883139611833856504d336b8383`。
- container：`pubg-query-engine-v3`，`running`，health `healthy`，端口 `5310`。
- rollback compose：`/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260905-214712`。
- 旧 runtime 在第一次切换中因 production workspace package 未编译而自动回滚；已修复 Dockerfile/package build，第二次切换成功。

## LangBot deployment

- 执行：`LANGBOT_URL=http://127.0.0.1:5300 ./scripts/deploy-langbot.sh --apply --plugin pubg-stats-v3 --wait-seconds 120`。
- API key 从 Ubuntu `/DATA/AppData/langbot/data/config.yaml` 的外部 `api.global_api_key` 读取，未打印、未写入 Git。
- plugin：`local/pubg-stats` version `3.2.4`。
- 安装 task：`20`，readiness：`INSTALL_READY`，耗时约 3 秒。
- plugin artifact 和 LangBot backup 在仓库外 `.backups/langbot/20260905-214900`。
- 未修改 LangBot compose、未重建 LangBot 镜像；现有 `langbot` 和 `langbot_plugin_runtime` 保持运行。

## Verification

- `scripts/doctor.sh`：0 failure、0 warning。
- `GET http://127.0.0.1:5310/healthz`：通过。
- `POST http://127.0.0.1:5310/v3/whoami`：通过；Telegram fixture 返回 `platformUserId: 123456789`，`internalUser: unbound`、`role: unbound`。
- `POST http://127.0.0.1:5310/v3/whoami` KOOK fixture：通过；KOOK fixture 返回稳定 `platformUserId`，未按 displayName 匹配。
- 未执行真实 Telegram/KOOK 用户入站消息烟测；该项仍需人工从真实用户事件验证。

## Rollback

如需回滚 runtime：

```sh
orb -m ubuntu -u root bash -lc 'cp -p /var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260905-214712 /var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml && cd /var/lib/casaos/apps/pubg-query-engine-v3 && docker compose up -d'
```

LangBot plugin 回滚使用 `.backups/langbot/20260905-214900/pubg-stats-v3.lbpkg`，通过目标
LangBot 本地 API 重新安装上一个已验证版本；credential 仍由外部运行时保存。
