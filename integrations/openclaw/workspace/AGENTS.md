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
- Reuse the same OpenClaw session and returned result-set/context identifiers
  for follow-up questions when the user is continuing the same request.
- Proactive delivery has one fixed destination: the WhatsApp owner DM. Business
  tools may emit an owner notification request, but no caller may choose a
  channel, recipient, Telegram target, KOOK target, or group.
- Treat external sends, file changes, media moves, sleep/restart actions, and
  other side effects as bounded operations: use an explicit target, preview or
  confirmation where the capability requires it, and never turn the agent
  into a generic shell or restart bridge.
- Never expose or invent secrets. Do not use n8n, old LangBot plugins, legacy
  facades, or retired execution paths as runtime fallbacks.
