# Kurisu P7 R05 媒体挂载回滚与恢复 checkpoint

日期：2026-09-17（Asia/Shanghai）
状态：`R05_MEDIA_ROLLBACK_VERIFIED / CURRENT_PRODUCTION_RESTORED / L4_PLATFORM_PENDING`

## 范围

在真实 Avalon 已重新挂载后，完成一次包含媒体 bind mount 的旧版本回滚，再恢复当前生产版本。回滚期间暂停 LangBot、plugin runtime、Product Radar、changedetection 和 Runtime，不发送消息、不重放业务写操作。

## 回滚前快照

- 当前生产 Runtime：`local/pubg-query-engine-v3:git-015df8f`。
- 回滚前 Runtime Compose 快照：`/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-r05-full-pre.20260917T004952Z`。
- Kurisu state 精确外部归档：`/Volumes/Avalon/backups/agent-monorepo/kurisu/20260917T004952Z/kurisu-state-20260917T004952Z.tar.gz`。
- 回滚前 Runtime 容器确认存在 4 个 `/Volumes/Avalon` bind mount；四个目录均为真实目录：downloads、media/movies、media/tv、backups/media-organizer。

## 旧版本回滚证据

- Runtime 切换到 `local/pubg-query-engine-v3:git-e6dba61a5fdb`，容器 `healthy`。
- 旧版本下 `/healthz`、`/homehub/health`、HomeHub Docker smoke 和 `scripts/doctor.sh` 均通过；doctor 为 `0 failure / 0 warning`。
- 旧版本下四个 Avalon bind mount 仍存在并可访问。
- LangBot API 真实安装并达到 ready：Gateway `0.1.0`、PUBG `3.3.3`、Product Radar `0.6.0`、Organize Emby `0.2.1`、NAS `0.1.4`；旧组件清单恢复了预期的旧 Tool 暴露。
- 回滚期间没有执行媒体 move、HomeHub action、Radar mutation、Codex mutation 或通知重放。

## 当前版本恢复证据

- Runtime 已恢复到 `local/pubg-query-engine-v3:git-015df8f`，恢复 Compose 备份：`/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260917-085336`。
- 当前 LangBot API 真实安装并达到 ready：`kurisu-gateway@0.1.1`、`pubg-stats@3.3.4`、`product-radar@0.6.0`、`organize-emby@0.2.2`、`macos-nas-control@0.1.6`；当前组件清单为 Kurisu 唯一 Tool，旧自然语言 EventListener/Tool 不再暴露，NAS 为无组件 manifest。
- 当前 Runtime 重新确认 `native_agent_global`、通知、Codex、写工具、Radar central owner 已配置；四个媒体 bind mount 存在。
- `kurisu.media.scan` 真实 Runtime structured smoke 返回 `status=ok`，证据源为 `media.organizer`；四个挂载目录 direct check 通过。
- 恢复后 `scripts/doctor.sh`、`scripts/smoke-kurisu-http.sh`、`scripts/smoke-homehub-docker.sh --machine ubuntu`、`node scripts/verify-kurisu-global-rollout.mjs`、`node scripts/verify-kurisu-r01.mjs`、`scripts/verify-kurisu-release-dry-run.sh`、`pnpm check:secrets` 和 `git diff --check` 均通过。

## 仍未完成

- 部署后尚无新的真实 Telegram/KOOK 用户入站记录，R03/R04 的引用、图片、按钮/审批、必要群聊、真实平台身份链路和最终送达仍为 `PENDING`。
- 不以 health、插件 ready、provider/fake trace 或结构化 HTTP smoke 替代真实平台 L4 证据；在真实平台证据补齐前不得标记 `PRODUCT_COMPLETE`。
