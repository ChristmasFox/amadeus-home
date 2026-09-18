# Amadeus native OpenClaw plugin

This is the only native plugin for the non-PUBG Amadeus capabilities. OpenClaw
owns natural-language planning and channel transport; this plugin exposes
bounded deterministic adapters and the single owner-notification capability.

The plugin never sends proactive messages to Telegram or KOOK. Producers write
owner events to the shared durable outbox, and the plugin delivers them through
the configured OpenClaw WhatsApp account and owner target.

The same plugin owns the OpenClaw-native Identity capability. Its SQLite store
contains only canonical Persons, trusted channel bindings, aliases, external
accounts, and short observed-evidence summaries. Optional initial presets are
loaded from the external `identityPresetsFile`; production channel IDs/JIDs and
the database stay outside Git. Observed aliases remain candidates until an
owner/Arthur confirmation.

All credentials, SSH keys, owner identity, and media paths are deployment
configuration. They are not part of this package or the repository.
