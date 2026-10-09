import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { configFor } from '../../config.js';
import { getVpsLiveStatus, getVpsServices, getVpsServiceInfo, getVpsSubscriptionDetail, getVpsSubscriptionOverview, getVpsSystemStatus, getVpsUsage } from '../../vps.js';
import { registerTool } from '../../shared/register-tool.js';
import { Type } from 'typebox';

const VpsParameters = Type.Object({}, { additionalProperties: false });
const VpsSubscriptionAccountId = Type.Union([
  Type.Literal('Labmem001'),
  Type.Literal('Labmem002'),
  Type.Literal('Labmem003'),
  Type.Literal('Labmem004'),
  Type.Literal('Labmem005'),
  Type.Literal('M204-Net-Core'),
  Type.Literal('legacy'),
]);
const VpsSubscriptionDetailParameters = Type.Object({ accountId: VpsSubscriptionAccountId }, { additionalProperties: false });

export function registerVps(api: OpenClawPluginApi): void {
  registerTool(api, 'amadeus_vps_service_info', 'Read VPS basic service and plan facts through the fixed read-only KiwiVM service-info API. No control endpoint or credential is exposed.', VpsParameters, async (_params, _context, _notifier, signal) => getVpsServiceInfo(configFor(api), signal));
  registerTool(api, 'amadeus_vps_live_status', 'Read the VPS Running/Stopped state, KiwiVM live resource facts, and CPU throttling through the fixed read-only live-status API.', VpsParameters, async (_params, _context, _notifier, signal) => getVpsLiveStatus(configFor(api), signal));
  registerTool(api, 'amadeus_vps_usage', 'Read KiwiVM traffic counters, quota, remaining bytes, reset time, bounded traffic history, and the persisted delta since the previous successful sample.', VpsParameters, async (_params, _context, _notifier, signal) => getVpsUsage(configFor(api), signal));
  registerTool(api, 'amadeus_vps_system_status', 'Read VPS uptime, load average, memory, and root filesystem usage through one fixed read-only SSH probe. It never accepts a shell command.', VpsParameters, async (_params, _context, _notifier, signal) => getVpsSystemStatus(configFor(api), signal));
  registerTool(api, 'amadeus_vps_services', 'Read the fixed critical VPS systemd services Caddy, Xray, Hysteria2, and frps through a bounded read-only SSH probe.', VpsParameters, async (_params, _context, _notifier, signal) => getVpsServices(configFor(api), signal));
  registerTool(api, 'amadeus_vps_subscription_overview', 'Owner-only, direct-owner or scheduled-report read-only overview of six active proxy accounts, retired legacy history, sanitized REALITY fallback and HY2 authentication security facts, and reconciliation state. Group sessions and non-owner DMs are denied. No subscription or proxy credential is returned.', VpsParameters, async (_params, context, _notifier, signal) => getVpsSubscriptionOverview(configFor(api), context, signal));
  registerTool(api, 'amadeus_vps_subscription_detail', 'Owner-only, direct-owner read-only facts for one bounded Labmem, M204-Net-Core, or legacy history account ID. Group sessions and non-owner DMs are denied; credentials are never returned.', VpsSubscriptionDetailParameters, async (params, context, _notifier, signal) => getVpsSubscriptionDetail(configFor(api), (params as { accountId: 'Labmem001' | 'Labmem002' | 'Labmem003' | 'Labmem004' | 'Labmem005' | 'M204-Net-Core' | 'legacy' }).accountId, context, signal));
}
