# Amadeus 1.7.5

- 图片生成开始与失败提示现在依据当前 Kurisu persona 和原始请求语境自然生成，并延续用户当前使用的语言。
- 图片生命周期提示与实际生成图的多模态 caption 使用统一约 30 秒语义预算；caption 不可用时仍正常发送图片，不再注入固定成功文案。
- 保留 detached 图片生成、受信附件注册、DeliveryEnvelope v2 与 WhatsApp 单条原生图片/说明交付。
