# Amadeus 1.7.6

- WhatsApp 最终 delivery callback 即使绕过 `preparePayload` 也会重新执行严格 typed 解码；遗留 modality-marker 前缀、原样 sentinel 等非-envelope输出 fail closed，不进入可见发送。
- 保留 heartbeat/cron/internal run 的可信 provenance 到最终 settlement，避免内部静默 turn 被临时提升为 external user。
- 图片生命周期 follow-up 不会因为引用先前开始/失败提示而重复生图；完成图片的请求语言继续以原始用户输入为准。
