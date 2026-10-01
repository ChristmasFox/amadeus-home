# Amadeus 1.7.8

- 修正工具参数合并语义：把模型指定的生图 `model` 覆盖重置为空值，确保配置的 `amadeus-image` capability 与 fallback 真正生效。
- 私聊原始文本 body 为空时改用非空 normalized content，保证异步任务能取得原始请求语言。
- 保留 list/status 查询、typed final delivery 与内部任务静默行为。
