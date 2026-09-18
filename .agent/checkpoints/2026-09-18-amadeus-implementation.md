# Amadeus implementation checkpoint

日期：2026-09-18（Asia/Shanghai）
状态：SOURCE_READY / LIVE_APPLY_PENDING

## 已完成

- 新增 `plugins/amadeus` 原生 OpenClaw plugin：Product Radar、媒体整理、NAS、HomeLab、
  KOOK 群成员、briefing 和 owner outbox worker。
- Product Radar、Codex hook 和业务事件统一写 channel-free outbox；主动通知目标固定为
  WhatsApp owner DM。
- OpenClaw 模板改为 `tools.profile="full"`，不再使用只列出六个 PUBG 工具的严格
  `tools.allow`；Amadeus plugin 与 PUBG plugin 都进入配置加载路径。
- WhatsApp owner identity 从现有 `commands.ownerAllowFrom` 注入；私聊使用 owner
  allowlist；群聊不设置工具级 deny/allowlist，成员继承 full profile。高风险 tool 仍由
  自身 owner/confirmation policy 保护。
- 删除 Git 中旧 LangBot/n8n plugin、workflow、compose、watchdog、旧通知/部署脚本和过期
  PUBG-only goal/config；NAS 宿主机脚本迁移到 `infra/macos/nas-control.sh`。
- `scripts/deploy-openclaw.sh` 默认 dry-run，`--apply --build` 会先创建外部 checkpoint，
  再构建/加载镜像、退休旧 app/data、启动 OpenClaw/Product Radar，并验证 full tool policy、
  native tools、health、NAS、briefing cron、owner WhatsApp outbox 和旧路径不存在。

## 本地证据

- `pnpm build`：PASS
- `pnpm typecheck`：PASS
- `pnpm test`：PASS（PUBG domain 9、PUBG plugin 5、Amadeus 1、Product Radar 51）
- `pnpm check:secrets`：PASS
- shell/Python syntax、owner identity helper、`git diff --check`：PASS
- `scripts/deploy-openclaw.sh --dry-run`：PASS

## Live 根因记录

切换前 live OpenClaw 的 `tools.allow` 只有六个 `pubg_*`，配置加载路径只有 `pubg`；WhatsApp
channel 已 linked/healthy，`commands.ownerAllowFrom` 仍存在。截图中 Kurisu 声称“其他功能以后
解锁”的直接原因就是这份 strict PUBG-only policy，而不是 WhatsApp 链路故障。

## 待执行

1. 提交并 push 本 checkpoint 对应的 reviewed source。
2. 执行 `scripts/deploy-openclaw.sh --apply --build`。
3. 发送真实 WhatsApp owner 私聊和群聊 smoke，确认正常成员能力不再被 PUBG-only 限制；记录
   实际 checkpoint、镜像 tag、工具 inspect、容器/路径和 outbox sent marker。
