---
name: identity
description: "Resolve and learn cross-channel Person identities, aliases, and external accounts without guessing from channel names."
user-invocable: false
---

# Cross-channel Identity

Identity is the canonical Person capability shared by Telegram, WhatsApp, and
future OpenClaw channels. OpenClaw owns natural-language interpretation; these
tools accept only structured references and metadata-backed targets.

## Required use before person-specific domain work

When a user asks for facts about a person using a nickname or alias, invoke
`identity_resolve` before answering or calling the domain tool. For example,
“胶昨天战绩” and “猴昨天战绩” require
`identity_resolve({reference: "alias", alias: "胶"})` or the equivalent exact
alias, followed by the PUBG tool with the returned canonical `personId`.
For first-person references such as “我”“我的”“本人” or “自己”, invoke
`identity_resolve({reference: "self"})` first; the current trusted channel
sender is the subject, including in a group and when the sender is Arthur.
Never ask for the external account first when the resolver can answer it, and
never treat a previous assistant claim that an account is missing as current
state. A domain tool may report an account problem only after a current
identity resolution has returned `resolved` and the domain tool has been
called.

## Resolution order

1. `reference=self` means the current trusted `requesterSenderId` on the
   current channel/account, never the owner or a default team.
2. `reference=mention` or `reference=reply_sender` uses only the trusted
   mention/reply metadata supplied by OpenClaw.
3. A confirmed channel binding wins over names. A confirmed group alias wins
   over a confirmed global alias; if no group alias exists, fall back to the
   preloaded/confirmed global alias. An observed alias is always a candidate.
4. Preloaded members and aliases are already deployment-confirmed; do not ask
   Arthur or the group to reconfirm their external ID. Only `unbound`,
   `ambiguous`, and `candidate` results are not safe PUBG subjects.
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
