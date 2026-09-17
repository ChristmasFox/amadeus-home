# Kurisu Telegram `RUNTIME_URL_UNCONFIGURED` 修复 checkpoint

日期：2026-09-17（Asia/Shanghai）

## 现象

管理员 Telegram 私聊在 09:39–09:40 发送“帮我查一下当前监控状态”“今日战报”“今日战绩”。三条消息都真实进入 LangBot Native Agent，并由 `kurisu_gateway` 选择；Runtime tool-call 结果均为 `status=unsupported`、`error.code=RUNTIME_URL_UNCONFIGURED`。因此路由没有失败，失败点是插件运行时缺少 Kurisu Runtime 地址。

## 根因

`integrations/langbot/plugins/kurisu-gateway/components/tools/kurisu_gateway.py` 只从 `KURISU_RUNTIME_URL` 或插件 config 的 `runtime_url` 读取地址。manifest 虽声明了 `http://pubg-query-engine-v3:5310` 默认值，但当前 LangBot plugin runtime 没有自动把 manifest 默认值注入环境或插件 config；live Compose 也没有 `KURISU_RUNTIME_URL`。

## 修复与部署

- 在 `infra/docker/casaos/langbot/docker-compose.example.yml` 为 `langbot_plugin_runtime` 增加 `KURISU_RUNTIME_URL: http://pubg-query-engine-v3:5310`。
- source commit `5d64574` 已 push 到 `origin/main`。
- 已备份并更新 CasaOS live Compose：
  `/var/lib/casaos/apps/langbot/docker-compose.yml.codex-kurisu-runtime-url.20260917-094342`。
- 已执行 `docker compose up -d --no-build langbot_plugin_runtime`；没有重新构建 LangBot 镜像，也没有改变业务数据。

## 已验证

- live `langbot_plugin_runtime`：`Up`，环境中 `KURISU_RUNTIME_URL=<configured>`。
- plugin runtime → Runtime：`http://pubg-query-engine-v3:5310/healthz` 返回 HTTP 200，Runtime 为 `local/pubg-query-engine-v3:git-015df8f`、`healthy`。
- plugin runtime 启动日志：`local/kurisu-gateway` mounted/initialized。
- `pnpm check:secrets`：PASS。
- `git diff --check`：PASS。

## 待完成

截图中的三条历史消息已经失败，不进行伪造重放。需要用户在配置修复后重新发送至少一条 Telegram 私聊，并在 KOOK 发送代表消息，取得 Runtime tool-call 成功和最终平台送达证据；在此之前不标记 `PRODUCT_COMPLETE`。
