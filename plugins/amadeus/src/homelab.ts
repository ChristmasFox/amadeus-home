import type { OpenClawPluginToolContext } from 'openclaw/plugin-sdk/core';
import { adaptWorldlineNotification } from '@agent/presentation';
import type { AmadeusConfig } from './config.js';
import { assertMacHostQueryContext, isGroupContext, macHostStatus } from './machost.js';
import { renderHomelabReport } from './homelab-report.js';
import { requestJson } from './http.js';
import { isTrustedOwnerContext, ownerEventForContext, type OwnerNotifier } from './owner.js';

/** requestJson only resolves for an HTTP 2xx, so an HTML body (Changedetection, qBittorrent, the router login page) is a live service. */
function healthy(value: unknown): boolean {
  if (!value || typeof value !== 'object') return true;
  const item = value as Record<string, unknown>;
  return item.statusCode === undefined ? true : Number(item.statusCode) >= 200 && Number(item.statusCode) < 300;
}

function hostRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : { status: 'unavailable', error: 'host telemetry unavailable' };
}

function changedetectionHealthy(radarHealth: unknown): boolean {
  const sensor = radarHealth && typeof radarHealth === 'object' ? (radarHealth as Record<string, unknown>).sensor : undefined;
  return !!sensor && typeof sensor === 'object' && (sensor as Record<string, unknown>).ok === true;
}

async function probe(url: string, signal?: AbortSignal): Promise<{ ok: boolean; data?: unknown }> {
  try {
    // Plain GET: several roots (qBittorrent, the router login) are HTML pages, not JSON.
    const data = await requestJson(url, { ...(signal ? { signal } : {}), timeoutMs: 8_000, headers: { Accept: '*/*' } });
    return { ok: healthy(data), data };
  } catch { return { ok: false }; }
}

export async function homelabStatus(
  config: AmadeusConfig,
  context: OpenClawPluginToolContext,
  notifier: OwnerNotifier,
  notifyOwner: boolean,
  reportPeriod?: 'morning' | 'evening',
  signal?: AbortSignal,
): Promise<unknown> {
  assertMacHostQueryContext(context);
  if ((notifyOwner || reportPeriod) && (isGroupContext(context) || !isTrustedOwnerContext(context))) {
    throw new Error('HomeLab owner notification requires direct owner authorization');
  }
  const host = hostRecord(await macHostStatus(config, context, signal));
  const serviceUrls: Record<string, string> = {
    OpenClaw: 'http://openclaw:18789/healthz',
    ProductRadar: `${config.homeLabServiceBaseUrl}:5315/health`,
    Immich: `${config.homeLabServiceBaseUrl}:2283/api/server/ping`,
    Emby: `${config.homeLabServiceBaseUrl}:8096/emby/system/info/public`,
    qBittorrent: `${config.homeLabServiceBaseUrl}:8080/`,
  };
  const services: Record<string, boolean> = {};
  const probes: Record<string, { ok: boolean; data?: unknown }> = {};
  await Promise.all(Object.entries(serviceUrls).map(async ([name, url]) => { probes[name] = await probe(url, signal); services[name] = probes[name]?.ok ?? false; }));
  // Port 5000 on the Mac host is macOS AirPlay (403), not Changedetection, so Changedetection is judged by Product Radar's own sensor.
  services.Changedetection = changedetectionHealthy(probes.ProductRadar?.data);
  const openWrt = await probe(`${config.openWrtBaseUrl}/`, signal);
  services.OpenWrt = openWrt.ok;
  const unavailable = host.status !== 'ok';
  const anomalies = Array.isArray(host.anomalies) ? host.anomalies : [];
  const serviceEntries = Object.entries(services).filter(([name]) => name !== 'OpenWrt');
  const unhealthyServices = serviceEntries.filter(([, ok]) => !ok).map(([name]) => name);
  const conclusion = unavailable ? '❌ 宿主机遥测不可用' : anomalies.length || unhealthyServices.length || !openWrt.ok ? '⚠️ 需要关注' : '✅ 正常';
  const text = renderHomelabReport({ host, unavailable, conclusion, services: Object.fromEntries(serviceEntries), routerOk: openWrt.ok, anomalies });
  let notification: unknown;
  if (notifyOwner) {
    const occurredAt = new Date().toISOString();
    const date = occurredAt.slice(0, 10);
    const period = reportPeriod ?? 'manual';
    const eventKey = reportPeriod ? `mac-host-report:${date}:${reportPeriod}` : `mac-host-report:manual:${occurredAt}`;
    const allHealthy = !unavailable && Object.values(services).every(Boolean) && !anomalies.length;
    notification = await notifier.notify(ownerEventForContext(adaptWorldlineNotification({
      type: 'worldline_notification_intent',
      eventType: reportPeriod ? `mac_host_report_${reportPeriod}` : 'mac_host_report',
      kind: allHealthy ? 'scheduled_report' : 'network_degraded',
      severity: allHealthy ? 'success' : unavailable ? 'error' : 'warning',
      significance: allHealthy ? 'notable' : unavailable ? 'critical' : 'major',
      eventKey,
      source: 'mac-host-report',
      headline: reportPeriod === 'morning' ? '🖥 M204 晨间状态' : reportPeriod === 'evening' ? '🖥 M204 晚间状态' : '🖥 M204 状态',
      facts: [],
      summary: text,
      ...(typeof host.observedAt === 'string' ? { dataUpdatedAt: host.observedAt } : {}),
      occurredAt,
    }), context));
  }
  return { text, host, services, openWrt: { ok: openWrt.ok, data: openWrt.data }, anomalies, ...(notification === undefined ? {} : { notification }) };
}
