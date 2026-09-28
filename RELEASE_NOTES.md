# Amadeus 1.7.0

- 修复 M204 状态请求误调用 guest shell 读取 OrbStack/Linux 数据的问题。
- 宿主机指标统一要求调用 MacHostAgent 原生只读工具；阻断 guest shell 和原始 MacHostAgent HTTP 替代路径。
