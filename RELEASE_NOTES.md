# Amadeus 1.7.5

- 图片生成开始与失败提示现在依据当前 Kurisu persona 和原始请求语境自然生成，并强制校验用户当前语言。
- 图片生命周期提示与实际生成图的多模态 caption 使用统一约 30 秒语义预算；caption 可在同一预算内重试一次语言错配或早期瞬态 provider 错误，不可用时仍正常发送图片且不注入固定成功文案。
- 保留 detached 图片生成、受信附件注册、DeliveryEnvelope v2 与 WhatsApp 单条原生图片/说明交付。
