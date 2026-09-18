# OpenClaw Identity 线上验收

状态：部分完成；RELEASE 已执行，真实 Telegram/WhatsApp 身份数据验收待用户入口。

执行前提：保留外部可恢复 checkpoint，确认目标是 OrbStack `ubuntu` 内的 CasaOS；不要恢复
LangBot、n8n、旧 Runtime、关键词路由或第二套 sender。

已完成：

- 运行 `05471a8` 对应的受影响 package build/typecheck/test/secrets scan，并构建
  `local/openclaw-amadeus:git-05471a8618f1-20260918091819`。
- CasaOS compose 已以 `--no-build` 切换；外部 checkpoint 为
  `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918091819`。
- 运行时 inspect 确认七个 Identity tools、PUBG tools 和 `identity` Skill 已加载；Gateway
  只读 smoke 实际调用 `identity_resolve(self)`，返回 `unbound / trusted_sender_metadata_unavailable`。
- `/data/identity.sqlite` 已创建，四张身份表存在且当前均为 0 行；没有伪造或写入生产身份记录。

待完成：

- 当前 Identity image 已完成一次 RELEASE apply；本轮新增的 typed reply metadata bridge 需
  按 `scripts/deploy-openclaw.sh` 的 RELEASE 流程重新构建 immutable OpenClaw image，更新
  CasaOS compose 并以 `--no-build` 启动。
- 只使用运行时外部文件 `/DATA/AppData/openclaw/data/identity.sqlite` 和可选
  `/DATA/AppData/openclaw/data/identity-presets.json`；不要把真实 Telegram/WhatsApp ID、
  JID、手机号、PUBG account 或 secret 回写仓库。
- 在真实 Telegram/WhatsApp 私聊和群聊验证 trusted sender binding、群 alias 优先级、
  observed candidate -> Arthur confirm、`provider=pubg` account link，以及重启后的持久化。
- 验证未绑定 sender、候选/歧义和缺少 PUBG account 均返回明确 identity error，不会回退到默认
  队伍；同时确认 `team=true` 仅影响明确的队伍请求。
- 验证真实回复消息的 `replyToSender` 能进入同一 turn 的 `identity_resolve(reply_sender)` /
  `identity_bind_channel`；没有可信 reply metadata 时仍返回 unbound。普通 mention 目标仍需
  host 传入结构化 platform ID，不能用昵称文本代替。
- 记录工具 inspect、真实入口 inbound/outbound、数据库重启前后摘要和 rollback checkpoint；
  健康检查或 mock/provider trace 单独不能证明产品验收完成。
