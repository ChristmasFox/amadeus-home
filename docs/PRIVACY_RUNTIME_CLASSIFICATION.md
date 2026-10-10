# Runtime privacy classification

This file records which tracked files may participate in a current production
run. It is part of the source review for the production safe history cutover;
it does not authorize a deployment or a Git ref rewrite.

## Active source

| Area | Files | Private input | Missing input behavior |
| --- | --- | --- | --- |
| Qwen image and speech managers | `apps/qwen-image-service/**`, `infra/macos/manage-qwen-image*.sh`, `infra/macos/manage-qwen3-tts.sh`, `infra/macos/qwen-image-*.json`, `scripts/prepare-mlx-tts-poc.sh` | mode `0600` Qwen path profile and public Host/Origin JSON on the operator Mac | bridge template expansion and UI public scope fail closed; speech manager requires the configured operator host |
| Mac host telemetry and NAS helper | `infra/macos/machostagent.py`, `infra/macos/install-machostagent.sh`, `infra/macos/nas-control.sh`, `infra/macos/com.amadeus.machostagent.plist.example`, `plugins/amadeus/src/machost.ts` | operator host/storage profile and protected bearer token | missing host/storage profile blocks apply; telemetry remains read-only and reports a neutral unavailable host |
| Amadeus VPS capability | `plugins/amadeus/src/{config,vps}.ts`, `plugins/amadeus/src/capabilities/vps/register.ts`, `plugins/amadeus/skills/vps/SKILL.md` | `VPS_ACCOUNT_MAP_FILE` plus the existing SSH/API secret files | owner account tools return a typed configuration error; no neutral fixture is treated as production identity |
| VPS read-only probe | `infra/vps/amadeus-vps-readonly-probe.sh` | `/etc/amadeus-gateway/account-map.json` on the VPS | probe emits bounded neutral fixture IDs and no credential material; the Amadeus plugin still refuses owner account views without its private map |
| OpenClaw deployment | `scripts/deploy-openclaw.sh`, `scripts/host-profile.sh`, `infra/host-profile.env.example`, OpenClaw Compose example | ignored `infra/host-profile.env`, protected Compose secret files, and the private account map mount | `community` host profile supports planning only; apply stops before any runtime write |
| VPS accounting runtime | `infra/vps/subscription/accounting_store.py` and systemd template | `VPS_ACCOUNT_MAP_FILE` in the external systemd environment | an absent map uses neutral fixture IDs for community tests; the production service must install the operator map before account bootstrap |

## Legacy or archival source

The following scripts describe the historical Operation Skuld migration and
restore workflow. They are retained for audit and recovery documentation, but
are not part of the current OpenClaw deployment path:

`scripts/migration-readiness.sh`, `scripts/openclaw-migration-safe-start.sh`,
`scripts/openclaw-unique-runtime-gate.sh`, `scripts/plan-*.sh`,
`scripts/restore-*-snapshot.sh`, `scripts/restore-skuld-secrets.sh`,
`scripts/skuld-state-machine.sh`, and their `test-*.sh` companions.

These files must not be bulk edited as if they were live service definitions.
They remain dry-run or explicitly approved recovery helpers, and any future use
must load an operator host profile before an apply path. Their historical
identifiers are evidence for the private history audit and are not runtime
configuration for the community install.

The Qwen3-TTS checkpoint and voice-backup helpers
(`infra/macos/checkpoint-qwen3-tts-a.sh` and
`infra/macos/backup-qwen3-tts-profile.sh`) are also archival recovery helpers;
the active TTS manager is `infra/macos/manage-qwen3-tts.sh`, which requires an
explicit operator host profile. The archival helpers are not invoked by the
OpenClaw runtime or by this cutover.

## Review rule

Only exact private replacement rules may be used for the archival material.
Generic IPv4, UUID, checksum, account-token, and domain suffix replacements are
not safe. The current snapshot scanner and the reachable-history scanner must
be run separately; neither scanner prints matched values.
