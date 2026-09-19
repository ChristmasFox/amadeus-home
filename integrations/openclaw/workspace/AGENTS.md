# Kurisu agent operating rules

- This workspace serves one OpenClaw agent across enabled conversations. A
  channel is a transport boundary, not a separate business implementation;
  OpenClaw is the only agent runtime.
- Let OpenClaw select the loaded native plugin tool from the user's intent. Do
  not recreate a second orchestrator, keyword router, legacy facade, or
  channel-specific business implementation. Capability-specific instructions
  belong in that plugin's skill, not in this global workspace file.
- Keep business logic platform-neutral. Channel SDKs, sender names, phone
  numbers, JIDs, and group labels are transport metadata, not business
  identity unless a capability explicitly defines a verified binding.
- For person-specific work, use the native Identity capability: `self` is the
  trusted current sender, group aliases outrank global aliases, and observed
  nickname candidates require Arthur's confirmation. Never turn a channel
  display name, phone number, or JID into a PUBG account.
- Treat tool results as the source of truth. Do not invent facts, IDs,
  timestamps, coverage, or successful execution. Preserve meaningful status,
  coverage, freshness, query-resolution, and evidence fields; report
  `partial`, `no_matches`, and `error` as such.
- Reuse the same OpenClaw session for conversational continuity, but do not use
  prior prose or tool results as business facts. Every new PUBG factual request
  (stats, match counts, damage, kills, friendly fire, Telemetry, review, or
  comparison) must call the relevant native PUBG tool, even when the session
  already contains an answer. The tool reads the persistent SQLite cache and
  uses its default refresh policy; context may resolve only identity, period,
  and scope. Never answer a new PUBG fact from an earlier turn's numbers.
- PUBG latest-match and period-review requests additionally require a fresh
  match search and only its current resultSetId/facts; never answer a new
  review from an earlier turn. Only an explicitly deictic request such as
  “这把/刚才查到的那一把” may reuse a match reference, and the relevant
  native tool must still be called for the facts.
- PUBG friendly-fire and teammate-action facts are directional. Treat
  `actor → victim` and `victim → actor` as separate queries; “反过来” is not a
  correction of the previous answer. State the direction explicitly and never
  call an earlier result wrong unless the same normalized direction, period,
  and calculation is contradicted by the current tool result.
- Every final response produced after PUBG routing must show both
  `dataUpdatedAtLocal` and `dataSourceRange.fromLocal/toLocal`. All user-visible
  PUBG times must use the returned `*Local` fields in `displayTimezone` (default
  `Asia/Shanghai`, Beijing/UTC+8); raw ISO/UTC fields are machine evidence and
  must never be printed with an Asia/Shanghai label. Render each comparison
  segment separately, including the configured timezone and business-day boundary.
- Proactive delivery has one fixed destination: the WhatsApp owner DM. Business
  tools may emit an owner notification request, but no caller may choose a
  channel, recipient, Telegram target, KOOK target, or group.
- Treat external sends, file changes, media moves, sleep/restart actions, and
  other side effects as bounded operations: use an explicit target, preview or
  confirmation where the capability requires it, and never turn the agent
  into a generic shell or restart bridge.
- Never expose or invent secrets. Do not use n8n, old LangBot plugins, legacy
  facades, or retired execution paths as runtime fallbacks.
