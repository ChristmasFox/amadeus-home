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

The market capability reads the NASDAQ-100 (`^NDX`) and S&P 500 (`^GSPC`)
regular-session daily bars through the configured Yahoo Finance Chart API
endpoint. It compares the current open or close with the previous trading
close, skips sessions without a current trading bar, and sends only the
structured notification returned by the deterministic tool. The scheduled
open/close jobs use the same WhatsApp owner outbox as other Amadeus reports.

All credentials, SSH keys, owner identity, and media paths are deployment
configuration. They are not part of this package or the repository.
