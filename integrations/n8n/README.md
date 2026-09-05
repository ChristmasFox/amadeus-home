# n8n Integration

## Source of truth

integrations/n8n/workflows/ 中的 JSON 是 workflow 的 Git source of truth：

- pubg-data-gateway-v3.workflow.json：V3 查询 data gateway；
- pubg-sync-matches-v3.workflow.json：V3 同步；
- legacy/pubg-query-gateway-v2.workflow.json：V2 查询兼容；
- legacy/pubg-sync-matches-v2.workflow.json：V2 同步兼容；
- pubg-daily-stats.workflow.json：历史每日战绩 workflow；
- organize-workflows.json：媒体整理 workflow；
- pubg-api-credential.placeholder.json：credential 结构 placeholder，不含真实 key。

## 导入流程

1. 先启动目标 n8n，并在外部恢复 n8n data。
2. 在 Credentials 页面重新创建 PUBG API、媒体整理或其他所需 credentials。
3. 导入对应 workflow JSON，重新选择 credential，检查 webhook path、Data Table、
   timezone、base URL 和 active 状态。
4. 使用测试请求验证 data gateway，再启用同步 workflow。
5. 把目标实例的 workflow ID / active 状态和验证结果写回 docs/PROJECT_STATE.md。

workflow JSON 不应包含 API key、Authorization header 的真实值、n8n credential
导出值或用户数据。发现 credential export 时先删除敏感值，再提交。

## 数据与备份

n8n 的工作流定义在 Git；执行记录、用户设置、credential 加密数据、二进制文件和
Data Table 依赖目标实例的 /DATA/AppData/n8n。sandbox 的 TLS、runner data 和
Docker data 位于 /DATA/AppData/n8n-sandbox。使用 scripts/backup.sh 备份这些
AppData，使用 scripts/restore.sh 在停机后恢复。

默认 n8n compose 使用 5679 作为 host port，容器内仍为 5678。实际域名、协议和
Cloudflare ingress 必须由新机器的 env/template 决定，不能硬编码当前 Ubuntu IP。

## 版本化检查

提交前运行：

    find integrations/n8n/workflows -type f -name '*.json' -print
    pnpm check:secrets

导入后不要把 n8n 生成的 credentials 或整个 data 目录复制进 Git。
