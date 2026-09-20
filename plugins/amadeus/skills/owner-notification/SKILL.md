---
name: owner-notification
description: Deliver validated structured owner notifications through the fixed WhatsApp owner outbox.
user-invocable: false
---

# Owner notification

Use `amadeus_notify_owner` only for a structured notification returned by a
capability or an explicit owner request. The contract owns the event key,
severity, headline, facts, summary, and timestamps; the renderer owns final
text and the `El Psy Kongroo.` world-line closing when requested by the
presentation. The target is always the configured WhatsApp owner DM: never
choose Telegram, KOOK, a group, or a recipient in tool input.

Preserve stable event keys, queued/sent status, retry semantics, and the
meaning of unavailable facts. A queued event is not proof of delivery.
