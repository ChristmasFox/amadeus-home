# Codex Goal Budget 配置 checkpoint

日期：2026-09-05（Asia/Shanghai）

## 变更

- 在仓库根目录 `AGENTS.md` 增加 Codex goal 预算协作规则：不手动设置固定
  `token_budget`，使用 Codex 默认预算机制。
- 明确该规则不能覆盖 Codex 平台自身的系统上限；达到上限时在新任务或会话继续。
- 在 `docs/CURRENT_TASK.md`、`docs/PROJECT_STATE.md` 和 `.agent/state.md` 同步记录。
- 原 `/whoami` 实现尚未完成，后续范围保存在 `.agent/tasks/homehub-whoami.md`。

## 验证

- `git diff --check`：通过
- `pnpm check:secrets`：通过
- 代码测试：本次仅修改协作配置和状态文档，未运行代码测试。

## 恢复与风险

- 当前分支：`main`
- 未执行部署、容器修改或运行时写操作。
- 此规则是仓库级协作约定，不会伪造或解除平台级预算限制。

## 下一步

- 在新的 Codex 任务或会话中继续实现 `.agent/tasks/homehub-whoami.md` 中的只读
  Telegram/KOOK `/whoami` 命令。
