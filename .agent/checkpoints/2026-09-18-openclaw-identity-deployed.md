# OpenClaw 跨渠道 Identity 线上切换

日期：2026-09-18（Asia/Shanghai）
状态：DEPLOYED_LIVE_REAL_INPUT_PENDING

## 切换结果

- 提交 `05471a8` 已通过部署脚本的受影响 package build/typecheck/test、secrets scan 和
  ARM64 image build。
- `scripts/deploy-openclaw.sh --apply --build-auto` 判断只需重建 OpenClaw，Product Radar
  复用原 immutable image；切换后的 OpenClaw image 为
  `local/openclaw-amadeus:git-05471a8618f1-20260918091819`。
- CasaOS canonical target 是 OrbStack `ubuntu`；compose 已使用 `--no-build` 重建，健康、
  Product Radar、media adapter network、NAS read-only 和 owner outbox smoke 均通过。
- 外部恢复点：`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918091819`。
  旧 LangBot/n8n app/data 路径和容器已退休，未恢复任何旧 runtime/fallback。

## Identity live evidence

- Amadeus runtime inspect：bundled/trusted/loaded，七个 Identity tools 全部出现；PUBG runtime
  inspect 也通过。`skills list` 显示 `identity` 为 eligible，容器内 Skill 文件存在。
- Gateway 无投递只读 smoke 实际调用了 `identity_resolve(reference=self)`，successful tool
  names 只有 `identity_resolve`，结果为 `unbound`，原因是 CLI 没有可信 sender metadata。
  这验证了 fail-closed，不把 CLI 会话伪装成 Telegram/WhatsApp 用户。
- `/data/identity.sqlite` 已创建，`persons`、`channel_identities`、`aliases`、
  `external_accounts` 均存在且当前为 0 行；没有把个人 ID、JID、手机号或 secret 写入 Git。

## 未完成验收

需要真实 Telegram/WhatsApp 私聊和群聊 inbound 才能验证 trusted sender binding、provider
account link、群 alias observed candidate -> Arthur confirm，以及重启后的非空数据持久化。
这些不能用伪造 ID、mock、health、provider trace 或当前空数据库冒充；后续步骤见
`.agent/tasks/2026-09-18-openclaw-identity-live-acceptance.md`。
