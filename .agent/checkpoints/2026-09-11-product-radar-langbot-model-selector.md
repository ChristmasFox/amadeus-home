# Product Radar LangBot model selector（DEPLOYED / VERIFIED）

日期：2026-09-11（Asia/Shanghai）

## 变更

- Product Radar manifest 新增 LangBot 原生 `llm-model-selector` 字段 `model_uuid`。
- intent 与 multimodal TargetProfile 共用该选择；旧的 `intent_model_uuid`、`vision_model_uuid` 和环境变量兼容。
- 移除 Product Radar 源码中的 Luna UUID 和 Luna provider 默认值。
- 配置 UUID 不在 LangBot 模型列表中时 fail closed；未配置时使用 LangBot 返回的首个可用模型。

## 本地证据

- Product Radar LangBot plugin tests：38/38。
- Python compile：通过。
- `pnpm workflow:plan`：FAST / LANGBOT_PLUGIN，未要求 Docker build。
- `./scripts/deploy-langbot.sh --dry-run --plugin product-radar --skip-runtime-check`：package `0.5.7` 构建和归档检查通过。
- `pnpm check:secrets`、`git diff --check`：通过。

## 部署证据

- source `5a213ff` 已 push 到 `origin/main`。
- LangBot Product Radar plugin `0.5.7` 已安装并达到 `INSTALL_READY`，task `31`；package SHA-256：`d889683b2adce0a500c5c7e2f42687ea9d9393d75450af419d9be0db06c6cd8d`。
- LangBot 插件 manifest 已暴露 `model_uuid` / `llm-model-selector`；线上配置读取为 `model_uuid`，对应 `arthur-combo` UUID `4d608fdb-126b-42cd-a8a5-be1349629713`，模型 provider 为 `9Router`。
- LangBot `/api/v1/plugins` 返回 `local/product-radar@0.5.7`；Product Radar `/health` 返回 `status=ok`；`scripts/doctor.sh` 为 0 failure / 0 warning。
- 回滚包：`.backups/langbot/20260911-235421/`。

## 边界说明

- 本轮验证的是 LangBot selector、插件安装、运行时配置读取和服务健康；没有代发真实 Telegram 消息。
- Product Radar Core、Watch 数据、LangBot 主体和 FashionSigLIP worker 均未修改。
