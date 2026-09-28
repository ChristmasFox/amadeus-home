# Amadeus 1.7.2

- 修复群聊文字请求语音时被外层 TTS eligibility gate 短路的问题；显式语音模态现在会进入日语语音兜底链路。
- 增加 typed voice TTS gate 回归覆盖，避免模型漏发 TTS 控制行时再次只发送文字。
