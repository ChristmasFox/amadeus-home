# 当前任务

更新时间：2026-09-17（Asia/Shanghai）

执行唯一目标：OpenClaw + PUBG 一次性重构 Goal。S3 已完成，S4 已完成所有可执行项；旧的
多领域 Kurisu/Mastra 计划不再执行。Telegram 自然入站闭环因缺少测试账号仍 BLOCKED。

## 当前进度

- S0：PASS。已核实 OpenClaw 2026.9.4、Node 24.16、ARM64 镜像、9Router 路由、外部
  secrets/身份和旧数据来源；checkpoint 见 .agent/checkpoints/2026-09-17-openclaw-pubg-s0.md。
- S1：PASS。@agent/pubg-domain 已独立实现官方 API、SQLite、确定性查询/比较、Telemetry
  facts 和幂等迁移；不 import OpenClaw、LangBot、Mastra 或旧 app。
- S2：PASS。plugins/pubg 使用原生 defineToolPlugin，注册六个工具、bundled Skill 和
  bounded schemas；本地 OpenClaw native validate/load 已通过，真实旧数据迁移 smoke 已通过。
- S3：PASS。已运行 `scripts/deploy-openclaw.sh --apply --build --cleanup`；最终镜像为
  `local/openclaw-pubg:git-02d6d0421015-20260917090121`，checkpoint 为
  `/DATA/AppData/openclaw/backups/openclaw-pubg-20260917-091502`，新 OpenClaw 健康运行。
- S4：PASS（Telegram 外部闭环除外）。17 个真实 OpenClaw/9Router 回合已保存工具轨迹、输入、
  结果和耗时；旧代码/入口清理、数据迁移、文档和验收报告完成。Telegram 原生连接为 ready，
  但验收窗口没有自然入站或独立测试账号，未虚构查询/连续追问送达。

## 已完成的本地证据

- Domain 测试 9 项、plugin 测试 3 项、Product Radar 测试 51 项均通过；Product Radar
  typecheck 通过。
- `pnpm build:pubg`、`pnpm typecheck:pubg`、`pnpm test:pubg`、`pnpm check:secrets`、
  `git diff --check` 已在最终 Skill 变更和部署前通过；收尾后复跑全量验证。
- 本地定制镜像已验证 OpenClaw config validate 无 warning，plugin runtime status 为 loaded，
  且只出现六个 PUBG 工具。
- 在 OrbStack ubuntu 临时目标上用真实旧 n8n/state/features 做迁移验证：dry-run
  input=1151, unique=267, duplicates=884, invalid=0, features=57；首次 apply
  inserted=267, importedFeatures=57；重复 apply inserted=0；SQLite matches=267,
  telemetry_features=57, migration_runs=1。
- 为释放 Ubuntu 磁盘空间，只删除了未被容器引用的 69 个旧 PUBG/LangBot 镜像 tag；保留
  当前运行镜像和所有无关服务。该动作不删除业务数据。

## 收尾约束

切换前必须在仓库外保留一次 dated checkpoint；新 OpenClaw 是唯一 PUBG Telegram consumer。
旧 PUBG Runtime、LangBot PUBG plugin、PUBG n8n workflow、旧 facade、旧 generator 和
旧通知桥源码已从当前树移除，Git 历史仍可审计。不得将迁移备份、token、API key、数据库
或真实身份提交到 Git。真实场景明细和唯一剩余外部 blocker 见
`docs/reports/OPENCLAW_PUBG_ACCEPTANCE.md`。
