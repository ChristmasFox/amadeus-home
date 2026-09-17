# Kurisu Telegram `RUNTIME_SECRET_UNCONFIGURED` 修复 checkpoint

日期：2026-09-17（Asia/Shanghai）

## 现象与根因

在 `kurisu-gateway@0.1.2` 发布后，用户再次发送真实 Telegram 私聊，URL 错误已经消失，但返回 `RUNTIME_SECRET_UNCONFIGURED`。

检查确认：

- `langbot_plugin_runtime` 容器主进程有 `KURISU_GATEWAY_SECRET_FILE=/run/secrets/kurisu_gateway_secret`。
- LangBot 为插件启动的隔离子进程会清除该环境变量，但隔离进程仍能看到并读取已挂载的 `/run/secrets/kurisu_gateway_secret`。
- secret 文件 live 权限为 `0640`，大小 65 字节，未输出内容。
- `langbot`、plugin runtime 和 Runtime 位于同一 `langbot_langbot_network`；URL 连通性不是问题。

## 修复与部署

- `kurisu_gateway.py` 增加 `DEFAULT_SECRET_FILE = /run/secrets/kurisu_gateway_secret`；读取顺序为环境变量路径、固定挂载路径。
- manifest 版本从 `0.1.2` 升级到 `0.1.3`。
- 新增默认 secret 路径回归测试；Kurisu plugin tests `8/8 PASS`，Python compile、dry-run、`git diff --check` 和 `pnpm check:secrets` 通过。
- source commit `4d09589` 已 push 到 `origin/main`。
- `scripts/deploy-langbot.sh --apply --plugin kurisu-gateway --api-key-file /Users/blacksidev/.config/agent-monorepo/secrets/langbot-api-key --wait-seconds 90` 完成；LangBot API task `29` 为 `INSTALL_READY`。
- 当前 artifact SHA-256：`7ea0d3c88b61121ef4d6313e5a7910dbeeaa754dad737c3ff4bd559fb904077a`。

## 地址结论

不使用 Mac `192.168.5.3`，也不需要域名。容器内目标仍是 `http://pubg-query-engine-v3:5310`；secret 通过已挂载文件提供。

## 待完成

此前 Telegram 消息均在 `0.1.3` 之前失败，不重放。待用户重新发送真实 Telegram 消息，并在 KOOK 发送代表消息，确认 `kurisu_gateway` 成功、Runtime tool-call 成功和最终平台送达；在此之前不标记 `PRODUCT_COMPLETE`。
