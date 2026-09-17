# Kurisu Telegram 隔离插件进程 URL 修复 checkpoint

日期：2026-09-17（Asia/Shanghai）

## 新证据

第一次补 Compose 环境后，用户再次发送真实 Telegram 私聊。LangBot DB 的最新 `kurisu_gateway` 调用仍为 `RUNTIME_URL_UNCONFIGURED`。检查发现：

- `langbot_plugin_runtime` 主进程有 `KURISU_RUNTIME_URL=http://pubg-query-engine-v3:5310`。
- 实际运行插件的隔离子进程环境中该变量为 `<unset>`，`KURISU_GATEWAY_SECRET_FILE` 也被隔离清除。
- `langbot`、`langbot_plugin_runtime` 与 `pubg-query-engine-v3` 都在 `langbot_langbot_network`，两者访问 Runtime `/healthz` 均 HTTP 200。
- LangBot `plugin_settings` 中 `kurisu-gateway` 的 config 为空；因此问题不是 DNS、Mac IP 或域名，也不是 Runtime 不可达。

## 修复

- `kurisu-gateway` 增加源码默认值 `DEFAULT_RUNTIME_URL = http://pubg-query-engine-v3:5310`，解析顺序为环境变量、插件 config、私有默认值。
- 新增隔离进程默认值回归测试；Kurisu plugin tests `7/7 PASS`，Python compile、`git diff --check` 和 `pnpm check:secrets` 通过。
- manifest 版本从 `0.1.1` 升级到 `0.1.2`。
- source commit `cb5dd2d` 已 push 到 `origin/main`。
- `scripts/deploy-langbot.sh --apply --plugin kurisu-gateway --api-key-file /Users/blacksidev/.config/agent-monorepo/secrets/langbot-api-key --wait-seconds 90` 完成；LangBot API task `27` 为 `INSTALL_READY`。
- 当前 artifact SHA-256：`b6a0b6a9af8a535dee90553afa38ee34baa3ceb0a63f32813b11bca40b757678`。

## 地址结论

不使用 Mac `192.168.5.3`。该地址属于宿主网络，且当前 Runtime 只绑定宿主 `127.0.0.1:5310`；容器间正确地址是同一 Docker 网络内的服务名 `http://pubg-query-engine-v3:5310`。域名不是必需项。

## 待完成

此前 Telegram 消息均在修复前失败，不进行伪造重放。待用户重新发送真实 Telegram 消息，并在 KOOK 发送代表消息，确认插件实际调用成功、Runtime 执行成功和最终平台送达；在此之前不标记 `PRODUCT_COMPLETE`。
