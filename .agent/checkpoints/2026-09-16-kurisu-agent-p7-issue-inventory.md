# Kurisu P7 当前问题盘点与处理结果

> 此为全会话 rollout 前的历史盘点；插件安装、管理员 Telegram 灰度和 legacy EventListener 迁移已在后续 checkpoint 完成。当前状态以 `2026-09-16-kurisu-agent-p7-global-nlu-rollout.md` 为准。

- 日期：2026-09-16（Asia/Shanghai）
- 当前 Git：`07efac7`，`main` 与 `origin/main` 已同步，工作区 clean。
- 当前 Runtime：`local/pubg-query-engine-v3:git-3e00275d8e70`，OrbStack `ubuntu`/CasaOS，`running/healthy`。

## 已解决

1. 默认 PUBG review 模板缺少逐人载具里程，导致 `review-v3-2.test.ts` runner 卡点。已补回载具距离/速度并完成全量 `181 passed / 0 failed / 1 skipped`。
2. Kurisu Runtime 的 `5310` 曾绑定所有 host interface，且三个 POST 入口没有 gateway 鉴权。已改为 `127.0.0.1`、外部 secret、无/错 secret 返回 `401`，live smoke 已核验。
3. SQLite 主库/WAL/SHM 的权限只靠当时手工修复，未来重建可能回退。已将 `0600` 保证写入 `KurisuStore`，新 image 重建后 live 核验通过。
4. Host BuildKit 继承了不可用的 `127.0.0.1:7897` proxy，首次构建失败。已通过 `--no-proxy` 重试成功，未留下半成品 Compose 变更。
5. 状态文档残留旧的 runner hang 和旧 image 描述。已修正 `.agent/state.md`，以当前全量测试和 live image 为准。

## 当前阻塞

1. 缺少合法 LangBot user/support-admin session token，因此真实 native-agent WebSocket/platform L2/L3 不能验收；管理 API key 不能替代用户会话身份。
2. `kurisu-gateway` 尚未安装，LangBot plugin runtime 还未挂载共享 gateway secret；在没有灰度会话前安装会把工具暴露给未迁移会话。
3. PUBG/Product Radar 旧 EventListener 仍在共享 Pipeline，single-consumer/session rollout 迁移范围尚未确认；不能直接停用旧 listener。
4. briefing 的真实 scheduler/生成/投递 producer 尚未在仓库或 live inventory 中找到，严格保持 `BLOCKED_UNSUPPORTED`，不生成空日报或伪造成功事件。
5. 没有管理员 Telegram DM 灰度对象，因此真实 Telegram/KOOK 入站、按钮、审批、通知补发和回滚尚未做平台 smoke；没有向群聊发测试消息。
6. 通知、Codex、写工具和 Product Radar central owner 仍关闭/未切换，这是等待 P7 灰度前置条件，不是 Runtime 健康故障。

## 本次验证

- `scripts/doctor.sh`：`0 failure(s), 0 warning(s)`。
- `scripts/deploy-langbot.sh --dry-run --plugin kurisu-gateway --skip-runtime-check`：package dry-run 通过，无安装/重启/生产写入。
- `pnpm check:secrets`：通过。

## 下一步边界

取得合法 session、确认 single-consumer 迁移与 briefing producer、准备管理员 Telegram DM 灰度对象后，才进入 LangBot plugin secret 挂载、插件安装、session rollout 和真实平台验收；这些步骤必须保留 rollback checkpoint。
