# Product Radar LangBot model selector（IMPLEMENTED / PENDING DEPLOYMENT）

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

## 待完成

- 提交并 push source。
- 安装 LangBot Product Radar plugin `0.5.7`。
- 通过 LangBot plugin config API 选择当前 `arthur-combo` 对应 UUID，并验证 intent/vision 实际调用。
