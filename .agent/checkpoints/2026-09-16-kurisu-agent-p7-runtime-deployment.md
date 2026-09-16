# Kurisu Agent P7 Runtime 部分发布 checkpoint

日期：2026-09-16（Asia/Shanghai）

状态：`PARTIAL_RUNTIME_DEPLOYED / PLUGIN_PENDING / BRIEFING_BLOCKED / L3_BLOCKED`

## 授权与范围

- 用户明确要求 `push并部署`。
- 已授权的外部动作：push 当前 `main`、构建/传输 Runtime immutable image、更新 Runtime CasaOS compose、使用 `--no-build` 重建 Runtime、执行健康检查和精确 Kurisu state 备份。
- 未执行：LangBot 插件安装、session rollout 切换、通知/Codex/写工具启用、Product Radar owner 切换、真实 Telegram/KOOK 消息、n8n 修改。

## Git 与构建

- push 前 `git fetch origin` 后 `origin/main...HEAD=0/7`，无远端分叉。
- source `5a015f1b87c7dcbd1c4df644a7c9071d0d923efc` 已推送至 `origin/main`。
- Host BuildKit 命令使用 `apps/agent-runtime/Dockerfile` 和空 proxy build args。
- immutable image：`local/pubg-query-engine-v3:git-5a015f1b87c7`。
- host image ID：`sha256:a67f287c01e5fd7a906a23511bba9a68e065ac0ccc6d0772c27a50526b354f63`。

## CasaOS 发布证据

- 目标：OrbStack machine `ubuntu`，CasaOS compose `/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml`。
- 使用 `scripts/deploy-agent-runtime.sh --apply --image local/pubg-query-engine-v3:git-5a015f1b87c7`。
- compose rollback：`/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260916-204409`。
- compose 使用 `docker compose up -d --no-build`；没有在 Ubuntu 重新 build。
- 部署后容器：`pubg-query-engine-v3`，image 为上述 immutable tag，`running/healthy`。
- live HTTP：`/healthz` 200 `ok`；`/homehub/health` 200 `healthy`；`/kurisu/status` 200，`toolCount=17`、rollout 为 `session_opt_in_legacy_default`；`/kurisu/tools` 返回结构化工具目录。
- `scripts/doctor.sh`：0 failure / 0 warning。
- LangBot 与 `langbot_plugin_runtime` 未重启，Product Radar/9router/n8n 等其他容器未改动。

## 状态与回滚

- 部署前 `/DATA/AppData/pubg-query-engine-v3/data/state.json.kurisu.sqlite` 不存在，未把 PUBG `state.json` 冒充 Kurisu 备份。
- 新 Runtime 初始化精确 state 后，主库/WAL/SHM 三个文件已收紧为 `0600`。
- 精确备份：`/Volumes/Avalon/backups/agent-monorepo/kurisu/20260916T124511Z/kurisu-state-20260916T124511Z.tar.gz`。
- `scripts/restore-kurisu-state.sh --dry-run` 验证归档恰含一个目标 SQLite entry。
- 回滚 Runtime：恢复上面的 compose backup，然后在 Ubuntu root 下执行 `docker compose up -d --no-build`；保留 Kurisu state/events，不删除审计，不重放不确定写操作。

## 验证

- Kurisu 定向测试：`50/50`。
- Product Radar：`53/53`，typecheck 通过。
- Runtime build、typecheck、LangBot plugin `4/4`、Python compile、R01 `9/9`、HTTP smoke、secret scan、`git diff --check` 通过。
- 完整 runtime suite 的既有 `review-v3-2.test.ts` 在无新增输出后有界终止，仍记录 `KNOWN_HANG / NOT_FULL_PASS`；没有据此声称全量通过。

## 未完成与解除条件

- `kurisu-gateway` 保持未安装。当前缺少合法 LangBot user/support-admin session 和管理员 Telegram DM 灰度对象；直接安装会让未迁移 Pipeline 看到新工具，违反 P7 single-consumer/灰度边界。
- 真实 native-agent platform L2/L3、旧 EventListener single-consumer 迁移和 briefing scheduler/producer 仍 `BLOCKED`。
- 只有补齐合法 session、灰度对象、producer 事实和迁移方案后，才可另行执行插件 preview/install、session rollout、真实平台验收和 Product Radar owner handoff。
