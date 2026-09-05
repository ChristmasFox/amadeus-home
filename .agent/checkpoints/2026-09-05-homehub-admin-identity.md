# HomeHub Admin Identity 配置 checkpoint

日期：2026-09-05（Asia/Shanghai）

## 变更

- 新增 `apps/agent-runtime/src/config/identity.ts`，从外部环境读取
  `TELEGRAM_ADMIN_USER_ID`、`KOOK_ADMIN_USER_ID`。
- 有效配置会建立 `internalUserId=arthur`、`roles=['ADMIN']` 的 Identity mapping；
  缺少或占位值不会建立绑定。
- server 启动时把 mapping 注入 `IdentityRegistry`，`/whoami` 可以显示 `arthur` / `ADMIN`。
- root `.env.example`、`apps/agent-runtime/.env.example` 和 CasaOS 脱敏 compose template
  增加空配置项。
- 本机 `.env` 已填入用户提供的真实平台 ID；`.env` 被 Git 忽略，未进入 commit。

## 安全边界

- 真实 ID 没有写入 TypeScript、README、`.env.example`、Dockerfile 或 Git checkpoint。
- 昵称、username、displayName 仍不参与身份 mapping。
- Admin mapping 只注入现有 `IdentityRegistry`，没有新增账号绑定写入、权限授予或 Action 执行。

## 验证

- `pnpm --filter @agent/agent-runtime typecheck`：通过。
- `pnpm --filter @agent/agent-runtime build`：通过。
- `pnpm --filter @agent/agent-runtime test`：通过，101 tests / 100 pass / 1 skip。
- LangBot Python tests：12 tests 通过。
- 本地 dev server 通过 root `.env` 启动，Telegram/KOOK fixture 均返回 `arthur` / `ADMIN`。
- `pnpm check:secrets`、`git diff --check`：通过。

## Deployment

- 已部署到 canonical OrbStack `ubuntu` / CasaOS；active image 为
  `local/pubg-query-engine-v3:3.3.4-admin-03b0e41`。
- 外部 identity env file：`/DATA/AppData/pubg-query-engine-v3/admin-identity.env`，权限为 `0600`；真实值未写入 Git。
- CasaOS runtime compose 已通过该 env file 重建并健康运行。
- 部署回滚和验证细节记录在 `.agent/checkpoints/2026-09-05-homehub-admin-identity-deployment.md`。
