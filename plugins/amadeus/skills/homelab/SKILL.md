---
name: homelab
description: Read owner-authorized MacHostAgent telemetry and bounded HomeLab/OpenWrt probes.
user-invocable: false
---

# HomeLab

Use `amadeus_homelab_status` in owner or group query contexts for the real M204 macOS host facts, SQLite-backed
current-day aggregates, bounded service probes, and the explicitly configured
OpenWrt endpoint. MacHostAgent is the only host telemetry source; if it is
unavailable, preserve `host telemetry unavailable` and never substitute guest
or container metrics. Set `notifyOwner=true` only for an explicit owner or
scheduled report request from a direct owner or cron context; group queries must
leave it false. Morning/evening reports reuse the existing owner outbox and
delivery worker.
