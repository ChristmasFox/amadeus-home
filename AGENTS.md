# Agent Monorepo 工作规则

## 新会话启动

每次 Codex 新会话必须先读取以下文件，然后再修改代码或配置：

1. `README.md`
2. `docs/ARCHITECTURE.md`
3. `docs/PROJECT_STATE.md`
4. `docs/CURRENT_TASK.md`
5. `.agent/state.md`

随后执行：

```sh
git status --short --branch
git log -5 --oneline --decorate
```

这些文件和 Git 状态是任务上下文的来源；不要把聊天历史当作唯一状态。

## 阶段完成协议

每完成一个阶段任务，都要：

- 更新 `docs/CURRENT_TASK.md` 和 `docs/PROJECT_STATE.md`；
- 在 `.agent/checkpoints/` 写入带日期的 checkpoint；
- 如果产生后续任务，写入 `.agent/tasks/`；
- 跑与改动匹配的测试和 `scripts/check-secrets.sh`。

## 目录与运行时

- `apps/agent-runtime` 是当前 Mastra/PUBG V3 的可运行 source-preserving 实现。
- `apps/telemetry-worker` 和 `apps/whatsapp-adapter` 是稳定边界 facade；实现暂保留在 runtime，避免搬迁时改变线上行为。
- `integrations/langbot` 只保存自定义插件、patch、WhatsApp 平台资源和示例配置；不复制 LangBot 第三方本体。
- `integrations/n8n/workflows` 是 workflow 的 Git source of truth；n8n credentials 必须在仓库外重新绑定。
- 长期 HomeLab 服务部署到 OrbStack Linux machine `ubuntu` 的 CasaOS，不默认使用 macOS host Docker。
- CasaOS compose 真正位置：`/var/lib/casaos/apps/<app>/docker-compose.yml`；持久化数据：`/DATA/AppData/<app>`；共享存储：`/Volumes/Avalon/...`。

常用命令：

```sh
orb -m ubuntu ...
orb -m ubuntu -u root ...
orb -m ubuntu -u root bash -lc 'cd /var/lib/casaos/apps/<app> && docker compose up -d'
```

## 安全边界

禁止提交 Bot Token、API Key、Access Token、APP_SECRET、数据库密码、Tunnel Token、n8n credential 值和任何 `.env`。提交前必须运行：

```sh
pnpm check:secrets
```

备份脚本生成的归档默认放在仓库外或被 `.gitignore` 忽略的位置；不要把备份归档上传到公共仓库。
