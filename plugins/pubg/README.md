# PUBG Stats OpenClaw Plugin

This is the only PUBG business entry in the migrated OpenClaw runtime. It
registers six deterministic tools and delegates all data, query, SQLite, and
Telemetry work to `@agent/pubg-domain`.

OpenClaw owns Telegram, WhatsApp, and future channel transport. The plugin
keeps a small adapter boundary in `src/adapters/`: the current OpenClaw
adapter normalizes trusted channel/session context, while the Domain receives
only platform-neutral inputs. Adding another OpenClaw channel or host adapter
must not require changes to `packages/pubg-domain`.

For person-specific requests, the plugin consumes canonical `Person` IDs and
provider-neutral `pubg` external accounts from `@agent/identity`. It resolves
those accounts to PUBG player IDs at the plugin boundary; the Domain never sees
Telegram/WhatsApp identities, nicknames, phone numbers, or JIDs. An unbound
sender or missing PUBG account is an explicit error, not a configured-team
fallback. `team=true` is the only explicit team subject.

Runtime credentials and team identity are external. Set `PUBG_TEAM_CONFIG_FILE`,
`PUBG_DATABASE_PATH`, and `PUBG_API_KEY_FILE` (or configure the corresponding
non-secret plugin paths). The plugin never stores the API key in OpenClaw
configuration or in the repository.
