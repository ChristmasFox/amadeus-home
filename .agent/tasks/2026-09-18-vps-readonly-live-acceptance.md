# VPS read-only live acceptance（剩余真实入站证据）

完成 VPS read-only code checkpoint 后的下一阶段：

- [x] 在 `/DATA/AppData/openclaw/secrets/` 外部准备 KiwiVM credentials JSON；VPS read-only
  forced-command key 和 known-hosts 已 provision，仍不把任何值写入 Git 或报告。
- [x] 通过显式 `scripts/deploy-openclaw.sh --apply --build-auto` 发布并检查 plugin/Skill/cron。
- [ ] 由用户从真实 WhatsApp 入站发送一条自然语言 VPS 查询，记录 inbound、五个 VPS tool
  选择和最终回复；CLI Gateway smoke 已完成，但不替代真实渠道入站证据。
- [x] 验证 09:30/23:00 Asia/Shanghai VPS 报告真实到达唯一 WhatsApp owner DM，且不向 Telegram、
  KOOK 或群聊发送；晚报已验证十格进度条、增量、服务和 unknown 处理。
- [x] 重启 OpenClaw 后确认两个 VPS cron 仍存在、`vps-usage-state.json` 的成功 baseline 仍在，
  并更新 `docs/CURRENT_TASK.md`、`docs/PROJECT_STATE.md` 和部署 checkpoint。
