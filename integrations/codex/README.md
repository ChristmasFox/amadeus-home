# Codex Global Completion Notification

这是 Codex 全局 `notify` hook 的 Git source。安装后脚本会复制到用户级
`CODEX_HOME/bin`，因此 Codex 在 `agent-monorepo`、`project-a` 或任意其他目录执行时
都使用同一份完成通知桥接，不依赖当前 repository cwd。

## Global installation

```sh
./scripts/install-codex-notify.sh --dry-run
./scripts/install-codex-notify.sh --apply
```

当前机器的全局配置为：

```toml
# ~/.codex/config.toml
notify = ["zsh", "/Users/blacksidev/.codex/bin/codex-notify.sh"]
```

真实脚本路径是 `/Users/blacksidev/.codex/bin/codex-notify.sh`，其内容由
`integrations/codex/codex-notify.sh` 安装，不能改成项目内相对路径。安装脚本只更新
`~/.codex/config.toml` 的 root-level `notify`，不会创建项目级配置，也不会写入 secret。

## Payload and fail-open boundary

当前 Codex legacy notify hook 将 JSON 作为 argv[1] 传给 command，V1 payload 使用
`type: agent-turn-complete`、`thread-id`、`turn-id`、`cwd`、`client`、`input-messages` 和
`last-assistant-message`。本地 script 同时兼容 camelCase/snake_case 和 stdin，归一化为：

```json
{
  "event": "agent-turn-complete",
  "threadId": "...",
  "turnId": "...",
  "cwd": "/absolute/project/path",
  "projectName": "project-name",
  "lastAssistantMessage": "...",
  "timestamp": "..."
}
```

只有 `agent-turn-complete` 会 POST；tool/intermediate event 会被忽略。项目名始终从 cwd
最后路径段安全解析，payload 中的 recipient/chat/channel 字段不会被转发为接收人。脚本
使用 curl `--connect-timeout 2 --max-time 5`，丢弃 response body，网络失败、secret 缺失、
解析失败都只写不含 payload/secret 的日志并返回 0，不影响 Codex turn。

## External runtime configuration

- webhook：`CODEX_NOTIFY_URL`，默认 `http://127.0.0.1:5679/webhook/codex-complete`；
- shared secret：用户级 `~/.codex/secrets/codex-notify-secret`，权限 0600；
- n8n secret/recipient values：只在 OrbStack Ubuntu 的 `/DATA/AppData` 和 n8n global
  variables 中恢复，Git 不保存值；
- `scripts/provision-codex-notify-secret.sh --apply` 负责建立/同步 shared secret；
- `scripts/sync-n8n-admin-identities.sh --apply` 负责从外部 admin identity env 和 secret
  file 同步 `TELEGRAM_ADMIN_USER_ID`、`KOOK_ADMIN_USER_ID`、`CODEX_NOTIFY_SECRET`。

## n8n flow

Git workflow：`integrations/n8n/workflows/codex-completion-notification.workflow.json`，
名称 `Codex Completion Notification`。生产 ID 为
`codex-completion-notification-20260906`，Webhook path 是 `codex-complete`。
流程为：

```text
Codex Completion Webhook
→ Validate Completion
→ Valid Completion?
→ Read Idempotency Key
→ Resolve Idempotency
→ Already Seen?
→ Claim Completion
→ Format Notification
→ Send Telegram DM
→ Send KOOK DM
→ Record Delivery
→ Respond Accepted
```

`Read/Claim Idempotency` 使用外部 n8n Data Table
`codex-completion-idempotency-20260906`，`eventKey` 唯一索引为
`threadId:turnId`。重复请求在平台 sender 前返回 `duplicate: true`，最多发送一次。

Telegram/KOOK sender 都调用 LangBot `/api/v1/platform/bots/<bot_uuid>/send_message`，并
固定使用 `target_type: person`。目标 ID 只从 n8n global variables
`TELEGRAM_ADMIN_USER_ID` / `KOOK_ADMIN_USER_ID` 读取；不读取当前 webhook chat、最近会话、
payload recipient 或 channel。Telegram 和 KOOK HTTP nodes 均 `continueOnFail: true`，最终
记录分别为 `telegram: {status: sent|failed}`、`kook: {status: sent|failed}`。

部署/导入必须使用显式 apply：

```sh
./scripts/create-n8n-codex-idempotency-table.sh --apply
./scripts/deploy-n8n-workflow.sh \
  --workflow integrations/n8n/workflows/codex-completion-notification.workflow.json \
  --id codex-completion-notification-20260906 --apply
```

n8n API credential `LangBot API` 只通过目标实例重新绑定，workflow JSON 不包含 credential
secret。Webhook 仅在 HomeLab n8n 上提供，并要求 shared secret。

## Verification

```sh
./scripts/smoke-codex-notify.sh
./scripts/test-codex-notification-workflow.sh
./scripts/smoke-codex-notification-runtime.sh
```

最后一个 smoke 会实际向两个固定 Admin 私聊发送一条带有 smoke 标记的通知，再重复提交
相同 `threadId + turnId`，检查双平台 `sent` 和重复请求不再发送。不要把 smoke payload 中的
真实 ID、token 或 secret 写入 Git。
