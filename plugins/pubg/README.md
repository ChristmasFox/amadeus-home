# PUBG Stats OpenClaw Plugin

This is the only PUBG business entry in the migrated OpenClaw runtime. It
registers six deterministic tools and delegates all data, query, SQLite, and
Telemetry work to `@agent/pubg-domain`.

Runtime credentials and team identity are external. Set `PUBG_TEAM_CONFIG_FILE`,
`PUBG_DATABASE_PATH`, and `PUBG_API_KEY_FILE` (or configure the corresponding
non-secret plugin paths). The plugin never stores the API key in OpenClaw
configuration or in the repository.
