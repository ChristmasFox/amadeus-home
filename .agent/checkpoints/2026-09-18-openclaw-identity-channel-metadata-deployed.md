# OpenClaw Identity trusted channel metadata（线上切换）

日期：2026-09-18（Asia/Shanghai）  
状态：DEPLOYED_LIVE_REAL_INPUT_PENDING

## 发布结果

- 提交 `4831659` 已完成受影响 package build/typecheck/test、secrets scan、Docker image build
  和 `git diff --check`；Dockerfile 的 pinned OpenClaw 2026.9.4 Telegram bundle 补丁构建成功。
- 新 OpenClaw image：
  `local/openclaw-amadeus:git-4831659fc216-20260918100611`；容器状态 `running`、health
  `healthy`。
- 外部恢复点：`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918100611`；compose 已以
  immutable image 和 `--no-build` 启动。
- 旧 LangBot/n8n app/data 路径仍为 retired；Product Radar 复用未受影响的 immutable image。

## 线上证据

- Telegram `/app/dist/bot-message-nRw-6GtF.mjs` 含
  `codex-amadeus-identity-metadata-v1`，Node syntax check 通过；重复 patch 返回
  `ALREADY_PATCHED`。
- 持久化 WhatsApp package 的 `monitor-DaIAK4fT.js` 已 patch，重复 patch 返回
  `ALREADY_PATCHED`。补丁只传递真实 `text_mention`/`mentionedJid`/sender JID，不把昵称、手机号
  文本、用户名或 prompt 当作身份。
- `/home/node/.openclaw/workspace/SOUL.md` 与 `MEMORY.md` 哈希分别为
  `e216051c43bd5657282efd57e6ae59ca06d17b636ab70e4a7f5c13ca70699da9` 和
  `daaf678dc6c6d767db252ee575cdab8d0288b0cb9012760d5f31233e40af7e82`，与仓库完全一致。
- OpenClaw、Product Radar、media adapter network、NAS read-only smoke、owner WhatsApp outbox
  smoke 均通过；四张 identity 表均为 0 行，未伪造或导入任何个人平台数据。

## 本地验证

- `pnpm build`、`pnpm typecheck`、`pnpm test`：PASS（6+9+6+6+51 tests）。
- `pnpm check:secrets`、`python3 -m py_compile scripts/openclaw_prepare.py`、
  `bash -n scripts/deploy-openclaw.sh`、`node --check scripts/patch-openclaw-channel-identity.mjs`：PASS。
- Docker image build、镜像内 Telegram Node syntax check、live WhatsApp patch 的幂等检查：PASS。

## 验收边界

仍需真实 Telegram/WhatsApp 私聊和群聊入站，验证 trusted sender binding、reply binding、provider
account link、群 alias observed candidate -> Arthur confirm，以及重启后的非空 SQLite 持久化。mention
仍必须由 host 提供结构化 platform ID；不能用昵称、prompt 文本、health、mock 或 provider trace
冒充真实平台验收。
