# Checkpoint: Codex Goal 预算全局规则

日期：2026-09-05（Asia/Shanghai）

## 变更

- 更新仓库根目录 `AGENTS.md`：明确仓库规则与 Codex 全局规则均禁止为 goal 手动设置、指定、增加或限制预算。
- 更新用户级 `/Users/blacksidev/AGENTS.md`：同步相同的 Codex goal 预算规则。
- 明确调用 `/goal` 或 `create_goal` 时必须省略 `token_budget`，使用 Codex 默认预算机制。
- 同步更新 `docs/CURRENT_TASK.md`、`docs/PROJECT_STATE.md` 和 `.agent/state.md`。

## 验证

- `git diff --check`
- `pnpm check:secrets`
- 本次仅修改协作规则和状态文档，未运行代码测试。

## 恢复与风险

- 未执行部署、容器修改或运行时写操作。
- 该规则不会伪造或解除 Codex 平台自身的系统上限；达到上限时应开启新的任务或会话继续。
