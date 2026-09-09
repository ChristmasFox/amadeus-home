# Product Radar Generic Natural Language Intent Parsing

日期：2026-09-09（Asia/Shanghai）
状态：SOURCE COMPLETE / TARGETED VERIFIED

## 目标与边界

- 对照 PUBG V3 已工作的 normalized message、intent/entity、context、deterministic domain 链路，在 Product Radar 内实现同样的架构边界。
- Product Radar 不导入 PUBG-specific parser/intent；LangBot listener 只负责 normalized input、Luna command、context ownership 和 API adapter。
- 本阶段不执行 LangBot API apply、Docker/CasaOS 操作或真实 Telegram/KOOK 消息。

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

## 后续

生产安装与人工平台 smoke 记录在 `.agent/tasks/2026-09-09-product-radar-generic-nlu-live-smoke.md`；只有明确 release intent 后才执行 `--apply`。
