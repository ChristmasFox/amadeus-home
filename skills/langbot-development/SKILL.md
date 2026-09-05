---
name: langbot-development
description: Develop, package, test, or deploy the repository's custom LangBot plugins and build-time patches.
---

# LangBot Development

- Treat `integrations/langbot/plugins/` and `integrations/langbot/patches/` as the only maintained custom source. Never copy the third-party LangBot tree into Git.
- Build `.lbpkg` files from the repository source; keep generated packages ignored. Validate manifests, Python syntax, plugin tests, and `pnpm check:secrets`.
- Use `scripts/deploy-langbot.sh --dry-run` first. Actual plugin installation requires `--apply` and an out-of-band `LANGBOT_API_KEY`; never put the key in arguments, files under Git, or logs.
- Patches are applied while building a LangBot image. Do not edit files inside a running container. Record the base image, patch set, Git commit, compatibility version, test result, and rollback image/package.
- After a completed change update `docs/CURRENT_TASK.md`, `docs/PROJECT_STATE.md`, and `.agent/checkpoints/`.
