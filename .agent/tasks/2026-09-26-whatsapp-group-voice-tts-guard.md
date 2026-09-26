# WhatsApp 群聊双语 TTS guard：待发布验收

## 已完成

- 已确认 `Chat override: default` 不是根因。
- 已在 `scripts/patch-openclaw-whatsapp-voice-lifecycle.mjs` 增加 WhatsApp inbound audio 的日文 TTS 输入选择和混合文本 fail-closed guard。
- 定向 patch 测试、架构检查、secret scan 和 diff check 已通过。

## 已完成部署

- 已 bump 至 `VERSION=1.5.9`，commit `3f9171f`，并执行 `--apply --build-auto`。
- live image 为 `local/openclaw-amadeus:git-3f9171f47b19-20260926043743`；checkpoint 为 `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260926043743`。
- OpenClaw healthy、restart=0、TTS marker 存在、WhatsApp 已监听群聊；strict doctor 仅剩已知可选 media adapter 缺失。

## 待完成

1. 保留部署前 rollback checkpoint；在同一群聊发送一条短语音，确认：
   - 音频只有一段日语；
   - 可见文字只有一组 `中文：` 和一组 `日本語：`；
   - 不再出现 `日本語：中文：...` 的嵌套重复；
   - 私聊 typed/voice 行为不回归。
3. 记录真实 WhatsApp 群聊 trace 后关闭本任务。

在完成真实验收前，不宣称线上已修复；不清空群聊会话记忆，不执行 `/new`。
