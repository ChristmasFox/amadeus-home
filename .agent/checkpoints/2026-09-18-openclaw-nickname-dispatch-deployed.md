# OpenClaw nickname-to-PUBG dispatch fix (deployed)

- Date: 2026-09-18 Asia/Shanghai
- Source commit: `083f26b` (`fix(openclaw): enforce nickname identity dispatch`)
- Image: `local/openclaw-amadeus:git-083f26b1fb13-20260918125134`
- Remote checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918125134`
- Deployment result: OpenClaw image build/load, CasaOS recreate, OpenClaw/Product Radar health, media-adapter network, NAS read-only smoke, owner outbox smoke, plugin preflight, and secret validation passed.
- Runtime evidence:
  - Amadeus is loaded as a bundled plugin and runtime inspection lists `before_prompt_build`, `before_dispatch`, and `agent_end` typed hooks.
  - PUBG, Identity, and Amadeus Skills are eligible and model-visible.
  - Identity runtime counts remain `persons=4`, `aliases=8`, `external_accounts=4`, `channel_identities=8` after restart/recreate.
- Not yet claimed: no unsolicited group test message was sent. A real group request such as “胶昨天战绩” or “猴昨天战绩” is still required to verify the model emits `identity_resolve` followed by the PUBG tool.
