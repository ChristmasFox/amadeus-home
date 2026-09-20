# Proactive notification producer inventory

All producers below write a transport-neutral owner event or intent. The
producer does not choose a WhatsApp/Telegram destination; the Amadeus owner
outbox and delivery policy own that boundary.

| Producer | Source boundary | Intent / adapter | Default policy | Status |
| --- | --- | --- | --- | --- |
| Product Radar | `apps/product-radar/src/integrations/notifications/owner.ts` | Radar event adapter preserves listing facts, prices, statuses, keywords, similarity, threshold and links | matched/similar → 世界线观测; price/status → 世界线偏移; heartbeat → D-Mail | ACTIVE |
| Market open/close | `plugins/amadeus/src/market.ts` | Market observation adapter keeps numeric index facts and data time | D-Mail; close may carry one closing line | ACTIVE |
| PUBG telemetry sync | `plugins/pubg/src/index.ts` | Plugin boundary adapts the Domain summary; Domain remains platform/theme neutral | D-Mail | ACTIVE |
| Amadeus release/deploy | `scripts/deploy-openclaw.sh` | Structured release outbox contract | 世界线收束 | ACTIVE |
| Codex completion hook | `integrations/openclaw/codex-notify.sh` → `scripts/notify-owner.sh` | Generic event with redacted summary and stable idempotency key | 世界线观测 | ACTIVE |
| VPS scheduled report | CasaOS cron declaration in `scripts/deploy-openclaw.sh` | Cron emits `worldline_notification_intent`, with facts supplied by bounded VPS tools | D-Mail; severity/significance remain factual | ACTIVE |
| HomeLab status | `plugins/amadeus/src/homelab.ts` | Service and resource facts; unknown metrics remain null/unknown | observation or divergence | ACTIVE |
| Media organizer | `plugins/amadeus/src/media.ts` | Completed operation facts from the adapter | 世界线收束 | ACTIVE |
| NAS | `plugins/amadeus/src/nas.ts` | Interactive read-only capability; no proactive notification side effect | none | ACTIVE / no proactive event |
| Owner native tool | `plugins/amadeus/src/capabilities/notification/register.ts` | Accepts either validated presentation or intent; intent is adapted deterministically | policy-selected | ACTIVE |
| Schedulers | OpenClaw cron with `--no-deliver` | Schedules tools and passes returned structured payloads to the owner tool | producer-specific | ACTIVE |
| changedetection | Product Radar sensor integration | Emits generic Radar events to the Product Radar adapter | compatibility source only | COMPATIBILITY |

`packages/presentation/src/worldline/contracts.ts` contains the registry used
by architecture checks. Adding a proactive producer requires adding its
adapter/boundary and a registry entry; a new prose title alone is not enough.
