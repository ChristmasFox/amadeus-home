---
name: identity
description: "Resolve and learn cross-channel Person identities, aliases, and external accounts without guessing from channel names."
user-invocable: false
---

# Cross-channel Identity

Identity is the canonical Person capability shared by Telegram, WhatsApp, and
future OpenClaw channels. OpenClaw owns natural-language interpretation; these
tools accept only structured references and metadata-backed targets.

## Resolution order

1. `reference=self` means the current trusted `requesterSenderId` on the
   current channel/account, never the owner or a default team.
2. `reference=mention` or `reference=reply_sender` uses only the trusted
   mention/reply metadata supplied by OpenClaw.
3. A confirmed channel binding wins over names. A confirmed group alias wins
   over a confirmed global alias. An observed alias is always a candidate.
4. `unbound`, `ambiguous`, and `candidate` results are not safe PUBG subjects.
   Ask for clarification or Arthur's confirmation instead of guessing.

## Learning and confirmation

- For “刚才那个王XX就是小王”, resolve the trusted reply/mention target and
  call `identity_bind_channel` with the canonical `personId` only after Arthur
  confirms it.
- For “狗王就是小王”, use `identity_add_alias` with
  `source=confirmed`, `scope=group` when the relation is group-local. This
  requires the owner/Arthur confirmation gate.
- Repeated usage can be recorded with `identity_add_alias` using
  `source=observed`, `scope=group`, and a short `evidenceSummary`. Never
  promote it automatically; list it with `identity_list_candidates` and use
  `identity_confirm_candidate` only after explicit confirmation.
- Link an external account with `identity_link_account` only when the provider
  and external id are explicit. Never convert Telegram/WhatsApp IDs, phone
  numbers, JIDs, display names, or aliases into PUBG IDs.

Do not add `/bind`, `/alias`, keyword dispatch, a second runtime, or a second
identity database. The SQLite database stores only Persons, bindings, aliases,
external accounts, and short evidence summaries; it does not store full chat
history.
