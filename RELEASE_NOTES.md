# Amadeus 1.6.6

- 将 Kurisu 语音切换到固定版本的 OminiX Qwen3-TTS Base x-vector 引擎，保留 `amadeus-tts`、`kurisu-v1` 兼容契约，并支持七项受限情绪。
- 优化 Kurisu 默认语音的句级抑扬、关键词强调和“先尖后软”的傲娇弧线，并将七项情感改为可观察的停顿、速度、音高、能量与句尾行为。
- 固化 9Router 语音情绪透传与 WhatsApp 控制标记清理，避免内部指令出现在可见正文。
- 增强候选与正式发布的 owner outbox 通知和回滚证据。
