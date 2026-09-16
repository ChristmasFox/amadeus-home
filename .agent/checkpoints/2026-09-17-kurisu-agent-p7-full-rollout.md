# Kurisu Agent P7 全量发布阶段 checkpoint

日期：2026-09-17（Asia/Shanghai）  
状态：`DEPLOYED / GLOBAL_NLU_ROLLOUT_DEPLOYED / MEDIA_TOOLS_DEPLOYED / L4_PLATFORM_PENDING`

## 本阶段完成

- 修复 LangBot `Session` 平台身份缺失问题：Kurisu Gateway 通过 `bot_uuid` 读取 LangBot bot 元数据，只接受 `telegram`/`kook`，缺失或不支持时 fail closed；不再把真实请求默认成 `test`。源码提交 `38af693`，`kurisu-gateway@0.1.1` 已安装 ready。
- 旧 PUBG、媒体整理和 NAS Native-Agent 直连 Tool 已从 manifest 移除；`pubg-stats@3.3.4`、`organize-emby@0.2.2`、`macos-nas-control@0.1.6` 已安装 ready。`macos-nas-control` 的空组件 manifest 曾导致 worker 崩溃，已改为 `components: {}`，修复提交 `c4f2e65`。
- Runtime 新增结构化 `kurisu.media.scan`/`preview`/`move` 边界；执行流程包含 allowlist、确定性 plan、preview、执行后 verify，并移除空下载目录但不递归删除残留。媒体代码、Compose 挂载和插件 manifest 清理提交 `015df8f`。
- 已启用生产 `native_agent_global`、通知、Codex、写工具和 Product Radar central owner；源码/生产配置将媒体挂载限定为 `/Volumes/Avalon/downloads`、`media/movies`、`media/tv`、`backups/media-organizer`，但当前 Avalon 未挂载，live Compose 暂不加载这四个 bind mount。

## 生产证据

- Git：`main` 与 `origin/main` 同步，当前 HEAD `c4f2e65eea2f636615bdaaa479c183caa61724e0`。
- Runtime：OrbStack `ubuntu` CasaOS 当前 `local/pubg-query-engine-v3:git-015df8f`，image ID `sha256:c97227ff480df5951ab0bb0ca01be41ba47cb336f85cb8419c247cd7bf481278`，容器 `running/healthy`。
- Runtime 回滚副本：`/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260917-002049`（部署前 compose）；生产开关/挂载变更另保留 `...20260917-002101`。
- LangBot 插件安装回滚目录：`.backups/langbot/20260917-002127`（批量发布前包）、`.backups/langbot/20260917-002443`（NAS 修复前包）。
- LangBot DB 只读核验：五个 local plugin 均 `enabled=1`；当前版本分别为 Gateway `0.1.1`、PUBG `3.3.4`、Product Radar `0.6.0`、Organize Emby `0.2.2`、NAS `0.1.6`。Gateway 是唯一 Tool；legacy plugin 不再暴露自然语言 EventListener/Tool，显式 Command 保留。
- Runtime：`/healthz`、`/homehub/health` 返回 200；Kurisu `contractVersion=kurisu.v1`、`rollout=native_agent_global`、29 tools；Product Radar owner 为 `central`。
- 真实只读线上 smoke：`scripts/doctor.sh` 为 0 failure / 0 warning；`smoke-kurisu-http.sh` 通过；`smoke-homehub-docker.sh` 通过，受限 Docker API 列出 10 个 allowlisted service，HomeHub `/status` 为 9 healthy、3 degraded、1 down、0 unknown，取得真实 macOS host metrics。

## 验证记录

- 受影响 Runtime 定向测试：25/25 pass；agent-runtime typecheck pass。
- `node scripts/verify-kurisu-global-rollout.mjs`：`KURISU_GLOBAL_ROLLOUT_PASS`。
- `node scripts/verify-kurisu-r01.mjs`：`R01_PASS`；`scripts/verify-kurisu-release-dry-run.sh`：`R02_PASS`；Kurisu state backup dry-run pass。
- `git diff --check`、`pnpm check:secrets` pass。
- 未重复运行无关的全量测试；此前已记录的 agent-runtime 全量结果为 `181 passed / 0 failed / 1 skipped`。

## 未完成与解除条件

- 本 checkpoint 之后 LangBot monitoring DB 尚无新的真实 Telegram/KOOK 入站，因此 R03/R04 的引用、图片、按钮/审批、必要群聊和真实 Gateway 平台身份链路仍为 `PENDING/BLOCKED`。
- R05 可恢复回滚尚未执行成功。已实际暂停 `langbot`、`langbot_plugin_runtime` 和 Runtime，并尝试切换上一版 `local/pubg-query-engine-v3:git-e6dba61a5fdb`；因宿主机当前没有 `/Volumes/Avalon`，Docker 创建媒体 bind mount 返回 `mkdir /Volumes/Avalon: permission denied`，未执行任何写操作重放。当前已用无媒体挂载 Compose 恢复 `local/pubg-query-engine-v3:git-015df8f`，并重新启动 LangBot/plugin runtime。
- R05 后续解除条件：重新挂载真实 Avalon 磁盘后，使用 `/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260917-062321` 恢复生产 Compose，验证媒体挂载和健康，再完成旧版本切换/恢复闭环。

## R05 核心回滚补充结果

- 在无媒体挂载的核心恢复态再次执行旧 Runtime/插件切换：`local/pubg-query-engine-v3:git-e6dba61a5fdb` health `healthy`，`/healthz` 与 `/homehub/health` 通过；旧 Gateway `0.1.0`、PUBG `3.3.3`、Organize `0.2.1`、NAS `0.1.4` 均 `INSTALL_READY`，旧 Tool 清单恢复，doctor 为 0 failure。
- 随后恢复当前插件（Gateway `0.1.1`、PUBG `3.3.4`、Product Radar `0.6.0`、Organize `0.2.2`、NAS `0.1.6`）和 Runtime `local/pubg-query-engine-v3:git-015df8f`；当前 health、doctor、Kurisu HTTP smoke、HomeHub Docker smoke 均通过。
- 因 Avalon 未连接，R05 目前只能判定为“核心入口/镜像/插件回滚通过，媒体挂载场景 blocked”，不是完整 R05/PRODUCT_COMPLETE 证据。
- `scripts/deploy-kurisu-production-features.sh` 已增加 Avalon 四个媒体目录的 preflight：磁盘缺失时在任何 secret/env/Compose mutation 前 fail closed；当前 `--apply` 已验证返回明确缺失路径。
- 不得用 provider/fake trace、HTTP 200、容器健康或插件 `INSTALL_READY` 替代真实平台入站/外部执行/最终送达证据；在上述证据补齐前不得标记 `PRODUCT_COMPLETE`。
