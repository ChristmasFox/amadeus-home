---
name: release-and-migration
description: Prepare a safe repository release or Mac mini/HomeLab migration from Git source and external state.
---

# Release and Migration

- Release system definitions from Git; keep secrets, databases, n8n credentials, LangBot data, and volumes in an external backup/password workflow.
- Canonical long-lived services run in OrbStack Linux machine `ubuntu` under CasaOS. Do not deploy persistent services to macOS host Docker.
- Use the recovery order: clone -> restore secrets -> `bootstrap.sh` -> restore selected data -> start CasaOS services -> `doctor.sh` -> real inbound smoke tests.
- Before a release or migration run tests, `pnpm check:secrets`, `git diff --check`, backup validation, and record the exact commit/image/workflow versions. Keep rollback artifacts outside Git.
- Update `README.md`, state docs, and a checkpoint; list manual credential rebinding, DNS/Cloudflare, architecture, and volume steps explicitly.
