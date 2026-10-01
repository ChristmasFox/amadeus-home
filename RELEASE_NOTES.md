# Amadeus 1.7.9

- 在原生图像生成执行边界强制采用管理员配置的逻辑路由，模型参数不能改选具体 provider/model。
- 跨 detached image task 与 OpenAI-compatible transport 加入安全关联诊断和路由不变量校验；不匹配时 fail closed。
- 保持现有 `amadeus-image` GPT Image 2.5 → Gemini image fallback，不改动 9Router 账号或凭据。
