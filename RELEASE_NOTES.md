# Amadeus 1.7.1

- 修复 M204 状态请求被 guest shell 劫持的问题，并在拦截后强制转向 MacHostAgent 原生只读工具。
- 宿主机工具兼容模型附带的只读 `reason` 字段，避免原生查询再次因参数校验失败。
