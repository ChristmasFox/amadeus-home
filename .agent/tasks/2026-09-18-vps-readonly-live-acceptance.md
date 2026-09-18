# VPS read-only live acceptance

完成 VPS read-only code checkpoint 后的下一阶段：

- 在 `/DATA/AppData/openclaw/secrets/` 外部准备 KiwiVM credentials JSON；VPS read-only
  forced-command key 和 known-hosts 已 provision，仍不把任何值写入 Git 或报告。
- 通过显式 `scripts/deploy-openclaw.sh --apply --build-auto` 发布并检查 plugin/Skill/cron。
- 用真实自然语言消息验证 OpenClaw 自主选择 VPS tools；记录 service/live/usage/system/services
  结果与 stale/error 边界。
- 验证 09:30/23:00 Asia/Shanghai VPS 报告真实到达唯一 WhatsApp owner DM，且不向 Telegram、
  KOOK 或群聊发送。
- 重启 OpenClaw 后确认两个 VPS cron 仍存在、`vps-usage-state.json` 的成功 baseline 仍在，
  再更新 `docs/CURRENT_TASK.md`、`docs/PROJECT_STATE.md` 和部署 checkpoint。
