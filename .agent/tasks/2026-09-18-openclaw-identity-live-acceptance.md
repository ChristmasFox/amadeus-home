# OpenClaw Identity 线上验收

状态：待显式 RELEASE 操作；本地源码阶段已完成，线上尚未 apply。

执行前提：保留外部可恢复 checkpoint，确认目标是 OrbStack `ubuntu` 内的 CasaOS；不要恢复
LangBot、n8n、旧 Runtime、关键词路由或第二套 sender。

待完成：

- 按 `scripts/deploy-openclaw.sh` 的 RELEASE 流程构建包含 Identity 的 immutable OpenClaw
  image，更新 CasaOS compose 并以 `--no-build` 启动。
- 只使用运行时外部文件 `/DATA/AppData/openclaw/data/identity.sqlite` 和可选
  `/DATA/AppData/openclaw/data/identity-presets.json`；不要把真实 Telegram/WhatsApp ID、
  JID、手机号、PUBG account 或 secret 回写仓库。
- 在真实 Telegram/WhatsApp 私聊和群聊验证 trusted sender binding、群 alias 优先级、
  observed candidate -> Arthur confirm、`provider=pubg` account link，以及重启后的持久化。
- 验证未绑定 sender、候选/歧义和缺少 PUBG account 均返回明确 identity error，不会回退到默认
  队伍；同时确认 `team=true` 仅影响明确的队伍请求。
- 记录工具 inspect、真实入口 inbound/outbound、数据库重启前后摘要和 rollback checkpoint；
  健康检查或 mock/provider trace 单独不能证明产品验收完成。
