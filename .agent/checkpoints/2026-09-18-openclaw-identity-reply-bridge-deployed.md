# OpenClaw Identity reply metadata bridge（线上切换）

日期：2026-09-18（Asia/Shanghai）
状态：DEPLOYED_LIVE_REAL_INPUT_PENDING

## 发布结果

- 提交 `56a0df5` 已完成受影响 package build/typecheck/test、secrets scan 和 ARM64 image
  build；CasaOS canonical target 为 OrbStack `ubuntu`。
- 新 OpenClaw image：
  `local/openclaw-amadeus:git-56a0df53595e-20260918093413`；容器状态 `running`、health
  `healthy`。
- 外部恢复点：`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918093413`。
  compose 已以 immutable image 和 `--no-build` 启动；旧 LangBot/n8n runtime 仍保持退休。

## 线上证据

- `openclaw plugins inspect amadeus --runtime --json` 显示 bundled/trusted/loaded，七个
  Identity tools 存在，`typedHooks` 包含 `before_dispatch` 和 `agent_end`，diagnostics 为空。
- Gateway 无投递只读 smoke 实际调用 `identity_resolve(self)`，结果仍为
  `unbound / trusted_sender_metadata_unavailable`；没有 sender metadata 时 fail closed，未
  绑定、写数据库或投递消息。
- `/DATA/AppData/openclaw/data/identity.sqlite` 的四张表当前均为 0 行：
  `persons=0`、`channel_identities=0`、`aliases=0`、`external_accounts=0`。未伪造或导入任何
  Telegram/WhatsApp/PUBG 个人数据。

## 验收边界

仍需真实 Telegram/WhatsApp 私聊和群聊入站，验证 trusted sender binding、reply binding、
provider account link、群 alias observed candidate -> Arthur confirm，以及重启后的非空
SQLite 持久化。mention 仍必须由 host 提供结构化 platform ID；不能用昵称、prompt 文本、
health、mock 或 provider trace 冒充真实平台验收。
