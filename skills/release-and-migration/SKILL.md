---
name: release-and-migration
description: Prepare a safe repository release or Mac mini/HomeLab migration from Git source and external state.
---

# Release and Migration

- Start by classifying the diff with `pnpm workflow:plan`. FAST and RUNTIME work must not be promoted to a
  Docker build or deployment by default; HomeHub/runtime TypeScript changes remain RUNTIME.
- RELEASE is explicit. For `apps/agent-runtime`, use `scripts/deploy-agent-runtime.sh`: its default is
  dry-run, normal apply uses `docker compose up -d --no-build`, and only `--apply --build` may create a new
  commit-tagged runtime image.
- Release system definitions from Git; keep secrets, databases, n8n credentials, LangBot data, and volumes
  in an external backup/password workflow. The canonical long-lived services run in OrbStack Linux machine
  `ubuntu` under CasaOS; do not deploy persistent services to macOS host Docker.
- The runtime RELEASE sequence is: clean committed tree -> tests -> `pnpm check:secrets` -> host BuildKit
  image build -> immutable image transfer to Ubuntu -> compose image update -> `docker compose up -d --no-build`
  -> health + endpoint smoke -> record rollback compose backup and repository checkpoint.
- LangBot plugin and patch releases remain their own workflows. Use `scripts/deploy-langbot.sh --dry-run`
  before an explicit `--apply`; only a patch activation builds a LangBot image.
- Update `README.md`, state docs, and a checkpoint; list manual credential rebinding, DNS/Cloudflare,
  architecture, volume steps, exact commit/image/workflow versions, and rollback instructions explicitly.
