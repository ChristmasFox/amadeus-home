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

Owner DM preferences (`src/owner-dm-preferences.ts`) are free text the owner keeps in the
runtime file `<workspace>/.amadeus-private/owner-dm-preferences.md` plus optional sibling files
`owner-dm-preferences.<part>.md` read in name order (outside git and outside the memory corpus,
4000 characters per file and 9000 in total); they are injected only into the owner's direct
sessions, and missing or empty files inject nothing.

Runtime `MEMORY.md`, `USER.md`, `DREAMS.md`, `memory/**`, `.amadeus-private/`,
session `*.jsonl`, SQLite sidecars and backups are never committed: `.gitignore`
and `scripts/check-secrets.sh` enforce it; only `workspace-seed/*.seed.md` are tracked.

## Steam (online announcements and lookups)

`src/steam/` is a polling-only Steam integration (Web API; no Steam login, no CM). `domain.ts` (presence state machine,
debounce, cooldown, merge, quiet hours) is pure and channel-free so it can move to a shared package unchanged; `client.ts`
is the Web API client (batched `GetPlayerSummaries`, rate spacing, retries, private data reported as `known:false`);
`store.ts` is SQLite (links, group switches, presence ledger, announcement log); `poller.ts` runs one cycle and the
announcement queue; `compose.ts` has the model word the announcement from code-decided facts (a failed compose sends
nothing); `tools.ts` / `register.ts` register the `steam_*` tools and the `amadeus-steam-presence` service.

- Linking is by the sender themselves (two steps: show the nickname, then confirm). A linked account is announced by
  default in groups where the owner enabled announcements; `steam_set_broadcast` switches it off or on. Others can read a
  person's Steam data only while their announcements are on.
- Friends (`steam_friends_status`): the owner, in their own direct chat only, can ask who among their own Steam friends is playing or what one friend is doing. It reads `GetFriendList` (private list -> `known:false`) and batched `GetPlayerSummaries` on demand with a 60 s cache; friends are never stored, never announced and never available in groups.
- Polling: 60 s by day, 5 min during the quiet window 00:00-09:00 Asia/Shanghai. Quiet-hour arrivals are dropped, never
  replayed; the first observation after start only sets a baseline; per group at most 6 per hour; 60 min cooldown per
  person; arrivals within 3 min share one message.
- Config (placeholders only, never commit values): `steamApiKeyFile` (path of a protected key file), `steamApiBaseUrl`,
  `steamDatabasePath`, `steamBroadcastMode` (`off` default, or `deliver`), `steamWhatsappAccountId`. Env equivalents:
  `STEAM_API_KEY_FILE`, `STEAM_API_BASE_URL`, `STEAM_DATABASE_PATH`, `STEAM_BROADCAST_MODE`, `STEAM_WHATSAPP_ACCOUNT_ID`.
  Node honours `NODE_USE_ENV_PROXY`/`HTTP(S)_PROXY`/`NO_PROXY` for the built-in fetch; `api.steampowered.com` is reachable
  directly from the Lab container, so a proxy is not required.
