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

## Runtime-owned payload and fail-open boundary

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
解析失败都只写不含 payload/secret 的日志并返回 0，不影响 Codex turn。默认目标是
Runtime `/kurisu/notifications/events`；Runtime 先持久化 event/delivery，再由 Worker 发送到已配置
的 Telegram/KOOK。Codex legacy hook 没有关联 durable task 时固定使用“本轮结束，结果待核实”，不推断
工程任务、测试或部署成功。

Runtime 不在线或 curl 不可用时，归一化 JSON 以 payload hash 写入本地安全 spool（目录权限 0700、文件
权限受 umask 077 保护）；相同 payload 会覆盖同名文件而不会无限增殖。补发默认只 dry-run：

```sh
./scripts/drain-codex-notification-spool.sh --dry-run
./scripts/drain-codex-notification-spool.sh --apply
```

成功补发的 spool 文件移动到同目录 `processed/`，便于审计和恢复；`--apply` 需要外部 secret。

## External runtime configuration

- webhook：`CODEX_NOTIFY_URL`，默认 `http://127.0.0.1:5310/kurisu/notifications/events`；
- shared secret：用户级 `~/.codex/secrets/codex-notify-secret`，权限 0600；
- spool：`CODEX_NOTIFY_SPOOL_DIR`，默认 `~/.codex/spool/kurisu-notifications`；
- Runtime secret/recipient values：只在外部运行时配置恢复，Git 不保存值；
- `scripts/provision-codex-notify-secret.sh --apply` 负责建立/同步 shared secret；
- 旧 n8n sender 的 secret/recipient values 仍只在外部恢复；当前 central owner 不读取 Codex payload
  中的 recipient/channel。

## Legacy n8n rollback flow

Git workflow `integrations/n8n/workflows/codex-completion-notification.workflow.json` 保留为
legacy rollback source。它的生产 ID 是 `codex-completion-notification-20260906`、Webhook path 是
`codex-complete`；当前 Codex hook 默认不再指向该路径。切换时不能让它和 Runtime sender 同时激活。
历史流程为：

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

若 P7 回滚需要恢复该流程，部署/导入必须使用显式 apply，并先停用 Runtime sender：

```sh
./scripts/create-n8n-codex-idempotency-table.sh --apply
./scripts/deploy-n8n-workflow.sh \
  --workflow integrations/n8n/workflows/codex-completion-notification.workflow.json \
  --id codex-completion-notification-20260906 --apply
```

n8n API credential `LangBot API` 只通过目标实例重新绑定，workflow JSON 不包含 credential
secret。Webhook 仅在 HomeLab n8n 上提供，并要求 shared secret。

## Local verification

```sh
./scripts/smoke-codex-notify.sh
./scripts/test-codex-notification-workflow.sh
```

`smoke-codex-notify.sh` 只使用本机 fake HTTP server，验证归一化、过滤、脱敏、fail-open 和 spool；
`smoke-codex-notification-runtime.sh` 属于 P7 真实平台验收，会向固定管理员私聊发送消息，本 Goal
不执行。
