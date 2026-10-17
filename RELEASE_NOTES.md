# Amadeus 1.10.7

- 将 PUBG 原始遥测以 gzip、SHA-256 校验和原子写入方式长期归档，并提供最近 100 场比赛回填。
- Intelligence Lab 研究对话接入 Vercel AI SDK，使用配置的 9Router arthur-combo 模型并保留证据引用。
- PUBG 自动预取路径归档完整遥测响应，研究页面优先读取本地归档以支持重复分析。
- PUBG 遥测归档使用持久存储挂载；候选部署会验证目录可写，并在失败时恢复配置和镜像。
