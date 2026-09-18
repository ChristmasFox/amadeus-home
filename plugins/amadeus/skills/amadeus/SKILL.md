---
name: amadeus
description: Use the native Amadeus OpenClaw tools for Product Radar, HomeLab/NAS status, safe Emby media organization, early/evening briefings, KOOK member lookup, and owner WhatsApp notifications.
---

# Amadeus capabilities

Use the bounded `amadeus_*` tools. OpenClaw chooses the tool from the user’s
meaning; do not create a keyword router, `/command` parser, or second agent.

- Product Radar accepts structured watch operations. Keep natural-language
  interpretation in OpenClaw and pass explicit source/type/target/rules values.
- Media organization is one explicit download item at a time. Scan when the
  item is ambiguous, show the preview, and execute only after an explicit user
  confirmation in the same conversation. Never guess a title, process the
  whole inbox, overwrite library files, or delete originals.
- NAS and HomeLab tools are read-only except for the explicit NAS sleep action.
  Never use them as a generic shell or restart bridge.
- KOOK is only an interactive lookup when a native KOOK context is present; it
  is never a proactive notification route.
- `amadeus_notify_owner` has no channel or recipient argument. It is the only
  proactive notification path and always targets the configured WhatsApp owner.
  Telegram and KOOK are chat entrances only.
- Scheduled briefings use `amadeus_briefing` with `deliver=true`; the tool
  returns the generated report and sends the same report through the owner
  notification capability. Do not send the report directly to a group.
