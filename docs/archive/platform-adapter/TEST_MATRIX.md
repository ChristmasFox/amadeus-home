# Platform Adapter Test Matrix

## Automated Tests

| Case | Expected | Status |
| --- | --- | --- |
| KOOK group normalize | `kook`, `group`, sender/chat 分离 | PASS |
| KOOK private normalize | `private` | PASS |
| Telegram private mock | `telegram`, `private` | PASS |
| Telegram group mock | `telegram`, `group`, sender/chat 分离 | PASS |
| KOOK/Telegram same query | domain query 等价 | PASS |
| Same sender follow-up | 继承 selector/ResultSet | PASS |
| Different sender follow-up | 不继承上下文 | PASS |
| Cross-platform context | 默认不共享 | PASS |
| Platform response | text messages + metadata | PASS |
| Message chunking | 不在段落边界前优先切割 | PASS |
| Python KookAdapter fixture | 无 raw 字段 | PASS |
| Python TelegramAdapter fixture | 无 Telegram 网络 | PASS |

## Existing V3 Regression

```text
pnpm run typecheck  PASS
pnpm test           44/44 PASS
python3 -m py_compile ...  PASS
python3 -m unittest discover -s tests -p 'test_*.py'  4/4 PASS
```

## Required Live Checks

| Check | Status | Note |
| --- | --- | --- |
| Query Engine health | PASS | `local/pubg-query-engine-v3:3.1.0-adapter`，`healthy` |
| n8n Data Gateway active | PASS | 现有 live V3 已确认 |
| Live plugin status | PASS | `local/pubg-stats` `3.1.1`，`initialized`，`enabled=true` |
| KOOK API connectivity | PASS | `user/me` 与 `gateway/index` 可用 |
| Real KOOK human inbound message | BLOCKED | 当前环境没有可用的非 Bot 成员消息 |
| KOOK desktop/mobile visual check | BLOCKED | 依赖上一项真实入站消息 |
| Telegram real transport configuration | PASS | LangBot Bot 已启用；容器内 `getMe` 成功；未暴露 Token |
| Telegram real inbound/reply | PASS | 私聊、群聊均收到真实消息并产生一次对应回复；未调用 `getUpdates`，避免与 LangBot polling 抢占 |
| Telegram transient startup timeout recovery | PASS | 显式超时、启动退避重试和 polling bootstrap 重试已部署；重启后稳定观察无新 timeout |
| Telegram transient outbound send retry | PASS | 模拟 `TimedOut` 后第二次发送成功；live image 已部署三次有限重试 |
| Telegram polling watchdog | PASS | 轮询任务 liveness 检查、异常回调和自动恢复已部署；重启后待处理更新归零 |
| WeChat transport | NOT RUN | 本 Goal 只做契约准备 |

## Static Dependency Checks

- PUBG TypeScript source imports platform core contracts only; no PUBG module imports KOOK/Telegram adapter.
- Python PUBG client receives `NormalizedBotMessage`; LangBot event field access is confined to `components/platform/kook.py`，命令/Tool 通过通用 `components/platform/registry.py`。
- Runtime request context uses `chatType`、`chatId`、`platformUserId`，不再以 `launcher_*` 作为领域上下文主键。
- Generic session fallback accepts `wechat` without a WeChat transport or network connection。
