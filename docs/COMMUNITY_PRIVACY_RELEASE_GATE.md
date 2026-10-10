# Community release privacy & safety gate

This is a **public repository**, but is **NOT YET** a privacy-reviewed or production-ready open-source distribution. Changes on the community onboarding branch do not rewrite git history or revoke previously disclosed credentials.

## Completed source hardening (first patch)

- Replaced `packages/pubg-domain/config/default-team.json` with **synthetic** player IDs and names; runtime PUBG plugin requires an external team file.
- Added explicit official-PUBG-API nickname -> account ID initialization, which creates a mode-0600 external file, refuses overwrites and never prints account IDs or keys.
- Added a synthetic-only fixture regression gate and dependency-free CLI tests.
- Documented the WhatsApp + OpenClaw + 9Router path, and the distinction between team ID, PUBG account ID and WhatsApp sender identity.
- No current Mac mini/VPS/CasaOS deployment script or live secret was changed.

## Blocking work before claiming the whole repo is safe to distribute

- **Historical Git disclosure:** run a real full-history secret scan (e.g. Gitleaks) in a trusted local environment, review results without posting secrets, rotate affected credentials, and assess history rewrite/forks. Deleting current tracked content does NOT remove previously public snapshots.
- **9Router account segregation:** the **branch** now removes the Git-tracked production account policy; it uses a private local policy at release time (fail-closed) and an unrestricted, separately built **community** image. **Before any merge or new production build**, migrate the existing production policy to `.local/9router-production-policy.json` using [the manual runbook](PRODUCTION_9ROUTER_POLICY_MIGRATION.md). Verify the running owner image and old Git history separately.
- **HomeLab/VPS information exposure:** review `infra/vps/`, `infra/host-profile.env.example`, `docs/`, `.agent/` and configuration history for domains, service ports, operational paths, subscription metadata, provider identities and personal records. Publish generalized examples, not actual topology.
- **Data and identity boundaries:** review tracked fixtures, screenshots, JSON reports and legacy docs for real PUBG account IDs, sender JIDs/phone numbers, tokens and player aliases. `identity-presets.example.json` is illustrative only.
- **Installation:** create and test community-only Docker profiles or Compose manifests in a fresh Linux host; do not repurpose owner `--apply` scripts. Test webhook/pairing credentials and restart persistence.
- **Licensing / third-party rights:** choose a LICENSE; verify compatibility with upstream 9Router, OpenClaw, game branding, voice assets and API terms.
- **Security defaults:** bind management endpoints to loopback/private authenticated networks, use WhatsApp pairing/group allowlists/mention triggers and restrict model spending.

## Suggested checks (do not publish raw output)

```sh
node --test scripts/test-init-pubg-team.mjs
node scripts/check-community-fixtures.mjs
pnpm check:secrets
gitleaks git --redact --log-opts='--all' .
gitleaks dir --redact .
```

**Release gate:** Nothing here authorizes deploying to the active personal HomeLab. The community 9Router account policy and generic Compose setup remain pending until verified separately.

## Isolated community Compose preview

A preliminary profile now exists at `infra/community/compose.yaml` using the community-only 9Router image and the WhatsApp-first OpenClaw+PUBG plugin, with loopback ports and local non-overwriting bootstrap. This is **not** a production-approved release until clean-machine image build and real E2E verification. The 9Router production policy and deployment scripts remain separate.
