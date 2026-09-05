# Migration and Rollback

## Snapshot

修改前的 V3 与 LangBot 相关快照保存在：

```text
docs/platform-adapter/baseline/
```

已保存 sanitized 配置、V3 Runtime 源码、PUBG Plugin、KOOK patch 和 V3 compose；未保存 API key、KOOK token、9Router credential 或其他 secret。

## Side-by-Side Boundary

- n8n V3 Data Gateway 与 Sync Workflow 不变。
- 既有 V2/V3 查询业务逻辑不删除。
- 新 platform core、KOOK adapter、Telegram mock adapter 与 Runtime envelope 输入在源码侧并行存在。
- LangBot 命令/Tool 不再直接实例化 `KookAdapter`，统一通过 `components/platform/registry.py` 的通用会话适配入口；KOOK 原始事件读取仍只位于 KOOK adapter。
- `RuntimeRequest` 兼容旧 primitive 字段，因此旧 `/pubg` 调用仍可生成标准消息。

## Cutover Plan

1. 构建新 Query Engine image，当前 live 为 `local/pubg-query-engine-v3:3.1.0-adapter`，并保留 `local/pubg-query-engine-v3:3.1.0-adapter-pre-20260902` 作为本次 Adapter 变更回滚镜像。
2. 部署 Runtime 后先执行 health、fixture 和 HTTP envelope smoke test。
3. 通过官方 Local Plugin API Preview/Install 部署 `pubg-stats` `3.1.1` artifact；KOOK listener 仍使用原有事件类型，但先通过 `KookAdapter` 归一化。
4. 验证 `/pubg`、自然语言 PUBG、普通 LangBot chat 和 `/status`。
5. 观察日志中的 `platform`、`chatType`、`platformUserId`、`queryId`、`resultSetId` 和 `sendStatus`。

## Rollback

- Runtime：将 CasaOS compose image 恢复为 `local/pubg-query-engine-v3:3.1.0-adapter-pre-20260902`，重新 `docker compose up -d`；若需回退到历史 V3，再使用 `local/pubg-query-engine-v3:3.0.3`。
- Plugin：恢复 `docs/platform-adapter/baseline/pubg-langbot-plugin-v3/` 对应 artifact，保留旧 plugin，不删除数据。
- n8n：不修改、不删除当前 active Workflow；如需回退，仅恢复旧 LangBot endpoint/插件，不触碰 `database.sqlite`。
- Data：不删除 `pubg_cache`、Match Store 或 Runtime state。

## Telegram Boundary

源码侧仍以 `TelegramAdapter` fixture 保持无网络测试；2026-09-02 用户已在 LangBot WebUI 配置 Telegram Bot，live Bot 为 `Arthur's Agent`（`@arthur_amadues_bot`），绑定 `KOOK Pipeline`。Token 只保存在 LangBot 运行数据库中，不复制到仓库或文档。

由于 LangBot 容器直连 Telegram API 超时，已在 CasaOS LangBot 主服务加入现有 `host.docker.internal:7897` 代理，并保留内部容器网段直连；随后为内置 Adapter 增加显式超时、polling bootstrap 无限重试、启动失败指数退避，以及统一出站 Bot API 的 `TimedOut`/`NetworkError` 三次有限重试，避免一次 `httpcore.ReadTimeout` 让 Bot 离线或让回复直接报错。之后又加入 polling watchdog：保持适配器任务存活、检查 PTB polling task、记录 polling 异常，并在非预期退出后自动重启适配器。当前 live image 为 `langbot-local:4.10.8-telegram-watchdog-20260902`，重建后容器内 `getMe` 成功，`getWebhookInfo` 为无 webhook、待处理更新数为 0，且稳定观察无新 Telegram timeout。2026-09-02 已收到真实 Telegram 私聊和群聊消息，普通测试和 PUBG `今天战绩`/`昨天战绩` 均产生一次对应回复。

本次 watchdog 部署前的 CasaOS compose 回滚副本为 `/var/lib/casaos/apps/langbot/docker-compose.yml.pre-20260902-telegram-watchdog`；发送重试版本和旧镜像仍保留。n8n、插件运行时、PUBG Query Engine 和 `pubg_cache` 未改动。

无论使用 fixture 还是 live transport，PUBG Graph、Query Schema、Query Engine、Context 和 n8n PUBG workflow 均不需要因平台变化而修改。

## Latest Deployment Record

- Preview：成功，组件为 1 个 `EventListener`、1 个 `Command`、1 个 `Tool`。
- Install task：`14`。
- Live plugin：`3.1.1`、`initialized`、`enabled=true`。
- Package SHA-256：`15c0a13b177e6ec45ca6560b6dd6d2d3246bafee34264fe9e113dd739630d6e9`。
- 通用会话注册表支持 KOOK、Telegram mock 和 `wechat` generic envelope，均不需要修改 PUBG Runtime。
