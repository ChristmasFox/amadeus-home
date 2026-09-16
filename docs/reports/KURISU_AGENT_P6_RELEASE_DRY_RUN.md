# Kurisu P6 Release dry-run

验证日期：2026-09-16（Asia/Shanghai）
范围：本机仓库与只读 OrbStack inventory；没有生产 apply、插件安装、容器重启或 n8n 数据库写入。

## 结果

R02_PASS。组合 runner 为 scripts/verify-kurisu-release-dry-run.sh，内部执行：

    scripts/deploy-agent-runtime.sh --dry-run
    scripts/deploy-langbot.sh --dry-run --plugin kurisu-gateway
    scripts/backup-kurisu-state.sh --dry-run
    scripts/restore-kurisu-state.sh --dry-run <安全临时归档>

实际列出的目标边界：

- Runtime：CasaOS compose /var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml，dry-run 中 BUILD=disabled、IMAGE=unchanged-compose-image；若后续显式 apply，重建命令固定为 docker compose up -d --no-build。
- LangBot：仅 local/kurisu-gateway@0.1.0 的仓库包预览；当前 dry-run 观察到 langbot 与 langbot_plugin_runtime running，但没有 LangBot API installation、image build 或 compose change。
- 配置：apps/agent-runtime/kurisu.env.example；真实 token、secret、recipient 和 Codex project path 不在 Git。
- 状态备份：只针对 /DATA/AppData/pubg-query-engine-v3/data/state.json.kurisu.sqlite，默认输出到仓库外；恢复预览要求归档只含该精确文件，并在 apply 前备份当前远端文件。

## 反向检查

- MUTATION=none：没有生产容器重启、镜像构建/传输、LangBot 安装、n8n DB 写入、Runtime Kurisu 状态写入或真实平台消息。
- 旧 n8n completion workflow 仍只是 rollback source；Product Radar central owner 仍为显式 P7 才能切换的 opt-in。
- R02 是发布准备证据，不等于已部署、已送达或 PRODUCT_COMPLETE。
