# 2026-09-26：WhatsApp 群聊中日双语语音根因与源码修复

## 结论

- 群聊 `/tts status` 显示 `Chat override: default`，因此不是群级 TTS override 把 provider 或开关改成了异常值；`Provider: openai` 且最近一次 `openai:success(ok)` 只证明合成成功，不证明送入合成器的文字只有日语。
- pinned OpenClaw 2026.9.4 的 Auto-TTS 逻辑是：有 `[[tts:text]]...[[/tts:text]]` 时使用 directive 文本；没有 directive 时使用清洗后的整段可见回复。于是模型若漏掉 directive，`中文：...` 和 `日本語：...` 会被一起合成。
- 现有 WhatsApp Japanese visible-text postprocessor 随后把 `spokenText` 当作单一日文句子写回 `日本語：` 行。若 `spokenText` 实际是整段双语文本，就会形成用户看到的重复结构：`中文：...` 后面出现 `日本語：中文：... 日本語：...`；已经生成的混合音频也会包含两段语言。

## 源码修复

- `scripts/patch-openclaw-whatsapp-voice-lifecycle.mjs` 新增 TTS runtime patch：仅对 WhatsApp inbound audio 从可见回复中选择最后一个含日文假名的 `日本語：` 行作为唯一 TTS 输入；没有可验证日文行时 fail-closed，不合成混合语音。
- 已有 WhatsApp delivery guard 加强为拒绝带双语结构或换行的 `spokenText`，避免旁路产生混合 PTT；只发送可见文字和日语语音失败提示。
- 新增 helper、patch anchor、重复日本語行和混合文本 fail-closed 测试；patch 保持幂等。

## 验证

- `pnpm test:openclaw-voice-lifecycle` 通过。
- `pnpm check:architecture` 通过。
- `pnpm check:secrets` 通过。
- `git diff --check` 通过。
- 当前 live OpenClaw 仍是 `local/openclaw-amadeus:git-b54c2ed84ee4-20260925195233`，本次 guard 只在源码，尚未构建、部署或重启；真实群聊验收待后续 release apply。
