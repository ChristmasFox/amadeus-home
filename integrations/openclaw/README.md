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
- `/DATA/AppData/openclaw/secrets/kiwivm-credentials.json` contains only the
  external KiwiVM `veid`/API key JSON; `/DATA/AppData/openclaw/secrets/vps-readonly-ssh-key`
  and `/DATA/AppData/openclaw/secrets/vps-ssh-known-hosts` are the dedicated
  forced-command SSH credentials. They are mounted read-only and never committed.
- `/DATA/AppData/openclaw/data/identity.sqlite` stores canonical Persons,
  aliases, trusted Telegram/WhatsApp bindings, and provider-neutral external
  accounts. An optional `/DATA/AppData/openclaw/data/identity-presets.json`
  may seed Arthur's fixed friends; production channel IDs/JIDs are learned at
  runtime and never committed. See `identity-presets.example.json` for shape.
- `/DATA/AppData/openclaw/data/vps-usage-state.json` stores the last successful
  traffic counter/time and survives an OpenClaw restart. Provision the fixed
  VPS probe/key with `scripts/provision-vps-readonly.sh --apply --public-key
  <external-public-key>` before the OpenClaw release apply.

The checked-in `openclaw.json.example` intentionally has an empty Telegram
allowlist and an enabled WhatsApp channel without persisted session secrets.
`scripts/deploy-openclaw.sh --apply` reads the numeric
`TELEGRAM_ALLOWED_USER_ID` and the WhatsApp owner target from external secret
files, writes concrete runtime values to the mounted config with a backup, and
refuses to start if the identities or required secret files are missing.

WhatsApp Web pairing state is runtime data under `/DATA/AppData/openclaw`; it
is never copied into Git. Channel admission remains open groups with
`requireMention=false`. The owner retains the full native tool profile minus
the global `tts,message` deny. Other admitted group senders receive the
scoped web/image/PUBG capabilities plus bounded read-only M204 host status and
process queries; those host metrics are served only by the native MacHostAgent
tools, while guest shell probes and raw agent HTTP substitutes are blocked;
non-owner direct chats remain web-only. The source-managed
group policy is scoped to WhatsApp and Telegram and does not grant runtime,
filesystem, NAS, HomeLab aggregate, VPS, Identity, or mutation tools. The
pinned 2026.9.4 policy layers intersect group and global sender allowlists;
the strict version-pinned capability policy patch in the immutable OpenClaw
image lets only verified group capabilities add their matching tools through
the global sender layer. It does not remove any deny or create a second tool.
High-risk operations keep their owner/confirmation checks. The current WhatsApp runtime account id is
`secondary`; its previous account credentials were archived outside Git.

The candidate default image model is the stable `openai/amadeus-image` logical
capability over the existing 9Router OpenAI-compatible provider and SecretRef.
One native `image_generate` call reaches 9Router; 9Router, not OpenClaw,
performs ordered fallback from `cx/gpt-image-2.5` to
`ag/gemini-3.1-flash-image`. The image Skill is provider-neutral and covers new-image
generation only; reference-image editing parity is deferred. Native TTS uses
`tts.auto=tagged`: a verified inbound voice note or a typed explicit voice
request can emit the same `voice-reply` block and receive Japanese audio plus
visible Japanese/Chinese text. Ordinary untagged typed replies stay text-only;
`amadeus-tts`, `kurisu-v1`, MP3, the 1200-character cap, and the 120-second
timeout remain unchanged. The inbound WhatsApp voice lease is still required
for inbound-audio-specific prompt injection and is never synthesized by a
typed request.

`workspace-seed/*.seed.md` files are Git-managed initial seeds only. Runtime
state under `/DATA/AppData/openclaw/workspace` is authoritative: prepare/apply
creates only missing seed files and never rewrites or changes permissions on
existing files, symlinks, directories, or runtime-created state. The explicit
`scripts/openclaw-workspace-sync.sh` tool is plan-only by default and requires
one named file approval for any write. Identity SQLite databases, channel
credentials, pairing state, and other runtime memory remain outside Git. The
pinned OpenClaw 2026.9.4 Telegram bundle and the
persisted WhatsApp channel package receive the same source-controlled,
version-anchored metadata patch during image build/apply; it carries only
provider-native IDs into the existing Identity tool context and never infers an
identity from prompt text, display names, phone text, or an unobserved username.
Telegram `@username` mentions are accepted only when the same conversation has
recently supplied a trusted sender ID for that username; expired or conflicting
observations fail closed and are not persisted.

## Local verification

```sh
if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"; fi
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
