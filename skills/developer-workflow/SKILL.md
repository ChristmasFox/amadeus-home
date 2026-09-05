---
name: developer-workflow
description: Choose FAST, RUNTIME, or explicit RELEASE validation for changes in agent-monorepo without unnecessary Docker builds.
---

# Developer Workflow

Use this skill when changing agent-monorepo code, docs, Docker inputs, CasaOS configuration, or LangBot assets.

1. Start with `pnpm workflow:plan` (or pass deterministic paths with
   `./scripts/developer-workflow.sh --files ...`). Use the lowest sufficient result; do not infer RELEASE
   solely from HomeHub or runtime TypeScript source.
2. FAST covers docs, `.agent`, tests, skills, and small isolated changes. Run targeted checks and
   `git diff --check`; do not build Docker, restart Compose, or deploy by default.
3. RUNTIME covers `apps/agent-runtime/src/**` and `packages/homehub-domain/src/**`. Run the affected
   typecheck/build, mapped targeted tests, and `scripts/smoke-agent-runtime.sh`. RUNTIME still does not
   build a production image.
4. RELEASE is explicit. Dockerfile, `.dockerignore`, package manifests, and `pnpm-lock.yaml` require a
   RELEASE build only when deployment is requested. Use `scripts/deploy-agent-runtime.sh`; its default is
   dry-run and every CasaOS recreate uses `docker compose up -d --no-build`. `--apply --build` is the only
   runtime-image build/deploy path and requires a clean committed tree.
5. Route LangBot plugins to the plugin workflow and patches to the LangBot image workflow. Treat an env-only
   change as an explicit no-build recreate, never as an image build.

Read `docs/DEVELOPER_WORKFLOW.md` for the scope matrix, cache implementation, benchmark interpretation, and
CasaOS/BuildKit boundary. Preserve its explicit `--apply` requirement for external writes.
