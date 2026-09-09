# Product Radar generic NLU live smoke

状态：SOURCE COMPLETE / TARGETED VERIFIED；生产安装与平台入站 smoke 尚未执行。

## 后续范围

- 在确认 release intent 后，用 `scripts/deploy-langbot.sh --plugin product-radar --apply` 安装 manifest `0.4.0`，保留外部 rollback package。
- 在目标 Telegram 私聊/群聊和 KOOK 会话分别验证：带图片的自然表达创建 similarity proposal、确认后 active Watch、`价格改成30万`、`每小时看一次`、`暂停它`、`不要了`。
- 在同一个群由第二个成员发送 follow-up，确认不会继承第一个成员的 pending/active context；发送图片问答文本确认不会创建 Watch。
- 仅在通过真实 inbound/outbound 证据后更新部署状态；不把 provider 返回或代码路径当作真实平台送达成功。
