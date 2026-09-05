# HomeHub `/whoami` checkpoint

日期：2026-09-05（Asia/Shanghai）

## 变更

- 新增 `apps/agent-runtime/src/platform/core/whoami.ts`：平台无关的 `/whoami` 命令识别、
  稳定身份解析、结构化 schema、PresentationModel 和文本 formatter。
- `IdentityRegistry` 增加只读 `isBound()`，映射仍只按 `platform + platformUserId` 匹配。
- `PubgMastraRuntime.whoami()` 绕过 PUBG query workflow，不读取/写入 Context，不调用
  DataProvider、Action、审计或危险工具。
- server 增加 `/whoami`、`/homehub/whoami`、`/v3/whoami` 及 API aliases。
- LangBot V3 plugin 增加 `WhoAmICommand`、manifest 3.2.4 和 `/v3/whoami` client path；
  未缓存 plugin result，避免只读命令产生可变状态。
- 增加 Telegram/KOOK 及同昵称不同 userId 测试，并同步 workspace exports、README 和状态文件。

## 验证

- `pnpm --filter @agent/agent-runtime typecheck`：通过。
- `pnpm --filter @agent/agent-runtime build`：通过。
- `pnpm --filter @agent/agent-runtime test`：通过，99 tests / 98 pass / 1 skip。
- `PYTHONPATH=integrations/langbot/plugins/pubg-stats-v3 python3 -m unittest discover ...`：通过，11 tests。
- LangBot V3 Python `py_compile`：通过。
- `./scripts/build_pubg_v3_plugin.sh /tmp/pubg-stats-v3-whoami.lbpkg`：通过，产物包含 `whoami` command。
- `./scripts/deploy-langbot.sh --dry-run`：通过；未执行 API 安装、镜像构建或 CasaOS 修改。
- `pnpm check:secrets`：通过。
- `git diff --check`：通过。
- 本地 `tsx` server smoke：`POST /v3/whoami` 返回 Telegram 结构化身份，且指定 state file 未生成。

## 安全与身份事实

- Telegram `platformUserId` 来自事件 `from.id`。
- KOOK `platformUserId` 来自事件 `author_id`，session path 使用对应稳定 sender ID。
- `displayName`/nickname/username 仅用于显示，绝不参与 mapping 或授权。
- 未绑定输出 `internalUser: unbound`、`role: unbound`。

## 当前分支与部署

- 实现提交：`b3f2406`（feat: add read-only whoami command）；分支：`main`，未执行公网 push。
- 代码和插件 source 已进入 Git；未部署到 OrbStack ubuntu/CasaOS。
- 目标环境真实入站烟测仍由 `.agent/tasks/homehub-runtime-smoke.md` 负责。

## 下一步

- 在审阅 compose、备份和回滚点后，按显式部署流程将包含 `/whoami` 的 runtime/plugin 部署到
  OrbStack ubuntu/CasaOS，并用真实 Telegram/KOOK 私聊和群聊/频道事件烟测。
