# Amadeus infrastructure classification

This is the current source-level classification for Amadeus 1.4.2. It is an
operational boundary, not a request to delete data. Runtime state and secrets
remain outside Git and are checked by `scripts/migration-readiness.sh`.

| Asset | Classification | Current owner / reason | Exit or follow-up condition |
| --- | --- | --- | --- |
| OpenClaw + `plugins/amadeus` / `plugins/pubg` | ACTIVE | The single agent runtime and native business boundary | Keep source, build, and CasaOS compose in sync |
| Product Radar | ACTIVE | Generic radar core, structured event store, and owner outbox adapter | Keep until watches and replacement capability are retired explicitly |
| FashionSigLIP native macOS worker | ACTIVE | Semantic image matching worker on Apple MPS with Sharp fallback | Rebuild on a new Mac with the tracked installer; model cache is rebuildable |
| Media organizer adapter | ACTIVE | External media operation boundary called by `amadeus_media_organize` | Keep while media operations are in scope |
| changedetection.io | COMPATIBILITY | Product Radar sensor client and persisted sensor watches still depend on it | Remove only after a source/watch migration is completed and verified |
| 9Router | ACTIVE | Current model gateway used by OpenClaw | Replace only with a reviewed model-route migration |
| `amadeus-gateway` VPS probe / Caddy / frps assets | ACTIVE | Read-only VPS observability and gateway infrastructure | Preserve dedicated keys and re-check after host migration |
| NAS / HomeLab / KOOK integrations | ACTIVE | Native read-only or owner-confirmed capabilities | Keep secrets external and preserve read-only boundaries |
| Pubg legacy importer and migration CLI | MIGRATION_ONLY | One-time import tooling under `packages/pubg-domain/src/migration` and migration scripts | Do not load in normal runtime; retire after historical data retention policy permits |
| Operation Skuld manifest and runbook | MIGRATION_ONLY | Defines a future Mac mini execution plan | This Goal verifies readiness only; no cutover is executed |
| LangBot, old Runtime, n8n, n8n-sandbox | DEAD for normal deployment | Retired execution and notification paths; no active source or compose dependency | Keep only external backup/checkpoint evidence; never restore as fallback |

The shared network is `amadeus_network`; the old `langbot_langbot_network`
name is not a deployment dependency. Existing old network state is left alone
until a separate, reviewed cleanup operation proves it has no remaining
compatibility attachment.
