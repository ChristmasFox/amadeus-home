# Checkpoint: Codex Engineering Specifications Completion

Date: 2026-09-05
Git Commit: daa40a1
Branch: main

## Completed Work

1. **AGENTS.md 完善** - 扩展为全局工程规则，包含：
   - Git repo 作为唯一 Source of Truth
   - 禁止 secrets 入库的具体规则
   - 禁止仅修改 runtime 不同步源码
   - Platform-specific logic 不进入 Domain
   - LLM at edges / deterministic core 原则
   - n8n 修改必须导出 JSON
   - 完成任务必须测试、更新状态、写 checkpoint
   - 第三方 LangBot 修改必须可追踪、可回滚

2. **创建了 4 个 Codex Skills**（位于 `skills/` 目录）：
   - `agent-checkpoint` - 阶段完成后的可恢复检查点记录
   - `langbot-development` - LangBot 插件和 patch 开发流程
   - `n8n-workflow-development` - n8n workflow 版本化开发流程
   - `release-and-migration` - 安全发布和 Mac mini/HomeLab 迁移流程

3. **新增 docs/PROJECT_MAP.md** - 说明 Monorepo 各目录职责和修改映射

4. **新增 scripts/deploy-langbot.sh** - 完整的 LangBot 部署脚本：
   - 默认 dry-run 模式
   - 支持插件打包、API 安装
   - 支持 patch 构建和 CasaOS 镜像激活
   - 从外部环境读取 LANGBOT_API_KEY
   - 提供完整的回滚机制

## Files Modified/Created

- Modified: `AGENTS.md` - 完善全局工程规则
- Modified: `README.md` - 更新 GitHub 远程配置和 LangBot 部署说明
- Modified: `docs/PROJECT_STATE.md` - 记录当前状态
- Created: `docs/PROJECT_MAP.md` - 项目地图
- Created: `scripts/deploy-langbot.sh` - LangBot 部署脚本
- Created: `skills/agent-checkpoint/SKILL.md`
- Created: `skills/langbot-development/SKILL.md`
- Created: `skills/n8n-workflow-development/SKILL.md`
- Created: `skills/release-and-migration/SKILL.md`

## Verification

- `pnpm check:secrets` passed
- `git diff --check` passed
- All 4 skills follow skill-creator specification
- deploy-langbot.sh syntax validated with `bash -n`
- Repository is clean after commit daa40a1
- Successfully pushed to origin/main

## Current State

- Repository is fully configured with engineering specifications
- GitHub remote is functional: git@github.com:ChristmasFox/amadeus-home.git
- All Codex workflow rules are documented in AGENTS.md
- Skills are versioned in the repository for migration
- LangBot deployment follows Git-first principle

## Next Steps

None - the current objective is complete. The repository is ready for:
- Codex new sessions to restore context from Git
- Mac mini migration using the established recovery流程
- LangBot and n8n changes to follow the documented workflows

## Rollback Information

If needed, previous commit is 22c1c25 ("docs: clarify test verification").
Current commit is daa40a1 ("docs: complete Codex engineering specifications").
