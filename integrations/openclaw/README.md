# OpenClaw Amadeus deployment

This directory is the source for the single production OpenClaw/Kurisu agent used by
Telegram and WhatsApp. OpenClaw owns natural-language understanding, session
context, model routing, scheduling, and the tool loop. `plugins/pubg` and
`plugins/amadeus` are the only business plugins loaded by this deployment;
deterministic business logic remains in the plugin/domain or external service
boundaries.

The main agent uses `tools.profile="full"`: the owner session receives the complete
OpenClaw tool surface plus every loaded native plugin, so adding a new native tool does not
silently produce a PUBG-only agent. Host-level approval gates and tool-specific owner checks
still apply to destructive operations.

The runtime uses the official `ghcr.io/openclaw/openclaw:2026.9.4` image as a
pinned base and the current 9Router route `nine_router/arthur-combo`. Secrets
and the Telegram owner ID stay outside Git:

- `/DATA/AppData/openclaw/openclaw.env` contains the Gateway token and the
  9Router credential reference value;
- `/DATA/AppData/openclaw/secrets/telegram-bot-token` contains the Telegram bot
  token restored outside Git;
- `/DATA/AppData/openclaw/secrets/pubg-team.json` contains the production team
  mapping;
- the PUBG API key is copied once into
  `/DATA/AppData/openclaw/secrets/pubg-api-key` and mounted read-only; the
  source file remains outside the repository and is retained for rollback.
- `/DATA/AppData/openclaw/secrets/owner-whatsapp-target` contains the fixed
  WhatsApp owner target; it is never stored in the repository.
- `/DATA/AppData/openclaw/secrets/mac-ssh-key` and the optional KOOK token are
  mounted read-only for the native NAS and interactive KOOK tools.

The checked-in `openclaw.json.example` intentionally has an empty Telegram
allowlist and an enabled WhatsApp channel without persisted session secrets.
`scripts/deploy-openclaw.sh --apply` reads the numeric
`TELEGRAM_ALLOWED_USER_ID` and the WhatsApp owner target from external secret
files, writes concrete runtime values to the mounted config with a backup, and
refuses to start if the identities or required secret files are missing.

WhatsApp Web pairing state is runtime data under `/DATA/AppData/openclaw`; it
is never copied into Git. Channel policy is configured as open groups with
`requireMention=false`; group members inherit the full agent tool profile,
including PUBG and normal Amadeus capabilities. High-risk operations still
enforce their own owner/confirmation checks. The current runtime account id is
`secondary`; the previous default account's credentials were archived outside
the repository before the switch.

## Local verification

```sh
source /Users/blacksidev/.nvm/nvm.sh
nvm use 24.16.0
pnpm build:pubg
pnpm typecheck:pubg
pnpm test:pubg
pnpm build:amadeus
pnpm typecheck:amadeus
pnpm test:amadeus
pnpm build:product-radar
pnpm typecheck:product-radar
pnpm test:product-radar
pnpm --filter @agent/pubg-plugin exec openclaw plugins validate --entry ./dist/index.js --json
```

The image build is explicit because the normal developer workflow does not
build or restart services:

```sh
./scripts/deploy-openclaw.sh --dry-run
./scripts/deploy-openclaw.sh --apply --build
```

The apply path creates a dated remote checkpoint before changing the new
OpenClaw app or stopping the old PUBG Telegram consumer. It uses the canonical
CasaOS app directory `/var/lib/casaos/apps/openclaw` and never mounts the old
PUBG media directories or Docker socket.
