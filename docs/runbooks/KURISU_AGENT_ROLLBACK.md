# Kurisu Agent 回滚 Runbook

本文是 P6 Release 准备材料。当前开发 Goal 不执行任何生产 apply、插件安装、容器重启或真实平台消息；只有单独授权的 P7 才能按本文执行。

## 受控边界

- canonical runtime：OrbStack `ubuntu` 内的 CasaOS。
- Runtime compose：`/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml`。
- Runtime state：`/DATA/AppData/pubg-query-engine-v3/data/state.json.kurisu.sqlite`；它由 `scripts/backup-kurisu-state.sh` 单独备份，不能把仓库或网络共享盘当作运行时数据库。
- LangBot 插件：仓库内 `integrations/langbot/plugins/kurisu-gateway/`，包构建和回滚目录由 `scripts/deploy-langbot.sh` 管理；第三方 LangBot 本体不在仓库内修改。
- 配置模板：[`apps/agent-runtime/kurisu.env.example`](../../apps/agent-runtime/kurisu.env.example)。凭据、bot token、接收人和真实 recipient 只从仓库外恢复。
- 生产 owner 切换前必须确认旧 n8n sender 与 Runtime sender 不会同时运行；未发现的 briefing producer 不得用手工事件补齐。

## 回滚前的只读检查

```sh
node scripts/verify-kurisu-r01.mjs
./scripts/verify-kurisu-release-dry-run.sh
./scripts/backup-kurisu-state.sh --dry-run
```

记录当前 Git commit、激活的 immutable image、LangBot plugin 版本、compose/env backup 路径、Runtime health、通知 Worker 状态和在途 job。不要把 secret、完整消息或私人日志复制到仓库。

## 回滚顺序

1. 停止新入口继续接收迁移会话，暂停 Runtime notification Worker；保留 Kurisu SQLite、事件、delivery、审批和在途 job，不删除审计，不清空 Watch。
2. 让已有 lease 自然失效或由受控 executor 处理，标记无法核实的外部写为 `unknown`/`blocked`；不要因为回滚重新执行已经可能成功的写操作。
3. 将 Product Radar owner 恢复为 `local`，确认 central handoff 不再发送；只有确认 Runtime sender 已停止后，才可以恢复 legacy n8n workflow。n8n credential 必须在目标实例重新绑定。
4. 恢复上一个 compose backup 中的 Runtime image/config，然后在 Ubuntu root shell 执行 `docker compose up -d --no-build`。不得在 macOS host Docker 上重建 HomeLab 服务。
5. 如需恢复旧 LangBot plugin，使用对应的仓库包和 deploy backup，通过 LangBot API 显式 apply；不能直接在运行容器里编辑文件。旧 listener 的恢复范围必须与原权限一致，不能借回滚扩大权限。
6. 先验证 `/healthz`、`/homehub/health`、`/kurisu/status` 和 task/notification 状态，再由 P7 明确授权的管理员 DM 做最小真实入口验证。失败时继续保持 blocked，不把 HTTP 200 或进程 running 当作送达证明。

## 状态文件恢复

备份默认只预览；生产恢复必须提供准确归档并显式 `--apply`。脚本会校验归档只包含目标 SQLite 文件，并在替换前生成远端 timestamped rollback copy。

```sh
./scripts/backup-kurisu-state.sh --dry-run
./scripts/backup-kurisu-state.sh --apply
./scripts/restore-kurisu-state.sh --dry-run /external/backup/kurisu-state-<stamp>.tar.gz
./scripts/restore-kurisu-state.sh --apply /external/backup/kurisu-state-<stamp>.tar.gz
```

`restore-kurisu-state.sh --apply` 默认拒绝 Runtime 正在运行的情况；只有已评估一致性风险并明确记录时才可传 `--allow-running`。普通全量 AppData 归档仍使用现有 `scripts/backup.sh` / `scripts/restore.sh`，并遵守其停止服务和路径安全校验。

## 回滚完成条件

回滚记录必须区分 `CODE_COMPLETE`、`LOCAL_COMPLETE`、`DEPLOYED` 和 `PRODUCT_COMPLETE`。P6 最多达到本地完成并保留真实 LangBot session/旧 listener/briefing producer 缺口；只有 P7 的真实平台、部署和回滚证据齐全后，才允许报告 `PRODUCT_COMPLETE`。
