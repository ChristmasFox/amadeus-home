# Community privacy and release status

**Status: public source code under [MIT License](../LICENSE); community deployment remains a preview, not a verified one-click production release.**

This document describes the repository as of 2026-10-12 and should not be read as an audit certificate.

## Completed

- Public Git history was rewritten for all **8 advertised branches and 2 tags** on 2026-10-12. The production 9Router image-account policy was removed from the published branch/tag history and current community image. Private owner configuration is deliberately kept outside Git.
- All known exact private-value rewrite rules were reported clear in the operator's private cutover candidate; Git integrity validation passed. This does **not** cover GitHub-hosted old PR refs, cached Git objects, clones, or unknown secrets.
- The community bootstrap creates private, ignored credentials and neutral PUBG player/team fixtures; it does not copy the maintainer's 9Router provider accounts or production secrets.
- A strict active-source privacy gate, selected VPS documentation gate, secret-shape check and isolated Unix-permissions tests were added. Prior GitHub PR #4 privacy checks passed after the history-rewrite scanner fix.
- A root [MIT License](../LICENSE) is provided for original repository code and documentation. Upstream services, third-party models, media and branded assets remain governed by their own terms.

## Open risks / verification still needed

- **GitHub historical refs:** `refs/pull/1/head` and `refs/pull/2/head`, old commit URL lookups and caches may still expose earlier content. A GitHub Support request has been submitted to review eligible removal. Do not repush or merge commits from old clones.
- **Full historic credentials:** historical heuristic scans can flag mock auth headers, SHA-256 digests and fixed configuration keys; there has been **no confirmation of an active production credential** from those findings, but this is not proof all history is secret-free. Rotate or revoke credentials immediately if new evidence identifies an actual exposure.
- **Community deployment:** clean Linux amd64/arm64 Docker builds, real WhatsApp pairing, 9Router model authorization, PUBG API queries, telemetry cache persistence and restart recovery still need an independent end-to-end test.
- **Third-party rights:** comply with OpenClaw and 9Router upstream licensing, official PUBG API terms and any model, character, voice and image licensing. MIT here does not relicense external components.
- **Operational defaults:** use loopback-bound management endpoints, pairing/group allowlists, explicit tools, rate and spending limits. **Never run production `--apply` scripts to deploy community mode.**
- **Operator configuration:** a maintainer's VPS topology or hostnames might remain identifiable. Disclosure of a hostname does not imply authorization to access it; do not copy production endpoints into your own install.

## Suggested local safety checks

```bash
node --test scripts/test-init-community.mjs
node --test scripts/test-init-pubg-team.mjs
node infra/docker/casaos/9router/test-runtime-policy.mjs
pnpm check:secrets
node scripts/audit-public-infrastructure.mjs --self-test
node scripts/audit-public-infrastructure.mjs --strict-active
node scripts/audit-public-infrastructure.mjs --strict-vps
```

For real deployment instructions, start at [Community Compose quick start](../infra/community/README.md). Keep local `.env`, OAuth data, model provider credentials, phone numbers/JIDs and private runtime profiles out of Git, logs and issue attachments.

For owner-only 9Router upgrades, follow [Private 9Router account policy migration](PRODUCTION_9ROUTER_POLICY_MIGRATION.md) instead of using community mode.
