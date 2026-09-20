---
name: homelab
description: Read HomeLab probes and optionally request a fixed owner notification.
user-invocable: false
---

# HomeLab

Use `amadeus_homelab_status` for the bounded Glances, uptime, and fixed
service probes. It does not restart or modify services. Set `notifyOwner=true`
only for an explicit owner request and preserve the returned queued/sent
delivery status.
