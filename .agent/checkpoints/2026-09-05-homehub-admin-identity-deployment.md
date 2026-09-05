# HomeHub Admin Identity deployment checkpoint

日期：2026-09-05（Asia/Shanghai）

## Release

- Git source 已推送到 `origin/main`，代码 release commit：`03b0e41`。
- 本次按用户要求未运行自动测试套件；只执行了必要的 secrets scan、production image build、
  compose health 和 `/whoami` operational verification。

## CasaOS deployment

- canonical target：OrbStack machine `ubuntu` 内的 CasaOS。
- active runtime image：`local/pubg-query-engine-v3:3.3.4-admin-03b0e41`。
- compose：`/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml`。
- external env file：`/DATA/AppData/pubg-query-engine-v3/admin-identity.env`，权限 `0600`；
  内容未打印、未进入 Git。
- compose rollback：`/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260905-225425`。

## Identity behavior

- server startup reads `TELEGRAM_ADMIN_USER_ID` and `KOOK_ADMIN_USER_ID`。
- configured platform IDs map to `internalUser=arthur` and `role=ADMIN`。
- mapping remains based only on `platform + platformUserId`。
- live operational check for both Telegram and KOOK `/v3/whoami` returned `arthur` / `ADMIN`。
- no database binding, account mutation, Action, or dangerous tool was invoked by the mapping check。

## Verification

- runtime container：`running` / `healthy`。
- `/healthz`：通过。
- `/v3/whoami` Telegram and KOOK fixtures：通过。
- `scripts/check-secrets.sh`：通过。
- `git diff --check`：通过。
- 未执行真实 Telegram/KOOK 用户入站复测；需要用户再次发送 `/whoami` 确认最终平台消息路径。

## Rollback

```sh
orb -m ubuntu -u root bash -lc 'cp -p /var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260905-225425 /var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml && cd /var/lib/casaos/apps/pubg-query-engine-v3 && docker compose up -d'
```
