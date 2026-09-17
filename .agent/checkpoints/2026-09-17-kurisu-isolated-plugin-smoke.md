# Kurisu 隔离插件真实结构化 smoke checkpoint

日期：2026-09-17（Asia/Shanghai）

## 验证目的

用户要求继续自测直到正常。由于本机没有可用的 Telegram 客户端，不能伪造 Telegram 入站；本次在实际运行中的 LangBot plugin runtime、实际安装 artifact 和实际隔离插件执行环境中做结构化只读调用，验证 URL 与 secret 边界。

## 测试方法

- 使用 live `kurisu-gateway@0.1.3` artifact：
  `7ea0d3c88b61121ef4d6313e5a7910dbeeaa754dad737c3ff4bd559fb904077a`。
- 清除 `KURISU_RUNTIME_URL`、`KURISU_GATEWAY_SECRET`、`KURISU_GATEWAY_SECRET_FILE` 三个环境变量，模拟 LangBot 隔离插件子进程。
- 通过实际 `KurisuGatewayTool` 调用只读 `kurisu.radar.list`，使用真实 Telegram bot registry identity 和真实 Runtime endpoint。

## 结果

返回 `contractVersion=kurisu.v1`、`status=ok`，并取得现有 Watch 结构化数据；没有 `RUNTIME_URL_UNCONFIGURED` 或 `RUNTIME_SECRET_UNCONFIGURED`。此前一次 `kurisu.radar.status` 返回 `WATCH_ID_REQUIRED` 是业务参数校验，反而证明请求已通过 Gateway secret、Runtime 前门和工具注册；整个测试没有写入 Watch 或其他业务数据。

## 结论

插件→Runtime 链路已正常。`192.168.5.3` 和域名都不需要配置，容器内继续使用 `http://pubg-query-engine-v3:5310`，secret 继续使用挂载文件 `/run/secrets/kurisu_gateway_secret`。

## 仍待平台边界

本机没有 Telegram GUI/已登录 Telegram Web，不能自行产生合法 Telegram 用户入站；需要用户在 Telegram 私聊重新发送一条消息，才能验证 Native Agent 的最终渲染和 Telegram 送达。KOOK 也需真实入站。不得用本次结构化 smoke 代替 R03/R04。
