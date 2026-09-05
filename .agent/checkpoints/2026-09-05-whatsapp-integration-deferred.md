# Checkpoint: WhatsApp Integration Deferred

Date: 2026-09-05
Git Commit: ccf68c9
Branch: main

## Status Change

WhatsApp 接入任务已从 ACTIVE 更改为 BLOCKED / DEFERRED。

## Deferral Reason

Meta WhatsApp Cloud API 的商业版能力（如 webhook 批量验证、会话模板、高并发消息队列）是接入稳定性与合规的必要前提。当前开源版限制与平台变更频率较高，暂不继续投入实现和部署。

## Preserved Components

The following components are retained in the repository as future integration reference:

- **apps/whatsapp-adapter** - Meta Cloud API webhook verification, inbound message normalization, text splitting, and sender boundary facade
- **apps/agent-runtime/src/platform/whatsapp** - Complete WhatsApp platform adapter, renderer, webhook, sender, and graph-api implementations
- **integrations/langbot/patches/whatsapp.yaml** - LangBot-side custom platform resources
- **infra/cloudflare** - Cloudflare Tunnel configuration templates (retained for future Webhook / HomeLab API use)

## Verification: No Impact on Other Platforms

- WhatsApp code is only static exports, does not affect KOOK / Telegram runtime routing
- Platform capabilities definitions remain static configuration, no runtime dependencies introduced
- Runtime image whatsapp tag only indicates build-time inclusion, no automatic activation

## Files Updated

- docs/DECISIONS.md - Added "2026-09-05：WhatsApp 接入暂缓" decision entry
- docs/PROJECT_STATE.md - Added "WhatsApp 接入状态：BLOCKED / DEFERRED" section
- docs/CURRENT_TASK.md - Updated current task status to BLOCKED / DEFERRED with detailed rationale

## Recovery Conditions

1. Obtain WhatsApp Business API commercial license
2. Define required message templates, session state, and webhook verification capabilities
3. Complete integration testing and performance benchmarks with existing runtime

## Recovery Steps

1. Re-evaluate Meta Cloud API latest capabilities and compliance requirements
2. Update docs/CURRENT_TASK.md status
3. Enable apps/agent-runtime/src/platform/whatsapp related code
4. Configure Cloudflare Tunnel and LangBot webhook integration

## Runtime Status

- Current runtime (pubg-query-engine-v3) continues with KOOK and Telegram support
- WhatsApp code exists but is not activated in production routing
- No configuration changes required for existing platforms

## Next Steps

None - the WhatsApp integration is explicitly deferred until recovery conditions are met. The repository remains fully functional for KOOK and Telegram platforms.

## Rollback Information

If this deferral needs to be reversed before meeting recovery conditions:
- Previous checkpoint: 2026-09-05-codex-engineering-specs.md
- Git commit history shows all WhatsApp-related development work
- All code and configurations remain intact in the repository
