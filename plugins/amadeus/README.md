# Amadeus native OpenClaw plugin

This is the only native plugin for the non-PUBG Amadeus capabilities. OpenClaw
owns natural-language planning and channel transport; this plugin exposes
bounded deterministic adapters and the single owner-notification capability.

The plugin never sends proactive messages to Telegram or KOOK. Producers write
owner events to the shared durable outbox, and the plugin delivers them through
the configured OpenClaw WhatsApp account and owner target.

The VPS capability is intentionally read-only: KiwiVM calls are limited to
service info, live service info, and raw usage statistics, while SSH runs only
fixed uptime/resource and four-service probes. VEID/API key material, the
read-only SSH key, known-hosts file, and traffic state are external runtime
files; the plugin never accepts a shell command or control operation.

The same plugin owns the OpenClaw-native Identity capability. Its SQLite store
contains only canonical Persons, trusted channel bindings, aliases, external
accounts, and short observed-evidence summaries. Optional initial presets are
loaded from the external `identityPresetsFile`; production channel IDs/JIDs and
the database stay outside Git. Observed aliases remain candidates until an
owner/Arthur confirmation.

The market capability reads public `.IXIC.US`, `.NDX.US`, `.SPX.US`, and
`.DJI.US` quote, session, intraday, mover, and market-temperature facts through
the official `longbridge` Node SDK in OAuth 2 mode. The SDK's native quote
transport and token cache are installed in the OpenClaw image; the persisted
cache is mounted at `/home/node/.longbridge` and never enters the LLM-visible
surface. It compares the current quote with the previous trading close, uses
Longbridge trading-day/session facts for validity, and sends only the structured
notification returned by the deterministic tool. The scheduled open/close jobs
use the same WhatsApp owner outbox as other Amadeus reports.

Group forms of address (how Kurisu calls each member in one group, and names
to avoid) are reviewed by the owner and written to the external identity presets
file as `addressing: [{scope: "group", scopeId: "<jid>@g.us", addressAs, avoid,
note}]` on a person. They are seeded into the identity store and injected into
every turn of that WhatsApp group's session as system context, so a session
reset or compaction never loses them and no other conversation sees them. The
agreed name also resolves as a group-scoped alias.

WhatsApp and Telegram replies settle through one typed delivery boundary. A
native tool can declare `replyLink: {kind: "share", url}` on a successful result;
when its origin is listed in `replyLinkOrigins` and the path is a share page
(`/s/<22-char token>`), the boundary makes that exact link the reply's last line
if the agent left it out, and drops any other share-shaped link the model wrote.
The tool decides which answers carry a link; there is no keyword routing.

All credentials, SSH keys, owner identity, and media paths are deployment
configuration. They are not part of this package or the repository.

## Memory writes and the recent-DM digest

`amadeus_remember` (`src/remember.ts`, `src/memory-store.ts`) is the only path that
lets the model persist "remember this". It appends dated bullets to a managed
section (`## 近期记住（由 remember 写入）`, delimited by HTML comment markers) and
leaves the rest of the file untouched. A per-turn prompt rule (same
`before_prompt_build` carrier as the voice-reply prompt, so the live `AGENTS.md`
is never overwritten) tells the model to call it before saying "记住了".

| Where | `scope=private` → `MEMORY.md` | `scope=public` → `USER.md` | recent-DM digest |
| --- | --- | --- | --- |
| Owner direct chat | write | write | injected |
| Owner in a group | refused | write (group-safe text only) | never |
| Other participant / other DM | refused | refused | never |
| cron / subagent / heartbeat | refused | refused | never |

Writes are also refused when the turn's input provenance is not a direct user
message, or when the turn already used a web/exec/session-reading tool (prompt
injection guard). Text is one line, ≤300 chars, no secrets/markup; public text
additionally excludes numbers, emails, links and chat identifiers. Files are
replaced atomically (same dir, mode/owner preserved) with a 3000/1200-char
section budget (oldest bullets compact into one line) and a 16000/6000-char file
ceiling below `bootstrapMaxChars`. Provenance is recorded through the
`markMemoryArtifactAgentWrite` export added by `scripts/patch-openclaw-memory-provenance.mjs`
so the files stay `agent` (auto-injected); on an unpatched runtime the tool still
writes and reports `provenance: "unavailable"`.

The digest (`src/dm-digest.ts`) is regenerated from the owner's direct session on
reset/compaction (and at most every 6 h otherwise) through the configured 9router
chat model, stored at `<workspace>/.amadeus-private/dm-digest.md` — deliberately
outside `memory/**`, so `memory_search` of any session cannot return it — and
injected only into the owner's direct sessions. A failed summary keeps the old file.

Runtime `MEMORY.md`, `USER.md`, `DREAMS.md`, `memory/**`, `.amadeus-private/`,
session `*.jsonl`, SQLite sidecars and backups are never committed: `.gitignore`
and `scripts/check-secrets.sh` enforce it; only `workspace-seed/*.seed.md` are tracked.
