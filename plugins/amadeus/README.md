# Amadeus native OpenClaw plugin

This is the only native plugin for the non-PUBG Amadeus capabilities. OpenClaw
owns natural-language planning and channel transport; this plugin exposes
bounded deterministic adapters and the single owner-notification capability.

The plugin never sends proactive messages to Telegram or KOOK. Producers write
owner events to the shared durable outbox, and the plugin delivers them through
the configured OpenClaw WhatsApp account and owner target.

All credentials, SSH keys, owner identity, and media paths are deployment
configuration. They are not part of this package or the repository.
