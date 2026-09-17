# Migration Inventory

更新时间：2026-09-17（Asia/Shanghai）

## 当前源代码

- `plugins/pubg`：唯一本项目 OpenClaw 业务 plugin。
- `packages/pubg-domain`：独立 PUBG Domain、SQLite 和一次性迁移器。
- `integrations/openclaw`：OpenClaw 配置/workspace 模板。
- `infra/docker/casaos/openclaw`：CasaOS 部署模板。
- `apps/product-radar`：独立、非 PUBG 应用。
- `integrations/langbot`、`integrations/n8n`：独立非 PUBG 资产。

旧 PUBG Runtime、Mastra facade、PUBG LangBot plugins、PUBG n8n workflows、旧
generators、旧通知桥和 V2 compatibility source 已从当前树删除；Git 历史仍可审计，
不作为运行时 fallback。

## 仓库外数据

迁移前的 LangBot DB、n8n SQLite、旧 state/features、PUBG API key 和 Telegram identity
只存在 OrbStack `ubuntu` 的 AppData/secrets。一次性切换脚本会在
`/DATA/AppData/openclaw/backups/<id>` 生成 checkpoint；其中数据库和配置备份不提交。

## Secrets

禁止提交 Bot token、API key、密码、`.env`、证书、n8n credentials 和真实业务数据。
提交前运行 `pnpm check:secrets`。
