---
name: identity
description: "MANDATORY identity routing: for any prompt containing a named person/alias or a first-person identity question, call identity_resolve for every named alias (reference=alias, alias=X) and for 我/我的/本人 (reference=self) before any memory_search or memory_get. Never use memory retrieval first, never use USER.md to answer 我是谁, and never substitute Arthur/owner for an unbound sender. Only after identity_resolve returns not_found for a past-conversation question may you use sessions_search then sessions_history; retrieval failures are unknown, not absence."
user-invocable: false
---

# Cross-channel Identity

Identity is the canonical Person capability shared by Telegram, WhatsApp, and
future OpenClaw channels. OpenClaw owns natural-language interpretation; these
tools accept only structured references and metadata-backed targets.

## Resolve names before answering identity questions

When a user asks who a named person is, whether an alias is known (for example
“你认识 X 吗？” or “X 是谁？”), call
`identity_resolve({reference: "alias", alias: "X"})` before answering, even if
there is no PUBG/domain request. A `resolved` result is authoritative for the
canonical `displayName`; use `identity_get_person` only when more identity
details are needed. If the resolver returns `not_found`, do not guess. If the
tool fails, say the lookup failed rather than claiming the person is absent.

If the identity store has no match and the question is about a past conversation,
use `sessions_search` with the distinctive name or phrase, then use
`sessions_history` with the returned session/message identifiers when more
context is needed. `sessions_search` searches visible user/assistant transcript
text locally; do not substitute `memory_search` or filesystem listing for this
exact transcript lookup. Use `memory_search` for durable notes in `MEMORY.md`,
`USER.md`, and `memory/**`. If either search tool fails or reports unavailable,
that is a retrieval failure, not evidence that the fact was never recorded;
state that recall is unavailable instead of inventing or denying it.

For first-person questions such as “我是谁”“我的账号是什么” or “本人”, call
`identity_resolve({reference: "self"})` first. If it returns `unbound`, say that
the current session has no trusted sender identity. Never substitute Arthur,
the owner, or a default team for an unbound sender.

## Required use before person-specific domain work

When a user asks for facts about a person using a nickname or alias, invoke
`identity_resolve` before answering or calling the domain tool. For example,
“胶昨天战绩” and “猴昨天战绩” require
`identity_resolve({reference: "alias", alias: "胶"})` or the equivalent exact
alias, followed by the PUBG tool with the returned canonical `personId`.
For first-person references such as “我”“我的”“本人” or “自己”, invoke
`identity_resolve({reference: "self"})` first; the current trusted channel
sender is the subject, including in a group. An unbound result never resolves
to the owner by default.
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
