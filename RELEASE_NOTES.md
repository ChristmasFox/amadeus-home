# Amadeus 1.7.7

- 生图工具现在忽略模型生成的具体 provider/model 覆盖，始终回到运维配置的 `amadeus-image` 逻辑 capability 与既有 fallback。
- 异步生图生命周期按 account-scoped conversation 补取原始私聊语境，修复 session key 不一致时语言退化为 unknown。
- 保留严格 WhatsApp final typed delivery 和内部任务静默边界。
