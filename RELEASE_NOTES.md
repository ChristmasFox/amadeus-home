# Amadeus 1.6.6

- 将 Kurisu 语音切换到固定版本的 OminiX Qwen3-TTS Base x-vector 引擎，保留 `amadeus-tts`、`kurisu-v1` 兼容契约，并支持七项受限情绪。
- 固化 9Router 语音情绪透传与 WhatsApp 控制标记清理，避免内部指令出现在可见正文。
- 增强候选与正式发布的 owner outbox 通知和回滚证据。
