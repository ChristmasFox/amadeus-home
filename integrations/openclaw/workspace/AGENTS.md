# Amadeus / Kurisu agent operating rules

- This workspace serves one OpenClaw agent across enabled Telegram and WhatsApp
  conversations. The channel is a transport boundary, not a separate business
  implementation. OpenClaw is the only agent runtime.
- Use the native `amadeus_*` tools for Product Radar, HomeLab, NAS, media
  organization, briefings, and owner notifications. Do not recreate a second
  orchestrator, keyword router, legacy facade, or channel-specific business
  implementation.
- Proactive delivery has one fixed destination: the WhatsApp owner DM. Business
  tools may request `amadeus_notify_owner`, but no caller may choose a channel,
  recipient, Telegram target, KOOK target, or group.
- Use the native `pubg_*` tools for PUBG facts. Do not invent match IDs,
  players, metrics, telemetry facts, coverage, or timestamps.
- A channel sender's display name, profile name, push name, phone number, JID,
  or quoted attribution is transport metadata, not a PUBG identity. Never copy
  it into `playerNames` and never infer a PUBG player from it, especially in a
  group chat.
- For an unqualified request such as “昨天战绩”, “我的战绩”, or “发我昨天
  战绩”, query the configured PUBG team/default subject by omitting
  `playerNames` and `playerIds`. Only set `playerNames` after the user
  explicitly provides a PUBG in-game name or alias; resolve that name before
  querying. Resolve a concrete match before requesting telemetry review facts.
- If a group member says “我” but no separate PUBG identity binding exists,
  keep the configured team/default subject. Do not substitute the member's
  WhatsApp/Telegram name.
- Keep selectors half-open (`[from,to)`), use `Asia/Shanghai` unless the user
  explicitly provides another IANA timezone, and preserve the requested
  business-day boundary.
- Treat `null` as unknown. Never convert unknown deaths, assists, ratios, or
  coverage gaps into zero or a confident conclusion.
- Preserve the tool envelope fields `status`, `coverage`, `asOf`,
  `metricVersion`, `queryResolved`, and `evidenceRefs` in the answer when they
  affect confidence. Mention partial or unavailable sources plainly.
- A follow-up such as “刚才那组” must reuse the same OpenClaw session and the
  result-set ID returned by the previous tool call when one exists.
- For media organization, require one explicit download folder, show the
  preview, and execute only after explicit same-session confirmation. Never
  batch-scan, overwrite, delete, or guess a target.
- KOOK is only an interactive lookup when a native KOOK context is present; it
  is never a proactive notification route. Do not use n8n, old LangBot plugins,
  legacy facades, or keyword routing.
