# OpenClaw PUBG deployment

This directory is the source for the single production OpenClaw agent used by
the PUBG private-chat flow. OpenClaw owns natural-language understanding,
session context, model routing, and the tool loop. `plugins/pubg` is the only
domain plugin loaded by this deployment; its six tools expose deterministic
facts from `packages/pubg-domain`.

The runtime uses the official `ghcr.io/openclaw/openclaw:2026.9.4` image as a
pinned base and the current 9Router route `nine_router/arthur-combo`. Secrets
and the Telegram owner ID stay outside Git:

- `/DATA/AppData/openclaw/openclaw.env` contains the Gateway token and the
  9Router credential reference value;
- `/DATA/AppData/openclaw/secrets/telegram-bot-token` contains the Telegram bot
  token extracted once from the old LangBot database;
- `/DATA/AppData/openclaw/secrets/pubg-team.json` contains the production team
  mapping;
- the PUBG API key is copied once into
  `/DATA/AppData/openclaw/secrets/pubg-api-key` and mounted read-only; the
  source file remains outside the repository and is retained for rollback.

The checked-in `openclaw.json.example` intentionally has an empty Telegram
allowlist. `scripts/deploy-openclaw.sh --apply` reads the numeric
`TELEGRAM_ALLOWED_USER_ID` from the external env file, writes the concrete
allowlist to the mounted config with a backup, and refuses to start if the
identity or required secret files are missing.

## Local verification

```sh
source /Users/blacksidev/.nvm/nvm.sh
nvm use 24.16.0
pnpm build:pubg
pnpm typecheck:pubg
pnpm test:pubg
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
