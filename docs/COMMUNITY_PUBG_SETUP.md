# Community PUBG onboarding (WhatsApp + OpenClaw + 9Router)

> **Preview:** This guide prepares the PUBG roster data. It is not yet a one-command community Compose release. Do **not** run the CasaOS/M204 production `--apply` scripts on another person's machine.

## What is the team ID?

- `team.id` is a **local application identifier** (for example `my_squad`). PUBG does not issue a persistent ID for your usual four-person squad.
- Each `players[].id` is an **official PUBG account ID** resolved from an in-game name via the official PUBG API.
- A WhatsApp user/JID is **not** a PUBG account ID. OpenClaw's identity binding is a separate, later setup step; do not infer that binding from a sender display name.

## 1. Requirements

- Node.js 24.16+ and pnpm 11 (as used by this repo).
- Your **own** PUBG API key from https://developer.pubg.com/ . Never commit it or put it in a command argument.
- A running, separately configured 9Router with an authorized model account or API key; its OpenAI-compatible endpoint must be reachable by OpenClaw. The PUBG API itself is queried directly, **not** through 9Router.
- OpenClaw with its WhatsApp channel installed; use an independent WhatsApp account/number where possible.

## 2. Initialize a private squad file

Create a file outside Git containing your PUBG API key (owner-readable only). For example:

```sh
mkdir -p .local
# Put your actual key into .local/pubg-api-key using a secure editor; NEVER commit this file.
chmod 600 .local/pubg-api-key
node scripts/init-pubg-team.mjs \\
  --players PlayerOne,PlayerTwo,PlayerThree,PlayerFour \\
  --platform steam \\
  --team-id my_squad \\
  --label 'My Squad' \\
  --api-key-file .local/pubg-api-key
```

The command performs exactly one official `/shards/steam/players?filter[playerNames]=...` lookup, requires a unique exact match for every supplied name, and writes `.local/pubg-team.json` with mode `0600`. No IDs or API key are printed. It refuses to overwrite an existing file; back it up outside Git before changing the roster.

By default the script accepts **1–4 players** and shards `steam`, `kakao`, `psn`, `xbox`. Use `--help` for options; `--output /absolute/protected/path.json` writes outside the repo. A non-ignored path inside the repo is rejected.

**Do not put real accounts in** `packages/pubg-domain/config/default-team.json`: that file is a non-functional, anonymized fixture.

## 3. Configure the PUBG plugin

Set the following **inside the OpenClaw service/container** (the host and container paths may differ):

```text
PUBG_API_KEY_FILE=/run/secrets/pubg_api_key
PUBG_TEAM_CONFIG_FILE=/run/secrets/pubg_team.json
PUBG_DATABASE_PATH=/data/pubg.sqlite
```

Mount the API key file and generated team JSON **read-only** at those paths. Persist `/data` for the SQLite database. The existing OpenClaw plugin also supports the equivalent configuration keys in `plugins.entries.pubg.config`.

A fresh community Compose profile is still planned; the current canonical Compose and deployment scripts use personal CasaOS paths and must **not** be copied as-is.

## 4. Configure 9Router and WhatsApp

Connect **your own authorized** model account/API key in 9Router and configure OpenClaw to use the model endpoint (no shared operator credentials). Use a **separate API key**, keep the 9Router management interface bound to loopback or an authenticated private network, and apply request/usage limits.

For WhatsApp use OpenClaw's pairing-based setup, initially restricting groups to allowlisted groups and requiring mentions:

```sh
openclaw channels login --channel whatsapp
openclaw channels status --probe
```

Reference: https://docs.openclaw.ai/channels/whatsapp . Telegram is optional and **not** the recommended default.

## 5. Identity binding and verification

The generated file enables explicit **team** queries (`team=true`). For “my stats” or named friend aliases, separately bind your trusted WhatsApp sender identity to the matching `pubg` external account via the existing `@agent/identity` mechanism; never derive sender identity from nickname alone. See `integrations/openclaw/identity-presets.example.json` for the seed shape. The WhatsApp pairing/auth state belongs outside Git.

Run the isolated source checks:

```sh
node --test scripts/test-init-pubg-team.mjs
pnpm build:pubg
pnpm typecheck:pubg
pnpm test:pubg
```

Then, in your own WhatsApp conversation, test an explicit squad request and a bound individual request; check team size, API authorization, and persistence across restart. No real WhatsApp/PUBG/9Router end-to-end test has yet been performed for this community path.

## Publication blockers

The current `amadeus-home` repository contains private-environment history, network topology, and an account-specific 9Router policy. **Do not market this main repository as a scrubbed community release yet.** An independent full-history/credential audit and separate community-safe 9Router profile (without owner account allowlist) are prerequisites. Keep the existing production image-account separation in place during that migration.
