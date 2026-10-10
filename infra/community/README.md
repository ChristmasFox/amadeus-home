# Community quick start: WhatsApp + OpenClaw + 9Router + PUBG

**Preview implementation (Draft PR):** isolated Docker Compose starter; no real-user end-to-end validation yet. The **personal CasaOS/Mac mini services are NOT changed**.

The community stack uses the existing PUBG plugin bundle, a separate 9Router 0.5.95 image, and pinned OpenClaw 2026.9.4. The 9Router community policy contains **no account email allowlist**. It retains the image diagnostic and false-30-second-cooldown fixes, without your owner-only TTS/ASR bridge. Model accounts must be your own authorized accounts.

## Requirements

Docker Engine/Desktop with Compose v2, Node.js >=24 for bootstrap, a PUBG developer API key, your own 9Router upstream model provider/account, and a WhatsApp number for pairing. No public domain, Cloud API webhook, Mac, CasaOS or OrbStack needed.

**Security:** Compose binds management ports to **127.0.0.1**. For remote servers use SSH port forwarding or authenticated VPN; do not publicly expose port 20128 or 18789.

## 1. Bootstrap (local secrets, no existing files overwritten)

At repository root:

```sh
node scripts/init-community.mjs --model YOUR_CHAT_MODEL_OR_COMBO
```

Creates private `infra/community/.env`, `.local/community-openclaw.json`, and empty `.local/pubg-api-key`. Never overwrite these files or reissue credentials silently. Pick a model ID you will create in 9Router. The initializer does not access any operator production account or OAuth credential.

## 2. Start isolated 9Router first

```sh
docker compose --env-file infra/community/.env -f infra/community/compose.yaml up -d --build nine-router
```

Open http://127.0.0.1:20128 and log in using `NINE_ROUTER_INITIAL_PASSWORD` from your *local* `infra/community/.env`. Connect your authorized model providers, and set up the selected model alias/Combo. Create a separate 9Router API key for OpenClaw, with usage/rate limits.

Edit `infra/community/.env` locally, setting `OPENCLAW_9ROUTER_API_KEY=<your-new-9router-key>`. Never commit this file. This is a 9Router API key, **not** an OAuth provider token.

## 3. Create your PUBG squad

Put the official PUBG API key in the already-created `.local/pubg-api-key` with a private editor. Then:

```sh
node scripts/init-pubg-team.mjs --players PlayerOne,PlayerTwo,PlayerThree,PlayerFour --platform steam --team-id my_squad --api-key-file .local/pubg-api-key
```

PUBG does not assign a group ID to your four friends. `team.id` is **local**, while `players[].id` is resolved via PUBG official API. Only synthetic data belongs in tracked fixtures.

## 4. Enable OpenClaw + WhatsApp

```sh
docker compose --env-file infra/community/.env -f infra/community/compose.yaml --profile pubg up -d --build
docker compose --env-file infra/community/.env -f infra/community/compose.yaml --profile pubg exec openclaw node dist/index.js channels login --channel whatsapp
```

Scan the QR code. DM policy is pairing-based. Approve incoming contact codes with:

```sh
docker compose --env-file infra/community/.env -f infra/community/compose.yaml --profile pubg exec openclaw node dist/index.js pairing list whatsapp
docker compose --env-file infra/community/.env -f infra/community/compose.yaml --profile pubg exec openclaw node dist/index.js pairing approve whatsapp PAIRING_CODE
```

**Group chats are disabled initially.** Once paired, learn the real group JID and trusted sender phone number(s). Edit the local `.local/community-openclaw.json` to set `channels.whatsapp.groupPolicy` to `allowlist`, `groupAllowFrom` to trusted E.164 senders, and `groups` to an object keyed by exact group JIDs, each with `requireMention:true`. Avoid wildcard group/sender lists. Reference: https://docs.openclaw.ai/channels/whatsapp .

For squad stats, target the explicit team subject (`team=true`). "My stats" also requires a trusted WhatsApp sender -> Person -> PUBG account identity binding; do not infer identity from display name or raw JID. This is a separate setup step, and the starter does not auto-bind contacts.

## 5. Validation

```sh
node --test scripts/test-init-community.mjs
node --test scripts/test-init-pubg-team.mjs
node infra/docker/casaos/9router/test-runtime-policy.mjs
docker compose --env-file infra/community/.env -f infra/community/compose.yaml config --quiet
```

Check Compose health, test a real model route, then WhatsApp text + PUBG match. Verify persistence after restart. **No fresh-host end-to-end test has yet been completed**, so this remains a preview.

Before merging to a production clone, save the existing private 9Router account policy first: see [the production migration runbook](../../docs/PRODUCTION_9ROUTER_POLICY_MIGRATION.md).

**Never run** `scripts/deploy-9router.sh --apply` or `scripts/deploy-openclaw.sh --apply` for community deployment; those operate on the personal production profile.

## Release boundary

- Secret files are generated in Git-ignored paths and Docker named volumes. Treat Compose `config` output, logs and local `.env` as sensitive.
- Community 9Router has no per-account whitelist, but maintains authentication and distinct keys. It does not make any account shared or free.
- Public Git **history still needs a complete secret/privacy audit**. Old player identifiers and personal infrastructure details may remain. The current Draft PR does **not** rewrite history.
- See [Community privacy release gate](../../docs/COMMUNITY_PRIVACY_RELEASE_GATE.md) before public announcement.
