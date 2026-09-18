---
name: amadeus
description: Use the native Amadeus OpenClaw tools for Product Radar, HomeLab/NAS status, safe Emby media organization, KOOK member lookup, Identity, VPS status, and owner WhatsApp notifications.
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
Identity is a shared native capability, not a keyword router:

- Use `identity_resolve` for `self`, trusted mentions/replies, canonical
  `personId`, or an explicit alias. The current sender and mention identities
  come from OpenClaw metadata; never reconstruct them from a display name,
  phone number, or JID in message text.
- For an unbound sender, return `unbound` and ask Arthur for a natural-language
  confirmation. Use `identity_bind_channel` only when Arthur confirms the
  selected trusted sender/mention/reply. Do not guess a PUBG account.
- Group aliases are preferred over global aliases. Use
  `identity_add_alias` with `source=observed` only for a bounded candidate;
  candidates are not reliable until Arthur calls `identity_confirm_candidate`.
- Use `identity_link_account` only for an explicit confirmed provider/account
  pair. Accounts are provider-neutral; PUBG consumes only the `provider=pubg`
  account returned through Identity.
