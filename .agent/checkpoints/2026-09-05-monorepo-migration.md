# Checkpoint: Monorepo Migration

日期：2026-09-05（Asia/Shanghai）

## 已完成

- 独立仓库目录：/Users/blacksidev/agent-monorepo；
- Apps、packages、integrations、infra、scripts、docs、.agent 目录已建立；
- Mastra/PUBG V3、Telemetry、Platform Adapter、WhatsApp、V2 domain 已归档；
- LangBot 自定义插件和 patch 已归档，第三方 LangBot 本体未复制；
- n8n workflow JSON 已归档，credentials 仍由目标实例管理；
- 真实 aria2 / 9router secrets 未复制，只保留模板；
- CasaOS/OrbStack canonical runtime、Mac mini 恢复路径已写入文档；
- restore.sh 语法已修复，脚本已设置可执行权限。

## 安全边界

提交前必须运行 pnpm check:secrets，并检查 git diff --cached --name-only。
不要把 .env、secret archive、数据库 volume 或构建出来的 .lbpkg 加入 Git。

## 本 checkpoint 后的验证

1. 根 pnpm-lock.yaml 已生成，workspace install 成功；
2. typecheck、build、83 个 runtime tests、30 个 legacy-v2 tests 已通过；
3. 所有 shell/Python 语法、脚本 smoke test、脱敏 Compose config 已通过；
4. secrets scan 已通过，且用假 key fixture 验证了扫描器会拒绝敏感赋值；
5. Docker Hub 基础镜像元数据请求超时，实际镜像构建留作网络可用时的人工验证；
6. 下一步是检查 staged 文件、确认 remote 为空并创建本地初始化 commit。
