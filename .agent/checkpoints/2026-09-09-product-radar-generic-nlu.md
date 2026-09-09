# Product Radar Generic Natural Language Intent Parsing

日期：2026-09-09（Asia/Shanghai）
状态：DEPLOYED / VERIFIED（LangBot plugin 已安装；人工平台 smoke 未执行）

## 目标与边界

- 对照 PUBG V3 已工作的 normalized message、intent/entity、context、deterministic domain 链路，在 Product Radar 内实现同样的架构边界。
- Product Radar 不导入 PUBG-specific parser/intent；LangBot listener 只负责 normalized input、Luna command、context ownership 和 API adapter。
- 本阶段不创建测试 Watch，也不发送真实 Telegram/KOOK 消息；人工平台入站 smoke 作为后续用户侧验证。

## 源码结果

- `components/platform/normalized.py` 提供平台无关 `NormalizedBotMessage`、附件/callback 归一化和 `product_radar:platform:chat:sender` context key；Telegram raw message 的 sender/chat 优先级已覆盖历史 group sender_id 异常。
- `components/intent_planner.py` 定义七种 Product Radar intent、三种 watchType、实体/约束字段、GPT-5.6 Luna structured JSON prompt、clarification 和同一次 multimodal TargetProfile 输出。
- `components/context.py` 以精确 ownership key 保存 active Watch、pending proposal 和最近 command；无全局/singleton context fallback。
- `components/command_adapter.py` 把 structured command 转为 Seller/Product/Similarity payload；Similarity TargetProfile 使用 API 顶层结构化字段，避免 Core 再次自然语言/Vision extraction。
- `components/listeners/product_radar.py` 已移除 legacy keyword/URL parser 和第二次 Vision 调用；图片-only、图片问答和非 Product Radar 语义不会创建 Watch。
- manifest 版本更新为 `0.4.0`；legacy `components/intent.py` 仅保留兼容调用，不再作为 live router。

## 验证证据

- `find integrations/langbot/plugins/product-radar -name '*.py' ... python3 -m py_compile`：通过。
- `PYTHONPATH=integrations/langbot/plugins/product-radar python3 -m unittest discover -s integrations/langbot/plugins/product-radar/tests -p 'test*.py' -v`：16/16 通过。
- `pnpm workflow:plan`：`FAST / LANGBOT_PLUGIN`，Docker build forbidden，未要求 runtime image。
- `pnpm check:secrets`：通过。
- `./scripts/deploy-langbot.sh --plugin product-radar --dry-run --skip-runtime-check`：package zip 校验通过，manifest `0.4.0`，未安装/未改运行时。
- `git diff --check`：通过。

## 部署与 live 验证

- Git commit `9888e3c58ca5b8cd4fb37b202fb4abc0a3f70bf2` 已由 `main` push 到 `origin/main`。
- `./scripts/deploy-langbot.sh --plugin product-radar --apply --api-key-file <external-file>` 完成；LangBot plugin task `83` 达到 `INSTALL_READY`，manifest `0.4.0`，package SHA-256 为 `7ed45be07f37c9911b50c0bdac8087bb883de0876a1c20108b4826047e34cfc9`，rollback dir 为 `.backups/langbot/20260909-111116`。
- canonical OrbStack `ubuntu`：`product-radar` 为 `healthy/running`，`langbot` 与 `langbot_plugin_runtime` 为 running，`changedetection` 为 `healthy/running`。
- Product Radar `/health` 返回 `status=ok`；`GET /api/watches` 返回既有 3 个 Watch（1 Product、2 Similarity），未创建或修改测试 Watch。
- `scripts/doctor.sh`：0 failure / 0 warning；本轮未执行 Docker build、CasaOS Compose restart 或真实平台消息。

## 后续

人工平台 smoke 记录在 `.agent/tasks/2026-09-09-product-radar-generic-nlu-live-smoke.md`；需用户在目标 Telegram/KOOK 会话中验证自然表达、follow-up 和群成员 context 隔离。
